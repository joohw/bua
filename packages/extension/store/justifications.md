# Dashboard 逐项填写内容

直接复制粘贴。每项都附**官方依据**，便于自查与应对审核问询。

---

## 1. Single purpose（单用途说明）

> **让用户通过本地程序自动化操作自己的浏览器。**
>
> 本扩展把浏览器操作能力（读取页面结构、截图、点击、输入、导航）暴露给用户自行启动的本地程序，
> 使用户可以用自己喜欢的工作流或 AI agent 操作**已登录的真实浏览器**，而不必重新登录或改用独立浏览器。
>
> 本扩展不内置任何 AI 模型、不访问网络、不收集或上传任何数据。它只监听 `127.0.0.1` 上的本地连接。

**为什么这样写**：官方要求单用途「narrow and easy to understand」。这段只声明一件事（把浏览器操作能力
本地化），并主动排除了三件审核员会怀疑的事（内置模型 / 联网 / 上传数据）。

---

## 2. Remote Code 申报 ⚠️ 最容易踩的坑

**必须选：`Yes, I am using remote code`**

理由（原文照抄进 Dashboard 的理由字段）：

> This extension uses the **chrome.debugger API**, which is one of the two APIs that Chrome's
> Manifest V3 requirements **explicitly permit for remote execution** (the other is User Scripts).
>
> The extension itself contains no remote code. It listens on a local loopback WebSocket
> (`127.0.0.1`) and, when a local program sends a browser-automation command, translates that
> command into a `chrome.debugger.sendCommand` call. The logic being executed remotely is therefore
> the Chrome DevTools Protocol call itself, which is exactly the use the Debugger API is documented
> to allow.
>
> All extension logic is self-contained in the submitted package. There is no `eval()`, no
> `new Function()`, no remote `<script>` tag, and no remote `import`. The extension makes **no
> network requests of any kind** — the only socket it touches is the local loopback bridge.

**官方依据**：

- `mv3-requirements` §2.1 — *"Execution of logic from a remote source is permissible only when
  accomplished through a documented API that explicitly allows this practice... The permitted APIs
  for such remote execution are: 1. **Debugger API** 2. User Scripts API"*
- `remote-hosted-code` §browser.debugger — *"With it, an extension **can request and execute remote
  code**."*
- `cws-dashboard-privacy` — *"Extensions that call remote code and **do not declare and justify it**
  using the field shown above **will be rejected**."*

**不要选 "No"**。用 `chrome.debugger.sendCommand` 执行 `Runtime.evaluate` 就是执行远程代码，
虽然属于被允许的那一类，但谎报会被拒审。

---

## 3. Permissions justification（逐项）

Dashboard 会列出 manifest 里声明的每个权限，逐项填写：

### `debugger`

> Reads page structure (`DOM.getDocument`), captures screenshots (`Page.captureScreenshot`),
> and dispatches **real trusted input events** (`Input.dispatchMouseEvent`, `Input.insertText`) so
> automation behaves the same as a human user — including on sites that reject synthetic events
> created from page script.
>
> **Why `chrome.scripting` is not sufficient:** `chrome.scripting` can inject page-context script,
> but it cannot (a) produce trusted input events, (b) capture a screenshot, or (c) control
> cross-origin iframes consistently. This extension needs all three, which is precisely what the
> Debugger API provides.
>
> The user remains in control at all times: Chrome displays its **unclosable debugger banner**
> while attached, and dismissing that banner immediately terminates the session.

**依据**：官方文档明确 `chrome.debugger` 不是 `browser.scripting` 的替代品，且 UX 更显著
（*"it is not a substitute for browser.scripting, and has a much more notable user experience"*），
所以审核员一定会问「为什么不用 scripting」。上面这段正面回答了这个必然的问题。

### `tabs`

> Lists the user's open tabs so they can choose which one to hand to their automation tool, and
> lets the tool create or close tabs. Tab URLs and titles are displayed to the user in the
> extension popup.

### `storage`

> Stores the local bridge port, the user's acknowledgment that they read the risk disclosure, the
> current capability snapshot, and the recent activity log. **All data stays on the device** —
> nothing is transmitted anywhere.

### `scripting`

> Provides the fallback path used only when Chrome refuses `chrome.debugger.attach()` because of an
> enterprise policy (`runtime_blocked_hosts`, `DisableScreenshots`, or a DLP rule — Chrome 155+).
> In that situation the extension degrades to `chrome.scripting` and **reports the reduced
> capability set** so the calling program can adapt instead of failing.

