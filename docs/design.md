# BUA — Browser Use Agent

**让任意 Agent 操作用户真实浏览器的通用能力层。**

BUA 是一个 Chrome MV3 扩展 + 本地桥 + 精简 SDK，把「控制浏览器」做成一个中立、可被任何 agent 复用的能力。API 面刻意对齐 OpenAI Codex 的浏览器 API，使已有针对 Codex 写的 agent 逻辑可以低成本迁移。

```
┌──────────────┐      MCP / HTTP / SDK      ┌──────────────┐    WebSocket     ┌──────────────┐
│  任意 Agent   │ ─────────────────────────▶ │  bua-server  │ ◀──────────────▶ │  BUA 扩展     │
│ (DSH/Codex/  │                            │  (本地桥)     │  127.0.0.1     │  (MV3)       │
│  Claude/自研) │ ◀───────────────────────── │              │                  │              │
└──────────────┘        工具调用结果          └──────────────┘                  └──────┬───────┘
                                                                                       │ chrome.*
                                                                                       ▼
                                                                            用户真实浏览器
                                                                        （真实标签页 / 登录态 / profile）
```

---

## 1. 为什么需要它

现有的浏览器 agent 方案分三类，各自有一个硬伤：

| 路线 | 代表 | 硬伤 |
|---|---|---|
| 独立浏览器自动化 | Playwright / Puppeteer | **没有用户的登录态**。要重新登录、过风控、扫验证码 |
| 外部 CDP 接入 | `--remote-debugging-port` + Puppeteer | Chrome **不允许在默认 user-data-dir 上开调试端口**，必须关闭浏览器用独立 profile 重启，等于放弃真实浏览器 |
| 浏览器扩展 | Codex 的 ChatGPT 扩展、Browser MCP | 方案本身对，但**要么闭源、要么绑定单一 agent**，无法复用 |

**BUA 走第三条路，但不绑定任何 agent。** 扩展通过 `chrome.debugger` 拿到完整 CDP 能力 —— 这个 attach 是从浏览器**内部**发起的，因此天然拥有用户的真实标签页、Cookie、登录态，**无需重启浏览器**。

### 一句话差异

> Playwright 让你操作「一个浏览器」。
> BUA 让你操作「用户的那个浏览器」。

---

## 2. API 设计：对齐 Codex

BUA 的 agent 侧 API **直接对齐 Codex 的 CUA API 面**。以下是逐个对照的映射表（Codex 侧签名来自本机 `api.json`，22 个接口 / 152 条声明）。

### 2.1 根对象与浏览器

| Codex | BUA | 说明 |
|---|---|---|
| `agent.browsers.get(id)` | ✅ 同名 | 按 id 取浏览器 |
| `agent.browsers.getDefault()` | ✅ 同名 | 取默认浏览器 |
| `agent.browsers.getForUrl(url)` | ✅ 同名 | 按 URL 选最合适的浏览器 |
| `agent.browsers.list()` | ✅ 同名 | 列出可用浏览器 |
| `browser.tabs.new()` | ✅ 同名 | 新建标签 |
| `browser.tabs.get(id)` / `list()` / `selected()` | ✅ 同名 | 标签管理 |
| `browser.tabs.content(options)` | ✅ 同名 | 后台标签批量取内容 |
| `browser.user.openTabs()` | ✅ 同名 | **列出用户真实打开的标签**（不接管） |
| `browser.user.claimTab(t)` | ✅ 同名 | **接管用户的一个标签** |
| `browser.user.getTabContext(t)` | ✅ 同名 | 只读用户标签的有限上下文 |
| `browser.history(options)` | ✅ 同名 | 浏览历史 |
| `browser.nameSession(name)` | ✅ 同名 | 命名自动化会话 |
| `browser.capabilities.*` | ✅ 同名 | 能力协商（见 2.5） |

### 2.2 Tab 与四种操作层次

Codex 为同一个标签提供了**四个不同抽象层次**的操作 API。BUA 全部保留 —— 这是这套设计最有价值的部分：让模型按任务精度选择，而不是只有一个按钮。

| 层 | Codex | 语义 | 何时用 |
|---|---|---|---|
| **Playwright** | `tab.playwright.*` | 语义定位器，最稳 | 默认首选 |
| **AX** | `tab.ax.*` | 无障碍树快照 + 元素索引 | 视觉确认 + 结构化读取 |
| **CUA** | `tab.cua.*` | 视口坐标级操作 | 无语义元素时的兜底 |
| **DomCUA** | `tab.dom_cua.*` | 可见 DOM 节点 id 操作 | 坐标不稳时的折中 |

**Tab 通用方法**（逐一对齐）：

