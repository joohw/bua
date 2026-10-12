# BUA — Browser Use Agent

**让任意 Agent 操作用户真实浏览器的通用能力层。**

BUA 是一个 Chrome MV3 扩展 + 本地桥 + 精简 SDK，把「控制浏览器」做成一个中立、可被任何 agent 复用的能力。API 面刻意对齐 OpenAI Codex 的浏览器 API，使已有针对 Codex 写的 agent 逻辑可以低成本迁移。

```
┌──────────────┐      MCP / HTTP / SDK      ┌──────────────┐    WebSocket     ┌──────────────┐
│  任意 Agent   │ ─────────────────────────▶ │  bua-server  │ ◀──────────────▶ │  BUA 扩展     │
│ (DSH/Codex/  │                            │  (本地桥)     │   token 鉴权      │  (MV3)       │
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
├── server/          # 本地桥：ws 服务端 + token + 会话路由
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
| 安全 | OS 层隔离 | **需要自己做 token 鉴权** |

代价就是最后一行 —— 因此 token 是硬需求，不是可选项。详见 §4。

### 3.3 传输协议

JSON-RPC 2.0 over WebSocket。见 `docs/protocol.md`。

```
→ {"jsonrpc":"2.0","id":1,"method":"tab.click","params":{...}}
← {"jsonrpc":"2.0","id":1,"result":{...}}
```

---

## 4. 安全模型

这是整个项目**最需要认真对待**的部分。一个能读你所有标签页、Cookie、并代你点击的组件，权限等级等同于「遥控你的浏览器」。

### 4.0 ⚠️ 先纠正一个错误认知：origin 白名单不是安全边界

设计初期我把「域名白名单」当成主要安全机制。**竞品调研证明这是错的**，三方独立来源都承认 URL 级白名单不可靠：

| 来源 | 原文 |
|---|---|
| Playwright MCP 官方注释 | `--allowed-origins` *"does not serve as a security boundary and does not affect redirects"* |
| chrome-devtools-mcp | 拒绝含 regexp group 的 pattern，理由是「在重定向和子资源上无法强制执行」 |
| **Chrome 155 官方博客** | *"Because CDP operates beneath the web platform's origin model, **origin-based filtering cannot securely restrict it**"* |

**原因是结构性的**：CDP 位于 Web 平台 origin 模型**之下**。一旦 `attach()` 成功，就能读到该 tab 的一切（含跨域 iframe 内容），并对任意 origin 发起导航。白名单只能约束**我们自己代码愿意检查的东西** —— 它不是一道墙，是一个自觉。

> 所以本项目的定位必须说清楚：**origin 白名单是用户体验工具和纵深防御的一层，不是安全边界。真正的闸门是扩展侧的动作级校验。**

### 4.1 分层机制

#### L1 · 传输层（防本机劫持 + DNS rebinding）

| # | 措施 | 说明 |
|---|---|---|
| 1 | **硬绑 `127.0.0.1`** | 不提供 `0.0.0.0` 选项。（MCP 规范 SHOULD） |
| 2 | **强制 `Origin` 校验** | WS upgrade 时校验，允许值 = `chrome-extension://<我们的扩展ID>` + 显式本地客户端来源；不合法一律 403。（MCP 规范 **MUST**） |
| 3 | **强制 `Host` 头校验** | 只接受 `127.0.0.1:<port>` / `localhost:<port>`，其余 403 —— **这是防 DNS rebinding 的关键**，且不可用 `*` 关闭 |
| 4 | **握手 token（≥256 bit）** | 桥启动时生成，写入仅当前用户可读的文件（`~/.bua/bridge.json`）。校验失败**立即断开、记审计、限速**。⭐ **这是业界空白，BUA 的核心差异化** |
| 5 | **不做 `killProcessOnPort`** | 端口占用 → 报错并提示用户换端口。**绝不强杀用户进程** |
| 6 | **不踢旧连接** | 多客户端并存，各自独立会话。不搞「新连接踢旧连接」 |
| 7 | **只追加审计日志** | 所有动作记 `{ts, sessionId, method, targetUrl, origin, approvedBy, result}` |

**为什么 4–6 要写这么细**：这三条是现有项目的**反面教材**。Browser MCP（7.2k★）开 `9009` 端口**无 token、无 Origin 校验**，而且 `killProcessOnPort(9009)` 会**强杀用户机器上占用该端口的任意进程**，新连接还会直接把旧连接 `ws.close()` 踢掉。mcp-chrome（12.5k★）的 README Roadmap 里 **`- [ ] Authentication` 至今未完成**。

#### L2 · 授权层（谁能调、能调什么）

