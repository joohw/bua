# BUA 桥协议

**版本**：v0（草稿）
**状态**：设计阶段，未实现

本文档定义 `bua-server`（本地桥）与 BUA 扩展之间的传输协议，以及 agent 侧 SDK 的方法契约。

---

## 1. 传输

- **载体**：WebSocket
- **绑定**：`ws://127.0.0.1:<port>`，**只绑回环**。不提供监听外部接口的选项
- **默认端口**：`${port}`（具体值待定，需避开常用端口）
- **帧格式**：JSON-RPC 2.0
- **编码**：UTF-8

```
→ {"jsonrpc":"2.0","id":1,"method":"tab.goto","params":{"tabId":"t_1","url":"https://example.com"}}
← {"jsonrpc":"2.0","id":1,"result":{"ok":true}}
```

### 1.1 为什么不是 native messaging

| | native messaging | 本地 WebSocket |
|---|---|---|
| 安装成本 | 注册表 + host manifest | 无 |
| 跨平台 | 每平台一套 | 一套 |
| 任意 agent 复用 | 难（绑定宿主进程） | 易（连同一个 ws） |
| 安全 | OS 层隔离（文件系统权限） | **无隔离 —— 本机任何进程都能连** |

最后一行是本设计**刻意接受**的代价，见 §2。

---

## 2. 信任模型与传输层

### 2.1 不鉴权（设计决定）

**BUA 不做 token、不做证书、不签发任何授权凭据。任何 agent 都能直接连接桥。**

理由：目标就是「让**任意** agent 都能用浏览器」。一旦引入授权凭据，每个 agent 都要集成配对流程，门槛就回来了。

**代价必须说清楚**：桥监听回环且无鉴权，所以**本机任意脚本/程序都能驱动浏览器**。

| 谁能驱动浏览器 | 是否成立 |
|---|---|
| 用户主动启动的 agent | ✅ 预期行为 |
| 用户机器上的**任意**脚本/程序 | ⚠️ **同样成立** |
| 从公共网络访问的第三方 | ❌ **不成立**（仅绑回环 + Host 校验） |

本机恶意软件本来就已有用户权限（能读 Chrome profile 与 Cookie 文件），BUA 没有提升它的能力上限；但确实**降低了一个门槛** —— 从「理解 Chrome profile 格式」降到「会发 WebSocket 消息」。

> 这是刻意取舍，不是疏漏。因此**引导页的风险告知是不可省略的一环**（见 `design.md` §4.2）。

**未来演进**：可在引导页签发证书（生成密钥对，`hello` 携带签名而非明文）。协议已经是「一条 hello 消息」，加字段即可，无需改动其他层。

### 2.2 握手

无鉴权，但保留**协议版本与能力协商**：

```jsonc
// 扩展 → 桥
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "bua.hello",
  "params": {
    "protocolVersion": "v0",
    "client": {
      "extensionId": "…",
      "extensionVersion": "0.1.0",
      "chromeVersion": "154.0.8037.99",
      "capabilities": ["cdp", "management", "bua.audit"]
    }
  }
}

// 桥 → 扩展
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "sessionId": "s_7f3a…",
    "heartbeatMs": 15000,
    "capabilities": {
      "cdp": true,           // ⭐ false = 已降级到 chrome.scripting
      "screenshots": true,
      "fileUploads": false,
      "downloads": true,
      "evaluate": true,
      "management": true
    }
  }
}
```

**`capabilities` 取代了授权层级。** 不限制 agent，就不需要声明「谁被允许做什么」；需要声明的是「这个后端**此刻实际能**做什么」。最有价值的场景是企业策略（Chrome 155+）拒绝 `attach()` 时，扩展降级到 `chrome.scripting` 并把 `cdp` 报为 `false` —— agent 应据此降级而非失败。

### 2.3 传输层保留的一道防线：`Host` 头