`goto` `back` `forward` `reload` `close` `url()` `title()` `screenshot(options)` `getJsDialog()`
外加 Codex 的会话生命周期方法：`markDeliverable()` `markHandoff()` `requestManualHandoff()`

**`tab.playwright`** —— 完整 Playwright 语义子集：

- 构造器：`locator` `getByRole` `getByText` `getByLabel` `getByPlaceholder` `getByTestId` `frameLocator`
- 等待：`waitForLoadState` `waitForURL` `waitForTimeout` `waitForEvent("download"|"filechooser")` `expectNavigation`
- 检查：`domSnapshot()` `evaluate()` `elementInfo()` `elementScreenshot()`

**`tab.playwright.locator(...)`** —— 37 个方法，含
`click` `dblclick` `fill` `type` `press` `pressSequentially` `check` `uncheck` `setChecked`
`selectOption` `innerText` `textContent` `getAttribute` `allTextContents`
`isVisible` `isEnabled` `count` `waitFor` `filter` `and` `or` `first` `last` `nth`
`downloadMedia` `evaluate` `evaluateAll`

**`tab.ax`** —— 无障碍层：
`get(mode)` `write(mode)` `click(target)` `paste()` `typeText()` `pressKey()` `setValue()`
`selectText()` `scroll()` `drag()` `performSecondaryAction()`
（`mode` 为 `"state" | "screenshot" | "both"`）

**`tab.cua`**（坐标）：`click` `double_click` `move` `drag` `scroll` `type` `keypress` `downloadMedia`
**`tab.dom_cua`**（DOM）：`get_visible_dom()` `click` `double_click` `scroll` `type` `keypress` `downloadMedia`

**`tab.content`**：`export()` `exportGsuite(type)` `exportYouTubeTranscript()`

**`tab.clipboard`** / **`tab.dev`**（日志）/ **`tab.capabilities`**

### 2.3 我们相对 Codex 的**扩展**

对齐是基础，但 BUA 要服务任意 agent，所以补三块：

| 新增 | 为什么 |
|---|---|
| **多 agent 并存与会话隔离** | Codex 服务自己；BUA 要同时服务 DSH、Claude Code、自研脚本而不互相抢标签 |
| **能力探测与降级** | 契约里声明「本后端支持哪些能力」，agent 可据能力表写兼容代码而非猜 |
| **后端无关** | 同一套 agent API 背后可以是扩展、CDP、或 Playwright —— 换后端不动 agent 代码 |

### 2.4 明确定义**不做**的

- ❌ 不做**独立浏览器**自动化（那是 Playwright 的地盘）
- ❌ 不内置**模型推理**（BUA 不是 agent，是 agent 的手）
- ❌ 不实现**账号密码托管**（凭据永远不进 agent 上下文）
- ❌ 不做**验证码绕过**（明确不碰）

### 2.5 能力协商（Capability Negotiation）

Codex 的能力模型值得完整继承：能力是**可选、可探测、可带自己文档**的。

```
capabilities.list()            → string[]                       // 本后端支持哪些
capabilities.get(id)           → Capability                     // 取一个
capability.documentation()     → string                         // 它自己的文档
```

BUA 计划提供的能力 id（对齐 Codex 已有的 + 我们的增补）：

| Capability | 作用域 | 用途 |
|---|---|---|
| `cdp` | tab | 原始 CDP 逃生口（`send` / `readEvents`） |
| `browserAuth` | tab | 凭据安全填充，值不返回给 agent |
| `webmcp` | tab | 网站主动暴露的工具（W3C 提案） |
| `management` | browser | 窗口/标签组/书签整理，含**审计轨迹** |
| `pageAssets` | tab | 页面资源 |
| `botDetection` | tab | 风控信号探测 |
| `viewport` / `visibility` | browser | 视口与可见性控制 |
| **`bua.audit`** | browser | 🔸 我们的：所有变更型操作的可回滚记录 |
| **`bua.consent`** | browser | 🔸 我们的：域名级授权与敏感操作确认 |

---

## 3. 架构

### 3.1 分层

```
packages/
├── protocol/        # 唯一真源：类型、方法名、schema。其他包都依赖它
├── extension/       # Chrome MV3 扩展（控制节点）
├── server/          # 本地桥：ws 服务端 + Host 校验 + 会话路由
├── sdk/             # agent 侧 SDK：注入式 API，对齐 Codex 形状
├── mcp/             # MCP 适配器（可选）
└── cli/             # bua 命令行（启动桥、装扩展、配对）
```

**关键设计：`protocol` 是唯一真源。** 扩展、桥、SDK 三侧共享同一份方法名与 schema，避免三处各写一遍字符串导致漂移。

### 3.2 为什么桥是独立进程