| # | 措施 | 说明 |
|---|---|---|
| 8 | **per-session origin 白名单** | 会话建立时声明；**每次 tab-scoped 动作前校验当前 tab 顶层 URL 的 origin**，`navigate` 校验**目标 URL** |
| 9 | **扩展内可视授权 UI** | 按 origin 允许/拒绝/一次性，可撤销。**不要把授权只放在配置文件里** —— 用户改不动就等于没有 |
| 10 | **`localhost` 自动放行需谨慎** | 本地服务常是用户自己的 dashboard，但也是 SSRF 目标。默认放行但**可关** |
| 11 | **能力开关** | 抄 Codex 的 `capabilities.fileUploads` / `.downloads` / `.mediaDownloads`：在 `getInfo` 里声明，命令执行前先校验 |
| 12 | **无 CDP 降级模式** | `attach()` 失败（尤其 Chrome 155 的政策错误串）→ 降级到 `chrome.scripting` + `chrome.tabs`，并**在 capabilities 里如实声明**可用子集。⭐ **现有项目无一实现** |

#### L3 · 动作层（防误操作与提示注入）

| # | 措施 | 说明 |
|---|---|---|
| 13 | **动作风险三级分级** | 扩展侧**硬编码**，**不信任 agent 传的 hint**（MCP 规范明确警告 tool annotations 不可信）。见下表 |
| 14 | **审批信息嵌进 action schema** | ⭐ 所有 `write`/`destructive` 动作**必须**携带人类可读的目标描述字段 `targetDescription`。坐标无法让人判断风险，描述可以 —— 抄 Playwright MCP `browser_click` 的 `element` 参数（其注释即 *"used to obtain permission"*） |
| 15 | **敏感字段占位符** | agent 传 `{{secret:github_password}}`，**扩展侧替换为真实值再输入**，真实值永不进入 agent 上下文 |
| 16 | **TOCTOU 强校验** | `page_info` / `dom_snapshot` 返回 `snapshotId`；后续动作携带它，**不匹配则拒绝并要求重新观察** |
| 17 | **不做 `networkidle` 等待** | 不可靠（Codex 显式拒绝该模式），改用显式条件等待 |
| 18 | **`evaluate` 可关闭** | 关闭时禁止 `javascript:` / `data:` 导航 |
| 19 | **明确不做** | 不开本地 CDP 端口；不做二进制补丁；不提供 `--remote-allow-origins=*` |

**动作风险分级表**（L3-13）：

| 级别 | 动作 | 审批策略 |
|---|---|---|
| `read` | 截图、DOM/无障碍快照、列标签、读 URL/标题 | **免审批**（对标 MCP `readOnlyHint`） |
| `write` | 点击、输入、滚动、选择、导航 | 按 origin 授权即可 |
| `destructive` | **提交表单、支付/结算、删除、发送消息、上传/下载文件、写剪贴板、关闭标签** | **每次必审批**，且审批 UI 必须展示：人类可读目标描述 + 目标 origin + 关键参数 |

> `destructive` 的识别**必须在扩展侧**，不能靠 agent 自律。open-browser-use 的 `SECURITY.md` 写了「Integrations should confirm uploads, downloads, ... form submission, purchases, deletion」—— 但那是**建议，不是实现**。BUA 要把它做成机制。

### 4.2 授权层级

```
none                 → 只能看到「有这些标签」，读不到内容
read                 → 可读 DOM / 截图 / 无障碍树
interact             → 可点击、输入、导航
restricted-interact  → 上述 + 破坏性动作逐次确认（默认档）
full                 → 无逐次确认
```

每个授权可限定 origin 范围与 TTL。**但见 §4.0：这是 UX 与纵深防御，安全靠 L3 的动作级闸门。**

### 4.3 审计轨迹

继承 Codex 的 `management.getAuditTrail()` 并推广到**所有变更型操作**：每次变更记录「操作 + 变更前状态」+ **`sessionId`**，使撤销与追责都成为可能。

多 agent 场景下 `sessionId` 是关键 —— 用户必须能回答「**是谁**改了我的浏览器」。

### 4.4 信任边界声明

> **BUA 把用户的真实浏览器暴露给本地调用方。它不是沙箱。**
> 能访问本机用户账号的进程 = 能访问浏览器自动化通道。

这条要写进 README，不能含糊。诚实的边界声明比虚假的安全感更有价值。


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
| `storage` | ✅ | 配置与 token | 基础 |
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
- 代价是必须自己做 token 鉴权（见 §4），但换来「只装一个扩展」
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
| 扩展 + 本地 WebSocket | ✅ | 有（需自建鉴权） | 行业普遍无鉴权 |
| `--remote-debugging-port` | ✅ | **有，且无认证** | Chrome 136+ 对默认 profile **静默失效**；144+ 每次连接弹窗 |
| Chrome for Testing | ❌ | 有 | 不是用户的浏览器 |
| profile 快照 | ⚠️ 登录可能失效 | 有 | 需用户完全退出浏览器 |
| 二进制补丁 | ✅ | 有 | 破坏签名、更新即失效、杀软可疑 |

