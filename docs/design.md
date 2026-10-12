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

### 4.1 威胁与对策

| 威胁 | 对策 |
|---|---|
| **本机任意进程连上桥，劫持浏览器** | 桥启动时生成一次性高熵 token，写入仅当前用户可读的文件；扩展配对时读取并持久化。**未通过 token 校验的连接立即断开，不泄露任何信息** |
| 恶意网页驱动 agent 做危险操作 | 域名白名单（默认拒绝）+ 敏感操作二次确认（提交、支付、删除） |
| agent 越权读敏感页面 | 按会话/域名的 scope；`browser.user.getTabContext` 只返回有界上下文 |
| 凭据泄露进模型上下文 | `browserAuth` 能力在扩展侧填表，**值永不穿过桥**（对齐 Codex 的做法） |
| 提示注入（页面内容当指令） | 所有页面取回内容一律标记为**不可信数据**，并在系统提示层声明 |
| 端口被外部访问 | 桥**只绑 `127.0.0.1`**，不提供任何监听外部接口的选项 |

### 4.2 授权层级（对齐并扩展 Codex）

```
未授权 → 只能看到「有这些标签」，不能读内容
只读   → 可读 DOM/截图，不能点击输入
可交互 → 可点击/输入/导航
受限交互 → 以上，但敏感操作需逐次确认（默认档）
完全   → 无逐次确认
```

每个授权可限定域名范围，且有 TTL（对齐 Codex 的 `expired` 语义）。

### 4.3 审计轨迹

继承 Codex 的 `management.getAuditTrail()` 设计并推广到**所有变更型操作**：每次变更记录「操作 + 变更前状态」，使撤销成为可能。这是一个 AI 操作浏览器必须有的东西 —— 用户得能回答「它到底改了什么」。

---

## 5. 上架策略

### 5.1 权限最小化原则

`chrome.debugger` 是**极高敏感权限**（它等于完整 CDP）。上架审核的关键问题是能否论证必要性。

**BUA 的策略：默认不申请，作为可选能力按需启用。**

| 权限 | 默认 | 用途 | 必要性论证 |
|---|---|---|---|
| `activeTab` + `scripting` | ✅ | DOM 快照、点击、输入 | 核心功能 |
| `tabs` | ✅ | 列标签、`user.claimTab` | 核心功能 |
| `sidePanel` | ✅ | 用户操作面板与审批 UI | 人在环 |
| `storage` | ✅ | 配置与 token | 基础 |
| `<all_urls>` | ⚠️ 改为 `optional_host_permissions` | 按域名申请 | 减少首次授权面 |
| `debugger` | ❌ **可选** | 仅 `cdp` 能力需要 | 逃生口，非默认路径 |

> **待确认**：`debugger` 在可选权限下的审核口径，以及 `<all_urls>` 是否必须走 optional。见 `research/02-store-policy.md`（调研中，结论回来后本节据实修订）。

### 5.2 远程代码合规

MV3 禁止执行远程托管的代码。BUA 的边界：

- ✅ **允许**：扩展通过 WebSocket 接收**指令数据**，翻译成对 `chrome.*` API 的调用（这是数据，不是代码）
- ❌ **禁止**：接收并 `eval` 远程脚本、动态 import 远程 JS
- ⚠️ **注意**：`tab.playwright.evaluate()` 会执行页面内 JS —— 这是**用户页面上下文的执行**，且是 agent 明确要求的操作；需要在审核说明里讲清这不是加载远程代码到扩展环境

### 5.3 隐私政策要点

会读浏览内容（DOM/截图）→ 隐私政策必须写明：读什么、存哪里、是否上传、保留多久、如何删除。默认**不上传任何页面内容**是最强的合规姿态。

---

## 6. 路线图

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
- [ ] 会话隔离与标签所有权
- [ ] 域名白名单 + 敏感操作确认 + 审计轨迹
- [ ] `browserAuth` 能力
- [ ] MCP 适配器

### M4 — 上架准备
- [ ] 权限最小化改造
- [ ] 隐私政策 + 审核说明文档
- [ ] Chrome Web Store 提交

---

## 7. 未决问题

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | `chrome.debugger` 能否通过 Chrome Web Store 审核？ | 决定是否需要双扩展（主扩展 + 可选 CDP 扩展） | 调研中 |
| 2 | `<all_urls>` 是否必须用 `optional_host_permissions`？ | 影响首次授权体验与审核 | 调研中 |
| 3 | DOM 操作走 `scripting` 注入还是必须 `debugger`？ | 若 `scripting` 够用，可完全去掉 `debugger` 默认权限 | 待验证 |
| 4 | 是否需要 native messaging 处理「扩展未运行」的启动场景？ | 影响安装流程复杂度 | 待定 |
| 5 | 多浏览器（Edge/Brave）支持优先级 | 影响发布渠道顺序 | 待定 |

---

## 8. 命名与许可

- 项目名 **BUA**（Browser Use Agent），仓库 `bua`
- 目标许可：**MIT**（与生态一致，降低采用门槛）
- 参考实现：OpenAI Codex 浏览器扩展（API 形状对齐，无代码复用）