不像 Codex 用 native messaging（需要注册表注册、`allowed_origins` 白名单），BUA 用**扩展主动连本地 WebSocket**：

| | native messaging | 本地 WebSocket |
|---|---|---|
| 安装成本 | 注册表 + host manifest | 无 |
| 跨平台 | 每平台各写一套 | 一套 |
| 任意 agent 复用 | 难（绑定宿主） | 易（连同一个 ws） |
| 安全 | OS 层隔离（文件系统权限） | **无隔离 —— 本机任何进程都能连** |

最后一行是本设计**刻意接受**的代价 —— 见 §4.0。选 WebSocket 的理由是它免去 native host 注册表与安装器（§5.3）。

### 3.3 传输协议

JSON-RPC 2.0 over WebSocket。见 `docs/protocol.md`。

```
→ {"jsonrpc":"2.0","id":1,"method":"tab.click","params":{...}}
← {"jsonrpc":"2.0","id":1,"result":{...}}
```

---

## 4. 安全模型

> **⚠️ BUA 的信任模型是「本机即信任」。**
> 这降低了部署门槛，也意味着**任何能访问本机回环地址的进程都能遥控用户的浏览器**。
> 这条必须在 onboarding 里如实告知。见 §4.1。

### 4.0 为什么不做鉴权（以及它带来的后果）

**设计决定**：扩展不做 token、不做证书、不签发任何授权凭据。任何 agent 都能直接连接桥。

理由：BUA 的目标是「让**任意** agent 都能用浏览器」——一旦引入授权凭据，每个 agent 都要集成配对流程，门槛就回来了。

**但必须说清代价。** 桥监听在回环上且无鉴权，因此：

| 谁能驱动浏览器 | 是否成立 |
|---|---|
| 用户主动启动的 agent | ✅ 预期行为 |
| 用户机器上的**任意**脚本 / 程序 | ⚠️ **同样成立** |
| 从公共网络访问的第三方 | ❌ **不成立**（仅绑回环 + Host 校验） |

**换句话说**：本机上的恶意软件本来就已拥有用户权限（能读 Chrome 的 profile 和 Cookie 文件），BUA 并没有授予它新的能力上限；但它确实**降低了一个门槛** —— 从「理解 Chrome profile 格式」降到「会发 WebSocket 消息」。

这是刻意接受的取舍，不是疏漏。因此 §4.2 的 onboarding 告知是**本设计中不可省略的一环**。

#### 仍然保留的一道防线：Host 头校验

唯一保留的传输层校验是 **Host 头必须是 `127.0.0.1:<port>` / `localhost:<port>`**。

理由：这**不限制任何 agent**（本机进程随便连），但能挡住 **DNS rebinding** —— 攻击者把域名解析到 `127.0.0.1`，让**用户浏览器里的恶意页面**去连本地桥。

这道校验不违反「不限制 agent」的目标，却是真实可挡的攻击面，所以保留。

> 注意它挡的是「浏览器发起的跨站请求」，不是「本机进程」。后者的信任由用户自行承担。

### 4.1 安全设计原则

#### L1 · 传输层

| # | 措施 | 说明 |
|---|---|---|
| 1 | **硬绑 `127.0.0.1`** | 不提供 `0.0.0.0` 选项。这是唯一阻止**远程**访问的措施 |
| 2 | **`Host` 头校验** | 只接受 `127.0.0.1:<port>` / `localhost:<port>`，否则 403。防 DNS rebinding，**不限制 agent** |
| 3 | ❌ **不做 token** | 见 §4.0 —— 刻意取舍 |
| 4 | ❌ **不做 `Origin` 校验** | 会排除非扩展客户端 = 限制 agent，与目标冲突 |
| 5 | **端口占用就报错** | ❌ **绝不** `killProcessOnPort`（强杀用户进程不可接受） |
| 6 | **多客户端并存** | ❌ **不**踢旧连接。各客户端独立会话 |
| 7 | **只追加审计日志** | 记 `{ts, sessionId, method, targetUrl, origin, result}` |

> 第 5、6 条是竞品调研发现的**行业反面教材**：Browser MCP（7.2k★）会强杀占用端口的任意进程，并用新连接踢掉旧连接。BUA 明确不做。

#### L2 · 能力协商（替代授权）

既然不限制 agent，就不需要「授权层级」。取而代之的是**如实的能力声明**：

- 桥在 `hello` 响应里返回 **`capabilities`** 对象，声明本后端**实际能做**什么
- 关键场景：**企业策略拒绝 `chrome.debugger.attach()` 时**（Chrome 155+），扩展降级到 `chrome.scripting` 模式，并在 capabilities 里如实报告 `cdp: false`
- agent 应写成「**先探测再使用**」，而不是假定能力存在