| # | 校验项 | 规则 |
|---|---|---|
| 1 | **绑定地址** | 硬绑 `127.0.0.1`，**不提供** `0.0.0.0` 选项 |
| 2 | **`Host` 头** | 只接受 `127.0.0.1:<port>` / `localhost:<port>`，否则 `403` |

`Host` 校验**不限制任何 agent**（本机进程随便连），但能挡住 **DNS rebinding** —— 攻击者把域名解析到 `127.0.0.1`，让用户浏览器里的恶意页面去连本地桥。这道防线不违反「不限制 agent」的目标，却挡得住真实攻击，因此保留。

**明确不做**：

| ❌ | 原因 |
|---|---|
| `Origin` 校验 | 会排除非扩展客户端 = **限制 agent**，与目标冲突 |
| `killProcessOnPort` | **强杀用户进程不可接受**。端口占用就报错，提示用户换端口 |
| 踢旧连接 | 破坏多 agent 并发前提。各客户端独立会话 |
| 绑 `0.0.0.0` | 会让远程可访问，这是唯一真正的边界 |

> 后三条是竞品调研发现的**行业反面教材**：Browser MCP（7.2k★）会强杀占用该端口的任意进程，并用新连接踢掉旧连接。


---

## 3. 方法契约

命名空间按「作用域」划分，避免巨型方法名。

### 3.0 桥管理

| 方法 | 说明 |
|---|---|
| `bua.hello` | 握手与能力协商（§2.2） |
| `bua.heartbeat` | 心跳。扩展 → 桥，桥需在 `2 × heartbeatMs` 内收到 |
| `bua.goodbye` | 主动断开 |

### 3.1 浏览器

| 方法 | 参数 | 返回 |
|---|---|---|
| `browser.list` | — | `BrowserInfo[]` |
| `browser.get` | `{ id }` | `BrowserInfo` |
| `browser.getDefault` | — | `BrowserInfo` |
| `browser.getForUrl` | `{ url }` | `BrowserInfo` |
| `browser.nameSession` | `{ browserId, name }` | `{ ok: true }` |
| `browser.history` | `{ browserId, ...BrowserHistoryOptions }` | `BrowserHistoryEntry[]` |
| `browser.capabilities.list` | `{ browserId }` | `string[]` |
| `browser.capabilities.get` | `{ browserId, id }` | `{ documentation: string }` |

```ts
type BrowserInfo = {
  id: string;
  name: string;
  family?: string;                       // "chrome" | "edge" | "brave" | …
  type: "extension" | "cdp" | "iab" | "mcpapps";
  profileName?: string;
  tabs: TabInfo[];
  metadata?: { extensionInstanceId?: string; buaSessionId?: string };
};
```

> `type` 与 Codex 对齐 —— 四档取值完全一致，便于 agent 复用判断逻辑。

### 3.2 用户标签（核心差异点）

BUA 的关键能力：操作**用户自己打开的**标签，而不是只能新开。

| 方法 | 参数 | 返回 | 授权要求 |
|---|---|---|---|
| `user.openTabs` | `{ browserId }` | `UserTabInfo[]` | `none` |
| `user.getTabContext` | `{ browserId, tabId }` | `UserTabContext` | `read` |
| `user.claimTab` | `{ browserId, tabId }` | `{ tabId }` | `interact` |

```ts
type UserTabInfo = {
  id: string;
  title?: string;
  url?: string;
  lastOpened: number;
  windowId: number;
  pinned: boolean;
  audible?: boolean;
  claimed: boolean;      // 是否已被某个会话接管
  claimedBy?: string;    // 会话 id
};

type UserTabContext = {
  title?: string;
  url?: string;
  text?: string;         // 有界：默认上限 8 KB
  truncated: boolean;
};
```

`claimTab` 的语义与 Codex 一致：把一个用户标签转化为可控制的 agent 标签。**已被其他会话接管的标签默认拒绝**（`BUA_TAB_CLAIMED`），除非请求方持有更高优先级的 grant。

### 3.3 标签