**这是 BUA 的核心卖点**：它根本不需要在 `127.0.0.1` 上开 CDP 端口，因此「本机任意进程连上调试端口即接管浏览器」这个风险面**不存在**。

> 但 BUA **自己的桥**仍监听本地端口（扩展要连它），所以 token 鉴权是硬需求 —— 见 §4.1 L1。

### 6.2 三个必须补齐的行业空白（差异化，非抄袭）

| # | 空白 | 现状 | BUA 做法 |
|---|---|---|---|
| 1 | **本地桥的握手鉴权** | ⭐ **全行业没有**。Browser MCP（7.2k★）无 token 无 Origin 校验；mcp-chrome（12.5k★）Roadmap 里 `- [ ] Authentication` 未完成；open-browser-use 自述 *"Planned hardening includes client tokens, peer validation"* | ≥256 bit token + Origin/Host 双校验（§4.1 L1） |
| 2 | **动作风险三级分类** | 竞品**无一实现**。open-browser-use 的 SECURITY.md 只是**建议** | 扩展侧硬编码分级 + 破坏性动作逐次审批 + `targetDescription` 强制字段（§4.1 L3） |
| 3 | **无 CDP 降级模式** | **现有项目无一实现**。企业策略拒绝 `attach()` 时直接不可用 | 降级到 `chrome.scripting` + `chrome.tabs`，并在 capabilities 里如实声明（§4.1 L2-12） |

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
| `--remote-debugging-port` 开在真实 profile | CDP 端口无认证；Chrome 136+ 对默认 profile 静默失效。三方（chrome-devtools-mcp 官方、MCP 规范、patch-browser 作者）独立指出其不安全 |
| 二进制补丁（patch-browser） | 破坏代码签名与完整性校验、Chrome 每次更新即失效、需管理员权限、杀软/EDR 高度可疑、企业环境不可接受 |
| `--remote-allow-origins=*` | 等于放行任意来源 |
| `killProcessOnPort` | 强杀用户进程，不可接受 |
| 「新连接踢旧连接」 | 破坏多 agent 并发前提 |

---

## 7. 路线图

### M0 — 可行性验证（已完成 ✅）
- [x] 证明 `chrome.debugger` 路线可行（CDP 全链路实测：读 DOM / 点击 / 真实键盘鼠标事件注入 / 截图）
- [x] 抠出 Codex 完整 API 面作为对齐基准（22 接口 / 152 声明）
- [x] 竞品与上架政策调研

### M1 — 最小可用（MVP）
- [ ] `protocol`：定义方法名、类型、错误码
- [ ] `extension`：MV3 骨架 + side panel + `chrome.debugger` attach + token 配对
- [ ] `server`：ws 服务端 + token 校验 + 单会话
- [ ] `sdk`：`agent.browsers` / `browser.tabs` / `tab.goto` / `tab.screenshot` / `tab.playwright.locator` 核心子集
- [ ] **端到端实测**：一个真实 agent 完成「打开页面→读内容→点击→截图」

### M2 — API 面补齐
- [ ] `tab.ax` 全量 + DOM 快照注入
- [ ] `tab.cua` / `tab.dom_cua`
- [ ] `capabilities` 协商机制
- [ ] `browser.user.claimTab` + `openTabs`

### M3 — 多 agent 与安全
- [ ] **L1 传输层**：Origin + Host 双校验、token 握手（≥256 bit）、只绑 127.0.0.1、不踢旧连接、不 kill 端口占用进程
- [ ] **L3 动作级闸门**（核心差异化）：动作风险三级分级（扩展侧硬编码）、破坏性动作逐次审批、审批 UI 展示人类可读目标描述
- [ ] `targetDescription` 强制字段（所有 write/destructive 动作）
- [ ] 会话隔离与标签所有权；显式 `tabId` 路由（对齐 chrome-devtools-mcp `--pageIdRouting` 的做法，优于隐式 current-tab）
- [ ] session TTL + 后台清理（对齐 browser-use 的 `session_timeout_minutes` + `cleanup_loop`）
- [ ] tab group 作可视锚点 + `chrome.storage.local` 持久化（对抗 MV3 service worker 被杀）
- [ ] 扩展内可视授权 UI（按 origin，可撤销）
- [ ] **无 CDP 降级模式**：`attach()` 被企业策略拒绝时降级到 `chrome.scripting`，并在 capabilities 里如实声明
- [ ] 敏感字段占位符（`{{secret:name}}`，真实值不进 agent 上下文）
- [ ] TOCTOU 强校验（`snapshotId` 不匹配即拒绝）
- [ ] `browserAuth` 能力
- [ ] MCP 适配器

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
