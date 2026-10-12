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
| 安全 | OS 层隔离 | **必须自己做 token 鉴权** |

代价是最后一行。Token 因此是硬需求，见 §2。

---

## 2. 配对与鉴权

### 2.1 威胁

桥监听在回环上，**本机任何进程都能连**。若无鉴权，任何本地程序都能借 BUA 遥控用户浏览器 —— 这与 BUA 自身的权限等级相同，等同于把浏览器交给未知进程。

### 2.2 配对流程

```
1. bua-server 启动
2. 生成 32 字节高熵 token（crypto.randomBytes）
3. 写入 $BUA_HOME/pairing.json，权限设为「仅当前用户可读」
   { "version": 1, "token": "<hex>", "port": <port>, "createdAt": <ms> }
4. 打印配对引导（含 token 指纹，不含 token 明文）：
     bua: 桥已就绪  端口 17432  token 指纹 3f9a…
     在扩展中点「配对」并粘贴 token
5. 用户在扩展 side panel 粘贴 token
6. 扩展侧保存（chrome.storage.local，可选用 WebCrypto 加密）
```

### 2.3 握手

连接建立后，扩展**必须**在 `hello` 中携带 token。校验失败立即断开，**不返回任何可用于区分「token 错误」与「服务不存在」的信息**。

```jsonc
// 扩展 → 桥
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "bua.hello",
  "params": {
    "protocolVersion": "v0",
    "token": "<hex>",
    "client": {
      "extensionId": "…",
      "extensionVersion": "0.1.0",
      "chromeVersion": "154.0.8037.99",
      "capabilities": ["cdp", "management", "bua.audit", "bua.consent"]
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
    "grant": { "level": "read", "origins": [], "expiresAt": null },
    "capabilities": {
      "cdp": true,
      "fileUploads": false,
      "downloads": false
    }
  }
}
```

**鉴权失败的响应**：桥关闭连接（code `4001`），不回 JSON-RPC 错误体。

### 2.4 传输层强制校验（L1）

三条**必须**在 WS upgrade 阶段完成，任一不合格一律 `403` 且不建立连接：

| # | 校验项 | 规则 | 依据 |
|---|---|---|---|
| 1 | **绑定地址** | 硬绑 `127.0.0.1`，**不提供** `0.0.0.0` 选项 | MCP 规范 SHOULD |
| 2 | **`Origin` 头** | 只接受 `chrome-extension://<扩展ID>` 与显式的本地客户端来源 | MCP 规范 **MUST**（防浏览器发起的攻击） |
| 3 | **`Host` 头** | 只接受 `127.0.0.1:<port>` / `localhost:<port>` | **防 DNS rebinding**，不可用 `*` 关闭 |

**明确不做**：

- ❌ `killProcessOnPort` —— 端口被占用就报错并提示用户换端口，**绝不强杀用户进程**
- ❌ 踢旧连接 —— 多客户端并存，各自独立会话
- ❌ 无 token 的裸监听

> 这三条是竞品调研中发现的**行业反面教材**：Browser MCP（7.2k★）开 `9009` 无 token、无 Origin 校验，且会强杀占用该端口的进程、新连接直接踢掉旧连接。BUA 明确不做。

### 2.5 授权层级

对齐 Codex 的授权语义，并扩展到域名与时限：

```ts
type Grant = {
  level: "none" | "read" | "interact" | "restricted-interact" | "full";
  origins: string[];          // 空数组 = 未授予任何域名
  expiresAt: number | null;   // Unix ms；null = 无期限
};
```

| level | 可做 |
|---|---|
| `none` | 只能看到「有这些标签」（标题/URL 可选脱敏），不能读内容 |
| `read` | 读 DOM / 截图 / 无障碍树，不能点击输入 |
| `interact` | 可点击、输入、导航 |
| `restricted-interact` | 上述 + 敏感操作逐次确认（**默认档**） |
| `full` | 无逐次确认 |

超出授权范围的操作返回 `BUA_ORIGIN_DENIED` / `BUA_GRANT_INSUFFICIENT`。

---

## 3. 方法契约

命名空间按「作用域」划分，避免巨型方法名。

### 3.0 桥管理

| 方法 | 说明 |
|---|---|
| `bua.hello` | 握手与鉴权（§2.3） |
| `bua.heartbeat` | 心跳。扩展 → 桥，桥需在 `2 × heartbeatMs` 内收到 |
| `bua.goodbye` | 主动断开 |
| `bua.pair.reset` | 重置 token（仅本地 CLI，不经 ws） |

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
| `BUA_UNAUTHORIZED` | token 无效（一般不返回，直接断连） | 重新配对 |
| `BUA_GRANT_INSUFFICIENT` | 授权层级不够 | 请求用户提权 |
| `BUA_ORIGIN_DENIED` | 域名不在白名单 | 请求用户加白 |
| `BUA_CONSENT_REQUIRED` | 敏感操作需确认 | 发起确认流程，等用户 |
| `BUA_CONSENT_DECLINED` | 用户拒绝 | 停止，不要重试 |
| `BUA_TAB_NOT_FOUND` | 标签不存在或已关闭 | 重新列标签 |
| `BUA_TAB_CLAIMED` | 标签已被其他会话接管 | 换标签或等释放 |
| `BUA_HANDLE_STALE` | 句柄失效 | 重新构造定位器 |
| `BUA_DEBUGGER_UNAVAILABLE` | `chrome.debugger` attach 失败（可能被 DevTools 占用） | 降级到非 debugger 路径 |
| `BUA_NAVIGATION_TIMEOUT` | 导航超时 | 检查 `tab.url()` 再决定 |
| `BUA_UNSUPPORTED` | 后端不支持该能力 | 查能力表，走替代路径 |
| `BUA_INTERNAL` | 扩展内部错误 | 上报日志 |

**`BUA_DEBUGGER_UNAVAILABLE` 值得单独说明**：`chrome.debugger` 一个标签同时只能有一个客户端。用户开着 DevTools 时会抢占，此时应优雅降级而不是报错失败。

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