| 方法 | 参数 | 返回 |
|---|---|---|
| `tabs.list` | `{ browserId }` | `TabInfo[]` |
| `tabs.get` | `{ browserId, tabId }` | `TabInfo` |
| `tabs.new` | `{ browserId, url?, visible? }` | `{ tabId }` |
| `tabs.selected` | `{ browserId }` | `TabInfo \| null` |
| `tabs.content` | `{ browserId, urls, ...TabsContentOptions }` | `TabsContentResult[]` |
| `tabs.close` | `{ tabId }` | `{ ok: true }` |

```ts
type TabInfo = {
  id: string;
  url?: string;
  title?: string;
  active: boolean;
  pinned?: boolean;
  windowId?: number;
  status?: "loading" | "complete";
};
```

### 3.4 标签操作

| 方法 | 参数 |
|---|---|
| `tab.goto` | `{ tabId, url }` |
| `tab.back` / `tab.forward` / `tab.reload` | `{ tabId }` |
| `tab.close` | `{ tabId }` |
| `tab.url` / `tab.title` | `{ tabId }` |
| `tab.screenshot` | `{ tabId, ...ScreenshotOptions }` |
| `tab.getJsDialog` | `{ tabId }` |
| `tab.markDeliverable` | `{ tabId }` |
| `tab.markHandoff` | `{ tabId }` |
| `tab.requestManualHandoff` | `{ tabId }` |

```ts
type ScreenshotOptions = {
  format?: "png" | "jpeg";     // 默认 png
  quality?: number;            // jpeg 专用，1..100
  fullPage?: boolean;          // 默认 false
  clip?: { x: number; y: number; width: number; height: number };
};
```

**截图返回**：不走 base64 内联（大图会把 jsonrpc 帧撑爆）。改为：

```jsonc
// 返回引用，SDK 再按需取字节
{ "ref": "blob_9c2e…", "mime": "image/png", "bytes": 184320, "width": 1264, "height": 805 }
// 取字节（或由 SDK 直接落地成文件）
{ "method": "blob.get", "params": { "ref": "blob_9c2e…", "asFile": true } }
// → { "path": "C:\\Users\\…\\bua\\blobs\\9c2e.png" }
```

理由：截图/无障碍树/DOM 快照都是大对象，让桥负责落盘，agent 侧只传引用，既省内存也避免协议帧上限。

### 3.5 Playwright 层

```
playwright.domSnapshot      { tabId } → { ref }
playwright.evaluate         { tabId, functionSource, arg?, options? } → { value }
playwright.elementInfo      { tabId, x, y } → ElementInfo[]
playwright.elementScreenshot{ tabId, ... } → { ref }
playwright.frameLocator     { tabId, frameSelector } → { frameHandle }
playwright.waitForLoadState { tabId, ...PageWaitForLoadStateOptions }
playwright.waitForURL       { tabId, url, ...PageWaitForURLOptions }
playwright.waitForTimeout   { tabId, timeoutMs }
playwright.waitForEvent     { tabId, event: "download" | "filechooser", ... }
playwright.expectNavigation { tabId, action, options }
```

**定位器采用句柄模型** —— 不把 locator 序列化成字符串来回传，而是让扩展侧持有一个 locator 对象树，桥返回不透明句柄：

```
playwright.locator       { tabId, selector } → { locatorId }
playwright.getByRole     { tabId, role, opts } → { locatorId }
playwright.getByText     { tabId, text, opts } → { locatorId }
…（其余构造器同理）

locator.click            { locatorId, options? }
locator.fill             { locatorId, value, options? }
locator.innerText        { locatorId, options? } → { text }
locator.isVisible        { locatorId } → { visible }
locator.count            { locatorId } → { count }
locator.filter           { locatorId, options } → { locatorId }
locator.locator          { locatorId, selector, options } → { locatorId }
locator.first / last / nth  { locatorId[, index] } → { locatorId }
locator.and / or         { locatorId, otherLocatorId } → { locatorId }
```