**依据**：这是本扩展相对同类工具的一个实质差异 —— 企业策略下 `attach()` 会在**所有目标**上
失败且无法用 `runtime_allowed_hosts` 绕过。有明确、真实的降级用途，不是「未来可能用到」。

### `activeTab`

> Grants access to the currently focused tab at the moment the user invokes the extension, as a
> narrow alternative to broad host permissions.

**注意**：官方政策明确禁止「为未来功能预留权限」（*"Don't attempt to 'future proof' your Product
by requesting a permission that might benefit services or features that have not yet been
implemented"*）。若审核问起 `activeTab` 的具体用途，如实说明它用于引导页/弹窗读取当前标签信息即可；
若实测用不上，**从 manifest 删掉它再提交**更稳妥。

---

## 4. Data usage（数据使用申报）

Dashboard 的 Data usage 表单逐项：

| 项目 | 填写 |
|---|---|
| Personally identifiable information | ❌ 不收集 |
| Health information | ❌ |
| Financial and payment information | ❌ |
| Authentication information | ❌ |
| Personal communications | ❌ |
| Location | ❌ |
| Web history | ❌ **不收集**（扩展读当前标签内容以执行用户指令，但不记录、不存储、不上传历史） |
| User activity | ❌ |
| Website content | ⚠️ **在设备上处理，不上传**（见下） |

**Website content 需要谨慎填写**：扩展确实读取页面内容（DOM、截图）来执行用户的指令。
按官方口径，「读取并处理」与「收集并传输」是两件事：

> 勾选「Website content」，并在说明里写清：
> Page content is read **only** on tabs the user explicitly hands to their automation tool, **only**
> while a session is active, and **only** to carry out the command the user's own local program
> requested. Content is processed **in memory on the device** and is **never transmitted** by this
> extension. The extension contains no networking code and contacts no servers. Screenshots and DOM
> snapshots are held only for the duration of the request that asked for them.

### 三项认证

Dashboard 底部三个必勾项，全部勾选：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## 5. Privacy policy URL

必须提供一个**可公开访问的 URL**。把 [privacy-policy.md](privacy-policy.md) 的内容托管到
GitHub Pages 或项目仓库的公开页面，然后填入该 URL。

> ⚠️ **三方一致性**：隐私政策文案、Dashboard 表单勾选、代码实际行为三者必须一致。
> 官方明确：三者不一致可能导致**整个发布者账号被封**，不只是这一个扩展下架。

---

## 6. 分类与语言

| 字段 | 建议值 |
|---|---|
| Category | Developer Tools |
| Language | 中文（简体）+ English |
| Homepage URL | `https://github.com/joohw/bua` |
| Support URL | `https://github.com/joohw/bua/issues`（若开启）或 Discussions |

---

## 7. 审核问询的准备

审核员最可能问的三个问题及回答要点：

**Q：为什么需要 `debugger` 这个高危权限？**
> 因为需要**真实输入事件**、**截图**与**跨 iframe 一致控制**，这三项 `chrome.scripting` 都做不到。
> 用户全程可控：Chrome 的调试横幅无法关闭，关掉横幅即刻终止会话。

**Q：这算不算远程代码执行？**
> 是，而且我们已在 Remote Code 字段如实申报。它属于 MV3 明确允许的例外（Debugger API）。
> 扩展包内无任何远端代码、无 `eval`、无网络请求。

**Q：扩展会上传用户数据吗？**
> 不会。扩展**没有任何网络代码**，只监听 `127.0.0.1` 的本地回环连接。页面内容仅在设备内存中处理。

---

## 8. 若被拒的应对

| 违规 ID | 含义 | 应对 |
|---|---|---|
| `Purple Potassium` | 声明了但未真实使用某权限 | 从 manifest 删除该权限后重新提交。逐项核对 §3 里每个权限是否真有对应代码路径 |
| `Blue Argon` | 远程托管代码 | 检查打包产物中是否有远端 `import` / `eval` / `new Function`。运行 `node scripts/preflight.mjs` 会直接报出 |
| `Yellow Zinc` / 其他 | 见官方 Troubleshooting | 按官方说明逐条修复 |

**退路**（按推荐度）：

1. **Edge Add-ons** —— Partner Center 的隐私字段与 Chrome 几乎一一对应，材料可直接复用，边际成本最低
2. **企业自托管**（`ExtensionInstallForcelist` + `update_url`）—— 免商店审核
3. **开发者模式分发** —— 零审核，但用户体验差（Chrome 134+ 要求开发者模式常开）

> **Firefox 不可行** —— Firefox 没有 `chrome.debugger` 等价 API，且 AMO 政策是绝对的
> 「必须自包含、不得加载远程代码」，没有 debugger 豁免。