```jsonc
// 桥 → 扩展（hello 响应节选）
"capabilities": {
  "cdp": true,            // 关键：false 表示已降级，无 CDP 能力
  "screenshots": true,
  "fileUploads": false,
  "downloads": true,
  "evaluate": true        // 可关闭
}
```

⭐ **这个降级模式现有项目无一实现** —— 企业环境下它们直接不可用。

#### L3 · 动作层（信息性分级，非闸门）

动作风险分级**保留**，但定位变了：**不是拦截闸门，是给 agent 与用户的信息**。

| 级别 | 动作 | 含义 |
|---|---|---|
| `read` | 截图、快照、列标签、读 URL/标题 | 无副作用 |
| `write` | 点击、输入、滚动、选择、导航 | 改变页面状态 |
| `destructive` | 提交表单、支付/结算、删除、发送消息、上传/下载、写剪贴板、关标签 | **不可逆或影响外部系统** |

两个仍然有价值的机制：

**① `targetDescription` 强制字段**（所有 `write` / `destructive`）

坐标无法让人判断风险，描述可以。它进审计日志，让用户**事后能读懂 agent 干了什么**。

> 设计原型是 Playwright MCP 的 `browser_click` —— 其 `element` 参数注释即 *"used to obtain permission"*。

**② `snapshotId` TOCTOU 强校验**

`page_info` / `dom_snapshot` 返回 `snapshotId`，后续动作必须携带。不匹配则拒绝并要求重新观察。**这是防误操作，不是防 agent** —— 「观察」与「操作」之间页面变化会导致点错东西。

#### L4 · 凭据保护

`{{secret:name}}` 占位符：agent 传占位符，**扩展侧替换为真实值再输入**，真实值永不进入 agent 上下文。

这保护的不是「用户」而是「agent 的上下文」—— 防止凭据被写进会话日志、被模型记住、或在下次请求里泄露。

### 4.2 引导页（onboarding）—— 本设计的必需组件

既然风险已被刻意接受，**如实告知就是不可省略的一环**。

引导页必须在**扩展自己的 UI 内**（`sidePanel` / onboarding 页）完成，且：

| 必须包含 | 内容 |
|---|---|
| **能力说明** | 能读所有标签页内容、能截图、能代用户点击输入 |
| **风险披露** | 「任何能访问本机回环地址的程序都可以通过本扩展操作你的浏览器」 |
| **不可逆提示** | 提交表单 / 支付 / 删除等操作**无法撤销** |
| **调试横幅说明** | 附加期间 Chrome 顶部会常驻横幅，**用户关掉横幅会立即终止会话** |
| **主动同意** | 用户必须**主动点击**确认，不能只是「继续」按钮一闪而过 |

> 这条同时满足 Chrome Web Store 的 **Prominent Disclosure** 要求（官方明文：*"Disclosures in the Chrome Web Store description or inline installation page do not satisfy this requirement."*）。合规要求与诚实设计在这里是一致的。

#### 未来演进：引导页签发证书

**当前不做**，但引导页是这个能力的天然落点。将来若要收紧，最小改动路径是：

1. 引导页生成密钥对，私钥存 `chrome.storage.local`，**公钥**展示给用户
2. 桥侧持有对应私钥/凭据
3. `hello` 携带签名而非明文 token

好处是**无需改动其他任何一层** —— 协议已经是「一条 hello 消息」，加字段即可。保持这个可扩展性，是本设计不做 token 之外的额外收益。

### 4.3 审计轨迹

所有变更型操作记录「操作 + 变更前状态」+ `sessionId` + `targetDescription`。

无鉴权之下审计**更重要**了 —— 它是用户唯一的追溯手段。用户得能回答：

- **是谁**改的（`sessionId`）
- **改了什么**（方法 + 参数 + 变更前状态）
- **当时想干什么**（`targetDescription`）

### 4.4 信任边界声明

> **BUA 把用户的真实浏览器暴露给本机任意调用方。它不是沙箱。**
> 能访问本机用户账号的进程 = 能访问浏览器自动化通道。

这条要写进 README 与引导页，不能含糊。**诚实的边界声明比虚假的安全感更有价值。**



---

## 5. 上架策略

> 本节结论来自 `research/02-store-policy.md`，其中所有政策引文均**逐字抓取 Google 官方文档**核对，非第三方转述。

### 5.0 核心结论：能做，而且 `debugger` 是官方**明文允许**的

这是整个上架策略的基石 —— Google 在 MV3 附加要求里把 **Debugger API 列为「允许远程执行逻辑」的两个例外 API 之一**：