**为什么用句柄**：Playwright 的 locator 是惰性求值的对象，序列化会丢失语义（`first().filter(...)` 这类链式约束无法用字符串表达）。句柄模型保留了完整语义，代价是扩展侧要管生命周期。

**句柄回收**：`locatorId` 有 TTL（默认 5 分钟无引用）与显式释放方法 `locator.release`；标签关闭时其全部句柄失效，后续调用返回 `BUA_HANDLE_STALE`。

### 3.6 AX 层

```
ax.get     { tabId, mode?: "state" | "screenshot" | "both", options? } → { state?, ref? }
ax.write   { tabId, mode?, options? }        // 副作用：写入模型可见输出
ax.click   { tabId, target: number | AXPoint, options? }
ax.typeText{ tabId, elementIndex: number | null, text }
ax.pressKey{ tabId, elementIndex: number | null, key, options? }
ax.setValue{ tabId, elementIndex, value }
ax.paste   { tabId, elementIndex: number | null, text, options? }
ax.selectText { tabId, elementIndex, text, options? }
ax.scroll  { tabId, target, direction, pages? }
ax.drag    { tabId, from, to }
ax.performSecondaryAction { tabId, elementIndex, action }
```

**`get` / `write` 的区别（对齐 Codex）**：`get` 只返回不展示；`write` 是「让模型看见」的推荐方法。这个区分让 agent 能明确表达「我现在要观察」，而不是每次读取都污染上下文。

### 3.7 CUA / DomCUA 层

```
cua.click         { tabId, x, y, options? }
cua.double_click  { tabId, x, y, options? }
cua.move          { tabId, x, y, options? }
cua.drag          { tabId, path: AXPoint[], options? }
cua.scroll        { tabId, x, y, deltaX, deltaY, options? }
cua.type          { tabId, text, options? }
cua.keypress      { tabId, keys, options? }
cua.downloadMedia { tabId, x, y, options? }

dom_cua.get_visible_dom { tabId } → { ref }
dom_cua.click           { tabId, nodeId, options? }
dom_cua.double_click    { tabId, nodeId, options? }
dom_cua.scroll          { tabId, nodeId?, deltaX, deltaY, options? }
dom_cua.type            { tabId, text, options? }
dom_cua.keypress        { tabId, keys, options? }
dom_cua.downloadMedia   { tabId, nodeId, options? }
```

### 3.8 内容导出

```
content.export                { tabId } → { path }
content.exportGsuite          { tabId, type: "pdf"|"md"|"xlsx"|"csv"|"docx"|"pptx" } → { path }
content.exportYouTubeTranscript { tabId } → { path }
```

### 3.9 能力

```
capabilities.list { scope: "browser" | "tab", targetId } → { ids: string[] }
capabilities.get  { scope, targetId, id } → { documentation: string }
```

**能力是可选、可探测、自带文档的。** agent 应写成「先探测再使用」：

```js
const ids = await tab.capabilities.list();
if (ids.includes("cdp")) { /* 用原始 CDP 逃生口 */ }
else { /* 走高层 API */ }
```

已知能力：`cdp` `browserAuth` `webmcp` `management` `pageAssets` `botDetection` `viewport` `visibility`
BUA 增补：`bua.audit` `bua.consent`

### 3.10 审计（BUA 增补）

```
audit.trail  { browserId, limit? } → { changes: AuditEntry[] }
audit.undo   { changeId } → { ok: true }
```

```ts
type AuditEntry = {
  id: string;
  createdAt: number;
  sessionId: string;          // 哪个 agent 会话干的 —— 多 agent 场景的关键
  namespace: string;          // "tabs" | "tab" | "management" | …
  method: string;
  args: unknown[];
  before: unknown;            // 变更前状态，用于撤销
  result?: unknown;
  undone?: boolean;
};
```

对齐 Codex `management.getAuditTrail()` 的设计并推广到**所有变更型操作**，并新增 `sessionId` —— 多个 agent 同时操作时，用户得能分清是谁改的。

---

## 4. 错误码

JSON-RPC 错误对象中，`error.data.buaCode` 携带机器可路由的错误码。

| buaCode | 含义 | agent 应对 |
|---|---|---|
| `BUA_PROTOCOL_VERSION` | 协议版本不匹配 | 升级扩展或桥 |
| `BUA_TAB_NOT_FOUND` | 标签不存在或已关闭 | 重新列标签 |
| `BUA_TAB_CLAIMED` | 标签已被其他会话接管 | 换标签或等释放 |
| `BUA_HANDLE_STALE` | 句柄失效（`locatorId` / `blobRef` / `snapshotId`） | 重新构造或重新观察 |
| `BUA_DEBUGGER_UNAVAILABLE` | `chrome.debugger` attach 失败（DevTools 占用，或企业策略拒绝） | 查 `capabilities.cdp`，走非 CDP 路径 |
| `BUA_NAVIGATION_TIMEOUT` | 导航超时 | 检查 `tab.url()` 再决定，不要盲目重试 |
| `BUA_UNSUPPORTED` | 后端不支持该方法，或对应能力已关闭 | 查 `capabilities`，走替代路径 |
| `BUA_MISSING_TARGET_DESCRIPTION` | 缺少必需的 `targetDescription` | 补上人类可读的目标描述后重试 |
| `BUA_INTERNAL` | 扩展内部错误 | 上报日志 |

**`BUA_DEBUGGER_UNAVAILABLE` 值得单独说明**：两种成因，处理方式不同。

1. **DevTools 抢占** —— `chrome.debugger` 一个标签同时只能有一个客户端。用户开着 DevTools 时 attach 会失败，此时应**优雅降级**而非报错退出。
2. **企业策略拒绝**（Chrome 155+）—— 管理员配置了 `runtime_blocked_hosts` / `DisableScreenshots` / DLP 时，attach 在**所有**目标上失败，且无法用 `runtime_allowed_hosts` 绕过。此时应切到 `chrome.scripting` 模式并在 `capabilities.cdp` 报 `false`。

两者都通过 `capabilities` 让 agent 感知，而不是让 agent 猜。


---

## 5. 变更型动作的强制字段（L3）

**这是 BUA 相对所有现有项目的核心差异。** 竞品调研结论：**几乎没有项目做「支付/提交类」的动作级识别** —— open-browser-use 的 `SECURITY.md` 只写了「应当确认 uploads / downloads / form submission / purchases / deletion」，但那是**建议，不是实现**。

### 5.1 `targetDescription`：人类可读的目标描述

所有 `write` 与 `destructive` 类动作**必须**携带 `targetDescription`。缺失时桥**拒绝**该调用（`BUA_UNSUPPORTED`）。

```jsonc
// ❌ 拒绝：坐标无法让人判断风险
{ "method": "cua.click", "params": { "tabId": "t_1", "x": 320, "y": 480 } }

// ✅ 接受：审批 UI 能展示人类可读的目标
{
  "method": "cua.click",
  "params": {
    "tabId": "t_1", "x": 320, "y": 480,
    "targetDescription": "结算按钮（￥299，含运费）"
  }
}
```

理由：**坐标本身无法让人判断风险，描述可以。** 这个设计的原型是 Playwright MCP 的 `browser_click` —— 它的 `element` 参数注释即 *"used to obtain permission"*。

### 5.2 动作风险三级分级

分级**在扩展侧硬编码**，**不信任 agent 传的任何 hint**（MCP 规范明确警告 tool annotations 不可信）。

| 级别 | 动作 | 审批 | 强制字段 |
|---|---|---|---|
| `read` | 截图、DOM/无障碍快照、列标签、读 URL/标题 | 免审批 | — |
| `write` | 点击、输入、滚动、选择、导航 | 按 origin 授权 | `targetDescription` |
| `destructive` | **提交表单、支付/结算、删除、发送消息、上传/下载文件、写剪贴板、关闭标签** | **每次必审批** | `targetDescription` + 审批 UI 展示 origin 与关键参数 |