> "Execution of logic from a remote source is permissible only when accomplished through a documented API that explicitly allows this practice... The permitted APIs for such remote execution are: 1. **Debugger API** 2. User Scripts API"

这直接决定了 BUA 的核心架构**合规**：扩展通过 WebSocket 接收 agent 指令 → 调用 `chrome.debugger.sendCommand` 执行，落入该白名单。

对照：**同样的事情如果不走 Debugger API 就是违规的** —— 官方明文禁止"从远端拉指令当数据、自己写解释器执行（even if those commands are fetched as data）"。所以 BUA **绝不能**自己实现一个指令解释器，必须让所有远程下发的能力落在 Debugger API 上。

### 5.1 🔴 三个必须遵守的硬约束

**① Remote Code 字段必须申报为「Yes」**

> "Extensions that call remote code and **do not declare and justify it** using the field shown above **will be rejected**."

用 `debugger.sendCommand` 执行 agent 下发的 `Runtime.evaluate` 实质上就是执行远程代码。虽然在允许之列，但**必须在 Dashboard 的 Remote Code 字段选 Yes 并说明理由**。谎选 No 被发现 = 直接拒审。

**② 不要申请 `<all_urls>` —— 它是纯冗余**

官方明文：

> "In some special cases, host permissions are **not** required. These include: ... **Interacting with the browser using the `chrome.debugger` API.**"

`debugger` **自带**"访问所有网站"的能力（这也是它触发 *"Read and change all your data on all websites"* 警告的原因）。再申请 `<all_urls>` 只会招致更严审查 —— 官方明确说 *"Requesting broader permissions than necessary may cause your extension to be rejected."*

**③ 声明的权限必须真实使用**

`Purple Potassium` 违规 = "请求了但没用到该权限"。若 manifest 里声明了 `debugger`，代码里就必须真的调用它。

### 5.2 权限方案（据调研修订）

| 权限 | 默认 | 用途 | 依据 |
|---|---|---|---|
| `activeTab` | ✅ | 当前标签的基础访问 | 核心功能 |
| `tabs` | ✅ | 列标签、`user.claimTab` | 核心功能 |
| `sidePanel` | ✅ | 用户面板与**显著披露同意界面** | 合规必需 |
| `storage` | ✅ | 配置持久化（含 onboarding 已确认标记） | 基础 |
| `debugger` | ✅ **核心** | CDP 能力：真实输入事件、截图、跨 iframe 一致控制 | 官方白名单例外 |
| `scripting` | ⚠️ 仅当确有非 debugger 兜底路径 | DOM 快照的轻量路径 | 用了才声明 |
| ~~`<all_urls>`~~ | ❌ **不申请** | debugger 不需要 host permission | §5.1 ② |
| ~~`nativeMessaging`~~ | ❌ **v0 不申请** | 见 §5.3 | 避免必须附带安装器 |

### 5.3 深化决定：**放弃 native messaging，坚持 WebSocket**

调研给出了一个原本没预料到的连锁约束：

> Windows 上 native messaging host 必须写注册表（`HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>`），且 `allowed_origins` **不能含通配符**，必须是固定的 `chrome-extension://<扩展ID>/`。

由此推出：**native messaging 无法在浏览器内安装 host，必须有 NSIS/MSI 安装器写注册表** —— 「装扩展」变成「装扩展 + 装桌面程序」，分发体验成本极高；且扩展 ID 必须用 manifest 的 `key` 字段固定，否则开发/上架两套 ID 都要维护。

**这与 BUA 的设计目标（降低门槛、任意 agent 复用）直接冲突。** 因此 v0 确定：

- **传输用本地 WebSocket**，不注册 native host
- 代价是**无隔离** —— 本机任意进程都能连（见 §4.0），换来「只装一个扩展」
- 附带好处：同机进程间传输**不受**「用户数据传输必须加密」条款约束 —— 官方明文 *"The requirement to handle the user data securely does not apply to transmissions between a Chrome extension or app and a native program on the same computer."*

### 5.4 🔴 最硬的 UX 约束：调试横幅

> "While it is being used, the user will see a warning bar at the top of the window. **If the banner is closed or dismissed, the debugging session will be terminated.**"

这条比任何审核问题都更影响产品形态：

- **用户随时可以一击终止会话** —— 产品必须能被随时打断，且要能优雅恢复
- 调试横幅**无法关闭、无法隐藏**
- 这条也是 BUA 相对独立浏览器方案（Playwright）的根本代价：真实浏览器 + 真实登录态，换来一条常驻横幅

**产品必做**：在 onboarding 里明确解释这条横幅是什么、为什么在、关掉会发生什么。

### 5.5 企业环境（Chrome 155+）