> `destructive` 的识别不能依赖 agent 自律 —— 页面内容可能被提示注入污染。必须在扩展侧按「当前 tab 顶层 URL 的 origin + 动作类型 + 目标元素语义」判定。

### 5.3 TOCTOU 强校验

`page_info` / `dom_snapshot` 返回 `snapshotId`；后续动作必须携带它。**不匹配则拒绝（`BUA_HANDLE_STALE`）并要求 agent 重新观察。**

防止「观察」与「操作」之间页面变化导致的误操作 —— 现有项目普遍只靠 prompt 约束，没有协议级机制。

### 5.4 敏感字段占位符

agent 传占位符，**扩展侧替换为真实值再输入**：

```jsonc
{ "method": "locator.fill", "params": {
    "locatorId": "l_9", "value": "{{secret:github_password}}",
    "targetDescription": "密码输入框" } }
```

真实值**永不进入 agent 上下文**。这同时覆盖了 `browserAuth` 能力（对齐 Codex：凭据在扩展侧填入，值不穿过桥）。

---

## 6. 超时与心跳

| 项 | 默认 | 说明 |
|---|---|---|
| 心跳间隔 | 15 s | 扩展 → 桥 |
| 心跳超时 | 30 s | 超时判定扩展离线，挂起的调用以 `BUA_INTERNAL` 失败 |
| 单次调用超时 | 30 s | 桥侧；`tab.goto` 等长任务单独放宽到 90 s |
| 自动等待上限 | 30 s | Playwright 定位器的默认 `timeoutMs` |

长任务（导航、下载、`waitForEvent`）**不应**用短超时。这些方法支持显式 `timeoutMs` 参数覆盖。

---

## 7. 多 agent 与会话隔离

BUA 要同时服务多个 agent，规则：

1. **一个标签在一个时刻只属于一个会话**。`claimTab` 或 `tabs.new` 建立所有权
2. **新会话默认不能操作他人标签**，返回 `BUA_TAB_CLAIMED`
3. **会话结束释放所有标签所有权**（扩展侧监听 side panel 关闭 / 心跳超时）
4. **审计条目带 `sessionId`**，用户可追溯每个变更的来源
5. **用户始终优先**：用户在标签里手动操作时，agent 的输入可能被覆盖；扩展应检测并提示，而不是硬抢

> 第 5 条是设计难点。Codex 用 `requestManualHandoff()` 让 agent 主动交还控制权。BUA 采用相同机制，并额外在检测到用户输入时撤销 agent 的独占。

---

## 8. 待定项

| # | 问题 | 影响 | 来源 |
|---|---|---|---|
| 1 | 默认端口具体选哪个（避开 19387 / 3080 / 9222 等已占用） | 安装体验 | 自身 |
| 2 | 截图落盘目录（`~/.bua/blobs`？系统临时目录？） | 磁盘与隐私 | 自身 |
| 3 | `locatorId` 句柄的 TTL 与回收策略 | 内存泄漏风险 | 自身 |
| 4 | `browserAuth` 的凭据 UI 放在扩展 side panel 还是宿主页面 | 安全性与实现量 | 自身 |
| 5 | 协议是否需要二进制帧（`ArrayBuffer`）传大截图 | 性能 | 自身 |
| 6 | **`chrome.debugger` 与已打开的 DevTools 的冲突行为** | 决定降级逻辑 | 竞品调研附录 B |
| 7 | **能否 attach `chrome://` 页面与 OOPIF** | 决定能力边界声明 | 竞品调研附录 B |
| 8 | `host_permissions` 与 `debugger` 并存时 Chrome 的警告文案细节 | 影响 onboarding 措辞 | 竞品调研附录 B |
| 9 | WebMCP 的 `registration_id` 快照失效语义是否照抄 | TOCTOU 防护强度 | 竞品调研 §3.1 |
| 10 | 是否需要「profile 快照」补充模式（后台 headless，不抢用户窗口） | 与主路径互补，但需用户完全退出浏览器 | 竞品调研 §4.2 |