Chrome 155（2026-10-06 stable）起，管理员若配置了 `runtime_blocked_hosts`、`DisableScreenshots` 或 DLP 规则，`attach()` 会**在所有目标上失败**，且**不能用 `runtime_allowed_hosts` 绕过**（官方理由是 CDP 位于 origin 模型之下，origin 级过滤无法安全约束它，故采用 all-or-nothing）。

**仅影响受管浏览器**；未受管浏览器完全不受影响。

> 本机实测：Chrome **154**（低于 155），且 `HKCU`/`HKLM` 下**无任何 Chrome 策略** ⇒ 当前不受此限制。

### 5.6 隐私合规要点

触发条件：BUA 会读 DOM、截图、**读取并操作浏览内容** ⇒ **必须**隐私政策。

关键要求：

- **显著披露 + 明确同意（Prominent Disclosure）**：必须在**扩展自己的 UI 内**（onboarding / side panel）让用户主动点击同意，逐项列出会读什么、发给谁。**仅放隐私政策链接不合格** —— 官方明文 *"Disclosures in the Chrome Web Store description or inline installation page do not satisfy this requirement."*
- **Limited Use 六条**：数据只能用于已披露的单一用途；**禁止让人类读取用户数据**（除非获得对特定数据的显式同意）
- **禁止**将 web 浏览活动数据用于已披露功能之外的目的
- 需要在扩展所属网站上放置**肯定性声明**："The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."

### 5.7 审核预期与退路

- **首次提交 + 敏感权限 ⇒ 人工审核**，官方口径「几天到几周」，建议预算 **1–3 周**
- 若被拒或不愿承担不确定性，退路按推荐度：
  1. **Edge Add-ons** —— 隐私面板字段与 Chrome 几乎一致，材料可复用，边际成本最低
  2. **企业自托管**（`ExtensionInstallForcelist`）—— 免商店审核
  3. **开发者模式分发** —— 零审核但体验差
  4. ~~Firefox AMO~~ —— **不可行**，Firefox 无 `chrome.debugger` 等价 API


---

## 6. 竞品洞察与差异化

完整报告见 [`research/01-competitors.md`](../research/01-competitors.md)。

### 6.1 BUA 路线的定位优势：零本地 CDP 端口

调研覆盖了全部「拿到用户真实浏览器」的已知方案，结论是**扩展 + `chrome.debugger` 在「安全性」与「真实登录态」两项上同时最优**：

| 方案 | 真登录态 | 本地端口 | 关键问题 |
|---|---|---|---|
| **扩展 + `chrome.debugger`**（← BUA） | ✅ | **无 CDP 端口** | 需要 `debugger` 权限警告 |
| 扩展 + 本地 WebSocket | ✅ | 有（本设计不鉴权，见 §4.0） | 本机任意进程可驱动 |
| `--remote-debugging-port` | ✅ | **有，且无认证** | Chrome 136+ 对默认 profile **静默失效**；144+ 每次连接弹窗 |
| Chrome for Testing | ❌ | 有 | 不是用户的浏览器 |
| profile 快照 | ⚠️ 登录可能失效 | 有 | 需用户完全退出浏览器 |
| 二进制补丁 | ✅ | 有 | 破坏签名、更新即失效、杀软可疑 |

**关键区别**：BUA 不需要在 `127.0.0.1` 上开 **CDP 端口**。它自己的桥仍监听本地端口（扩展要连它），但那个端口讲的是 BUA 协议**而非 CDP** —— 攻击者不能对着它发任意 `Runtime.evaluate` 之外的东西，且能力受 BUA 方法面约束（这仍不是隔离，见 §4.0）。

对比之下，开在真实 profile 上的 CDP 端口等于把**完整 CDP** 交给任何本机进程。

### 6.2 调研发现的三个行业空白

| # | 空白 | 现状 | BUA 的取舍 |
|---|---|---|---|
| 1 | 本地桥握手鉴权 | ⭐ **全行业没有**。Browser MCP 无 token 无校验；mcp-chrome Roadmap 未完成；open-browser-use 自述仅「计划中」 | ⚠️ **刻意不采用** —— 与「不限制 agent」冲突。以 onboarding 告知替代，见 §4.0/§4.2 |
| 2 | 动作风险分级 | 竞品**无一实现**，open-browser-use 仅在 SECURITY.md 提建议 | ✅ **采用**，但定位为**信息性**而非闸门（§4.1 L3） |
| 3 | 无 CDP 降级模式 | **现有项目无一实现**，企业策略下直接不可用 | ✅ **采用** —— 这是本设计最被低估的差异化（§4.1 L2） |

> 第 1 项从「差异化」变为「刻意放弃」，是 2026-10-12 产品决策的结果：降低门槛优先于本机隔离。**但第 3 项的价值反而更突出了** —— 在无鉴权的信任模型下，「后端实际能做什么」比「谁被允许做什么」更关键。

### 6.3 值得采纳的既有共识

调研发现三个已成共识的设计，BUA 应当对齐而非重新发明：

1. **显式 `tabId` 路由**（chrome-devtools-mcp 的 `--pageIdRouting` 默认开启，专为并发 agent session 设计）—— 优于隐式 current-tab
2. **session TTL + 后台清理**（browser-use 的 `session_timeout_minutes` + `cleanup_loop`）
3. **tab group 作可视锚点 + `chrome.storage.local` 持久化** —— 对抗 MV3 service worker 被杀（open-browser-use 存 tab group id / origins / active tab id）

另外 **WebMCP 支持已成共识**：open-browser-use 有 `webmcp_list_tools` / `webmcp_invoke_tool`，chrome-devtools-mcp 也有对应工具。其 `registration_id` 的**快照失效语义**值得照抄作 TOCTOU 防护。

### 6.4 时间窗口

最同构的对手 **open-browser-use 仅 365 stars**（MIT），自我定位与本项目几乎相同（*"an open-source alternative to the Chrome Browser Use capability recently shipped in Codex.app"*），架构参考价值极大，**但尚未形成生态壁垒**，且自述安全模型空白：

> *"The SDKs and CLI do not implement a Codex-style site policy, command allowlist, or user approval workflow"*

窗口是开的。

### 6.5 明确不采纳的路线

| 路线 | 为什么不做 |
|---|---|
| `--remote-debugging-port` 开在真实 profile | CDP 端口无认证；Chrome 136+ 对默认 profile 静默失效 |
| 二进制补丁（patch-browser） | 破坏代码签名、更新即失效、需管理员权限、杀软/EDR 高度可疑 |
| `--remote-allow-origins=*` | 等于放行任意来源 |
| `killProcessOnPort` | 强杀用户进程，不可接受 |
| 「新连接踢旧连接」 | 破坏多 agent 并发前提 |
| native messaging 作为默认传输 | 强制附带写注册表的安装器，与「只装一个扩展」冲突（§5.3） |


---

## 7. 路线图

### M0 — 可行性验证（已完成 ✅）
- [x] 证明 `chrome.debugger` 路线可行（CDP 全链路实测：读 DOM / 点击 / 真实键盘鼠标事件注入 / 截图）
- [x] 抠出 Codex 完整 API 面作为对齐基准（22 接口 / 152 声明）
- [x] 竞品与上架政策调研

### M1 — 最小可用（MVP）
- [ ] `protocol`：定义方法名、类型、错误码
- [ ] `extension`：MV3 骨架 + **onboarding 风险告知页** + side panel + `chrome.debugger` attach
- [ ] `server`：ws 服务端 + Host 校验 + 单会话
- [ ] `sdk`：`agent.browsers` / `browser.tabs` / `tab.goto` / `tab.screenshot` / `tab.playwright.locator` 核心子集
- [ ] **端到端实测**：一个真实 agent 完成「打开页面→读内容→点击→截图」

### M2 — API 面补齐
- [ ] `tab.ax` 全量 + DOM 快照注入
- [ ] `tab.cua` / `tab.dom_cua`
- [ ] `capabilities` 协商机制落地
- [ ] `browser.user.claimTab` + `openTabs`

### M3 — 能力与稳健性
- [ ] **无 CDP 降级模式**（核心差异化）：企业策略拒绝 `attach()` 时降级到 `chrome.scripting`，并在 `capabilities.cdp` 如实报 `false`
- [ ] 显式 `tabId` 路由（对齐 chrome-devtools-mcp `--pageIdRouting`）
- [ ] session TTL + 后台清理
- [ ] tab group 可视锚点 + `chrome.storage.local` 持久化（抗 MV3 service worker 被杀）
- [ ] 动作风险分级 + `targetDescription` 强制字段 + 审计日志（含 `sessionId`）
- [ ] 敏感字段占位符（`{{secret:name}}`）
- [ ] TOCTOU 强校验（`snapshotId`）
- [ ] `browserAuth` 能力
- [ ] MCP 适配器
- [ ] WebMCP 工具发现与调用（`webmcp_list_tools` / `webmcp_invoke_tool`，含 `registration_id` 快照失效）


### M4 — 上架准备
- [ ] manifest 加 `"key"` 固定扩展 ID、`minimum_chrome_version: "125"`
- [ ] 扩展 UI 内的显著披露 + 主动同意界面（合规硬要求）
- [ ] 隐私政策 + 扩展网站上的 Limited Use 肯定性声明
- [ ] Dashboard：**Remote Code 字段选 Yes 并说明理由**；逐条填写权限 justification
- [ ] 打磨单用途描述，确保「narrow and easy to understand」
- [ ] 检查打包产物无远端 `https://` import（防 `Blue Argon`）
- [ ] 提交 Chrome Web Store；随后以同套材料提交 Edge Add-ons

### M5 — 生态分发（对齐 open-browser-use 的四件套）
- [ ] CLI + JS/Python SDK
- [ ] MCP server（stdio）
- [ ] agent skill + `AGENTS.md`


---

## 8. 未决问题

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| 1 | `chrome.debugger` 能否通过 Chrome Web Store 审核？ | **能。** 官方把 Debugger API 明文列为允许远程执行逻辑的两个例外 API 之一。见 §5.0 | ✅ 已解决 |
| 2 | `<all_urls>` 是否必须用 `optional_host_permissions`？ | **都不需要。** `chrome.debugger` 不需要 host permission，申请它是纯冗余且会招致深度审查。见 §5.1 ② | ✅ 已解决 |
| 3 | DOM 操作走 `scripting` 注入还是必须 `debugger`？ | **核心走 `debugger`**（真实输入事件 `Input.*`、截图、跨 iframe 一致控制是 `scripting` 做不到的，这正是过审的辩护理由）。`scripting` 仅在确有轻量兜底路径时才声明 | ✅ 已解决 |
| 4 | 是否需要 native messaging 处理「扩展未运行」的场景？ | **v0 确定不用。** native messaging 强制要求附带注册表写入的安装器，与「只装一个扩展」的目标冲突。见 §5.3 | ✅ 已解决 |
| 5 | 多浏览器（Edge/Brave）支持优先级 | **Edge Add-ons 排第二**：隐私面板字段与 Chrome 几乎一一对应，材料可复用，边际成本最低。Firefox **不可行**（无 `chrome.debugger` 等价 API） | ✅ 已解决 |

### 新产生的待办（由上架约束推导）

| # | 待办 | 触发条件 |
|---|---|---|
| A | manifest 加 `"key"` 字段固定扩展 ID | 需要跨「开发 / 上架」保持 ID 一致时；也便于未来若改用 native messaging |
| B | `minimum_chrome_version: "125"` | flat sessions 跨 OOPIF 所需（官方标注 125+） |
| C | 单用途（single purpose）描述需「narrow and easy to understand」 | 提交前必须打磨，过宽会被拒 |
| D | 扩展 UI 内的**显著披露 + 主动同意**界面 | 隐私合规硬要求，不能只放隐私政策链接 |
| E | 扩展所属网站上的 Limited Use 肯定性声明 | 隐私合规硬要求 |
| F | 确认打包产物里没有指向远端的 `https://` import | 否则触发 `Blue Argon`（RHC）违规 |
| G | 实测 Edge 是否支持 `chrome.debugger` | Edge 文档为 JS 渲染未抓到明文，技术上几乎必然支持，但需实测确认 |


---

## 9. 命名与许可

- 项目名 **BUA**（Browser Use Agent），仓库 `bua`
- 目标许可：**MIT**（与生态一致，降低采用门槛）
- 参考实现：OpenAI Codex 浏览器扩展（API 形状对齐，无代码复用）

---

## 10. 官网（`docs/`）视觉约定

官网是纯静态 HTML + 一份 `styles.css`，由 GitHub Pages 从 `docs/` 发布。以下约定用于避免版式漂移：

- **一个版心**：正文、页头、页脚统一 `min(100% - 48px, 760px)`，移动端统一 `calc(100% - 40px)`，三者左缘对齐。不要把页头/页脚加宽到正文之外。
- **不使用 eyebrow / kicker 小标签**：h1 直接承接页面主题，其下是导语段落。曾试过在 h1 上方加「开源 · MIT · Chrome MV3」一类小字标签，视觉上多一层噪音，中文小字号 + 大字距也不易读，已弃用。若未来想恢复，先在此记录理由并同步调整 `styles.css`，不要只在单页里临时加。
- **页头导航保持最小**：只放「安装扩展」和「GitHub」；子页可加「首页」。当前页不自链，也不在页头放第三方产品（如 DeepSeek Harness）的入口——集成方式放在正文的接入表和页脚里，避免页头变成产品目录。
- **标题层级**：每页恰好一个 h1；区块用 h2，FAQ 的每个问题用 h3。
- **图像**：社交分享图统一 1200×630 PNG（`docs/og-image.png`），并在 `og:image`、`twitter:image` 中使用绝对 URL。
- **配色与字体**：只使用 `styles.css` 顶部的 CSS 变量（`--bg` / `--fg` / `--dim` / `--accent`），字体为 Outfit + 系统中文字体回退。
