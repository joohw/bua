# Chrome MV3 `chrome.debugger` Agent 扩展 — Chrome Web Store 上架硬性约束调研

- **调研对象**：一个用 `chrome.debugger`（CDP）操作用户真实浏览器的 AI agent 扩展（读 DOM、点击、输入、截图），目标渠道为 Chrome Web Store
- **调研时间**：2026-10-12
- **方法**：以下所有"官方文档原文"均通过 `curl.exe` 实际抓取 `developer.chrome.com` 的 `.md.txt` 原始文档版本（`web_fetch` 在本机对该域 DNS 解析失败），引文可逐字核对。第三方来源单独标注。

## 可信度标记约定

| 标记 | 含义 |
|---|---|
| **[官方·原文]** | 我**实际抓取并逐字阅读**了 Google/Chrome 官方文档的原始文本 |
| **[官方·索引]** | 官方文档存在该页面/该措辞，但我只确认了链接或摘要，未逐字读全文 |
| **[第三方]** | 博客、论坛、GitHub issue 等非官方来源，仅作旁证 |
| **[推断]** | 我基于官方原文做出的工程判断，非官方明文规定 |

---

## 0. 结论速览（Executive Summary）

| # | 问题 | 结论 |
|---|---|---|
| 1 | `debugger` 权限能否过审 | **能** — 官方把 Debugger API **明文列为允许远程执行逻辑的例外 API**，非禁止项 |
| 2 | 远程代码（RHC）政策 | **有条件合规** — debugger 是官方白名单；但**必须在 Dashboard 勾选并说明"使用远程代码"**，否则**会被拒** |
| 3 | `<all_urls>` | **不需要，且强烈建议不要** — 官方明文 `chrome.debugger` **不需要 host permissions** |
| 4 | 审核时长 | 首次 + 敏感权限 → **人工审核**，官方口径"几天到几周"；>3 周可联系支持 |
| 5 | Manifest | MV3 必填 `manifest_version`/`name`/`version`；建议 `minimum_chrome_version: "125"` |
| 6 | Native messaging | Windows 需注册表键 + manifest；`allowed_origins` **不能含通配符**，需固定扩展 ID |
| 7 | 替代渠道 | Edge Add-ons（最平滑）、Firefox AMO（**无 chrome.debugger**）、企业自托管、开发者模式 |
| 8 | 隐私合规 | 必须隐私政策 + 显著披露 + Limited Use 声明；DOM/截图均属"user data" |

**一句话裁决：有条件能做。** 政策层面 Chrome Web Store **明文允许** `chrome.debugger` 执行远程逻辑；真正的风险不在"能不能用 debugger"，而在 ①是否在 Privacy 面板如实申报远程代码、②是否为了 debugger 而多申请了 `<all_urls>`、③单用途（single purpose）描述是否过关、④UX 上能否容忍 Chrome 无法关闭的调试横幅。

---

## 1. `debugger` 权限能否过审

### 1.1 结论

**能做（有条件）。** `debugger` **不属于** Chrome Web Store 的任何"禁止权限"清单。恰恰相反，Google 在**远程代码政策**里把它写成了**例外**。但它属于官方所称的 **"敏感权限 / 敏感执行权限"**，会触发**人工审核**，并且会向用户展示**两条强警告**。

### 1.2 官方原文依据

**(a) Debugger API 是远程代码政策的明文例外 —— 这是本次调研最关键的一条**

`https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements` **[官方·原文]**

> "Execution of logic from a remote source is permissible only when accomplished through a documented API that explicitly allows this practice and the use is inline with the documented purpose of the API, as detailed in the API Use policy. The permitted APIs for such remote execution are:
> 1. **Debugger API**
> 2. User Scripts API
>
> Note that exemptions apply solely to the specific section of code covered by these APIs."

同页列出**违规**做法（对照用）：

> "Some common violations include:
> 1. Including a `<script>` tag that points to a resource that is not within the extension's package
> 2. Using JavaScript's `eval()` method or other mechanisms to execute a string fetched from a remote source
> 3. **Building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data**"

⇒ 第 3 条尤其重要：**"从远端拉指令当数据、自己解释执行"是明确违规的**——除非走 Debugger / User Scripts API。

**(b) 另一份官方文档再次把 debugger 列为 "Is there any workaround?" 的合规答案**

`https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code` **[官方·原文]**

> "Generally speaking, no. RHC is not allowed. There is, however, a small number of cases where it *is* allowed. ...
> ### browser.debugger
> The `browser.debugger` API gives extensions the ability to interact with the Chrome DevTools Protocol. ... With it, an extension can request and execute remote code. **Just like user scripts, it is not a substitute for browser.scripting**, and has a much more notable user experience. While it is being used, the user will see a warning bar at the top of the window. **If the banner is closed or dismissed, the debugging session will be terminated.**"

**(c) `debugger` 是"敏感权限"，触发人工审核**

`https://developer.chrome.com/docs/webstore/check-review` **[官方·原文]**

> "All Chrome Web Store items go through an automated review process. **In some instances, a manual review is required, especially when sensitive permissions are requested.** For this reason, review times and/or approval times can take longer."

`https://developer.chrome.com/docs/webstore/review-process` **[官方·原文]**

> "**Sensitive execution permissions**: Permissions grant extensions special data access and manipulation rights. Some permissions do this directly (for example, `tabs` and `downloads`) while others must be combined with host permissions grants ... Requesting powerful and potentially dangerous capabilities takes more time to review."

> 触发更严格审查的信号包括：「new developers / new extensions / **dangerous permission requests** / significant code changes」

**(d) 用户安装时看到的两条警告**

`https://developer.chrome.com/docs/extensions/reference/permissions-list` **[官方·原文]**

> `"debugger"`: Gives access to the `chrome.debugger` API.
> Warnings displayed:
> - *Access the page debugger backend.*
> - ***Read and change all your data on all websites.***

⇒ 注意第 2 条：**即使你不申请任何 host permission，只装 `debugger`，用户仍会看到"读取和更改你在所有网站上的所有数据"**。审核员同样会据此按"broad access"标准审视你。

**(e) 必须填 justification**

`https://developer.chrome.com/docs/webstore/cws-dashboard-privacy` **[官方·原文]**

> "**Permissions justification** — This section contains a list of permissions that your extension uses (as declared in your manifest), with a field for you to state the justification for each permission. Fill out these fields to tell the reviewers why your extension needs to use each permission. If there are permissions listed here that you don't require, **remove them from your manifest** and upload a new version of your extension before continuing."

**(f) 现有的 Enterprise 策略收紧（Chrome 155），但**不影响个人用户**

`https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions`（Published: 2026-09-08，Updated: 2026-09-16）**[官方·原文]**

> "Starting in Chrome 155, Chrome updates how enterprise policy restrictions apply to extensions using the `chrome.debugger` API. This change **only affects extensions running on managed browsers** where an administrator has explicitly configured `runtime_blocked_hosts`, `DisableScreenshots`, or DLP rules. ... **If an extension runs on an unmanaged browser, or in an enterprise environment without these specific policy restrictions, `chrome.debugger` continues to operate normally with no changes.**"
> - Chrome 155 Beta: 2026-09-16；Chrome 155 Stable: 2026-10-06
> - `runtime_blocked_hosts` 非空 ⇒ `attach()` 直接失败：`"Host access is restricted by policy."`（即使 origin 在 `runtime_allowed_hosts` 里也一样）
> - `DisableScreenshots` 或 DLP ⇒ `attach()` 失败：`"Screenshot capture is restricted by policy."`
> - 理由原文："Because CDP operates beneath the web platform's origin model, **origin-based filtering cannot securely restrict it**, so Chrome 155 resolves this with an *all-or-nothing* model"

### 1.3 已知被拒/被下架案例

**没有找到任何"因为使用 `debugger` 权限本身而被拒"的官方或可靠第三方案例。**

找到的最相关真实案例（**注意其结论是支持而非反对**）：

**[第三方] june07（NiM / Nimbus Capture 作者）博客，2024-06-07** — <https://june07.com/chrome-web-store-rejection-notification-purple-potassium/>

- 作者称累计 **8 次**收到 `Purple Potassium`（请求但不使用权限 / 权限理由不足）误报，**每次都与其扩展使用了 `debugger`/`devtools` 权限有关**
- 作者原文引用了 Chrome 自身的报错来论证该权限是必需的：`"Error: Cannot navigate to a devtools:// page without either the devtools or debugger permission."`
- 关键结论：**该作者的每一次提交最终都被接受（"The proof being the ultimate (sans problem free) acceptance of each Web Store submission"）**
- 作者抱怨的是**误报与流程耗时**，而不是"debugger 权限不被允许"
- ⚠️ 语气激烈、情绪化，且有商业动机（为自家扩展辩护）；作为"审查会盯着 debugger"的证据可靠，作为"debugger 被禁"的证据不可靠。**可信度：中**（事实：确有反复误报；解读：作者主观）

**[第三方] `Purple Potassium` 的真实含义 = "请求了但没用到该权限"** — 另一独立佐证来自一个中文项目的重新提交说明 <https://raw.githubusercontent.com/lagrangee/weread_deepreading/main/SUBMISSION_RESPONSE.md> **[第三方]**：其违规 ID 为 `Purple Potassium`，原因是"请求但不使用 `scripting`、`notifications`"，修复方式就是**从 manifest 删除未使用权限**。可信度：中高（与官方 Troubleshooting 的 Purple Potassium 描述一致）。

⇒ **实务含义**：`debugger` 若在 manifest 里声明，就必须在代码里真实调用，否则会吃 `Purple Potassium`。

### 1.4 上架需要提供什么 justification

**[推断]** 基于上述官方字段与政策，建议在 Dashboard 的 *Permissions justification* 里逐条给出**具体到代码行为**的说明（审核员不接受"未来可能用到"，参见下方 §3）：

- **`debugger`**：说明用 CDP 做什么（`DOM.getDocument` 读结构、`Input.dispatchMouseEvent` 点击、`Input.insertText` 输入、`Page.captureScreenshot` 截图）；说明**为什么 `chrome.scripting` 做不到**（需跨域一致控制、真实输入事件、CDP 层面的网络/截图能力）；说明用户**每次会话都会看到调试横幅**且可随时中止
- **不得**为了 debugger 而附带 `<all_urls>`
- **远程代码字段必须选"Yes"并说明**（见 §2.3）—— 这是最容易被忽视的拒审点

---

## 2. 远程代码政策（RHC）原文与边界

### 2.1 官方政策原文

`https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements` **[官方·原文]**（完整第 1、2、3 条）

> **1.** Extensions using Manifest V3 must meet additional requirements related to the extension's code. Specifically, **the full functionality of an extension must be easily discernible from its submitted code** ... This means that the logic of how each extension operates should be self contained. The extension may reference and load data and other information sources that are external to the extension, but **these external resources must not contain any logic**. Some common violations include:
> 1. Including a `<script>` tag that points to a resource that is not within the extension's package
> 2. Using JavaScript's `eval()` method or other mechanisms to execute a string fetched from a remote source
> 3. Building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data
>
> **2.** Execution of logic from a remote source is permissible only when accomplished through a documented API that explicitly allows this practice ... The permitted APIs for such remote execution are:
> 1. Debugger API
> 2. User Scripts API
>
> ... Additionally, **code run in contexts that are isolated from extension APIs (such as iframes and sandboxed pages) are exempt** from the restriction on loading code from remote sources; however, these are treated similarly to our policy on communication with external servers. That is, it must still be possible to determine the full functionality of your extension and the interaction must still comply with our user data policies, including Limited Use and the extension's Privacy Policy.
>
> **3.** Communicating with remote servers for certain purposes is still allowed. For instance:
> 1. Syncing user account data with a remote server
> 2. **Fetching a remote configuration file for A/B testing or determining enabled features, where all logic for the functionality is contained within the extension package**
> 3. **Fetching remote resources that are not used to evaluate logic, such as images**
> 4. Performing server-side operations with data (such as for the purposes of encryption with a private key)
>
> **4.** If we are unable to determine the full functionality of your extension during the review process, we may reject your submission or remove it from the store.

**RHC 的定义**（`remote-hosted-code`）**[官方·原文]**：

> "Remotely hosted code, or RHC, is what the Chrome Web Store calls anything that **is executed by the browser that is loaded from someplace other than the extension's own files. Things like JavaScript and WASM.** It *does not* include **data** or things like **JSON or CSS**."

### 2.2 逐条回答你的边界问题

| 做法 | 判定 | 依据 |
|---|---|---|
| `eval()` 执行远端脚本文本 | ❌ **违规** | mv3-requirements §1.2 **[官方·原文]** |
| 动态注入 `<script src="https://cdn...">` | ❌ **违规** | mv3-requirements §1.1 **[官方·原文]** |
| 从远端拉指令（数据）→ 自己写解释器执行 | ❌ **违规** | mv3-requirements §1.3（"even if those commands are fetched as data"）**[官方·原文]** |
| **通过 WebSocket 接收指令 → 调用本地扩展 API（含 `chrome.debugger.sendCommand`）执行** | ✅ **合规** | **正因为走了 Debugger API**，落入 mv3-requirements §2.1 白名单 **[官方·原文]** + remote-hosted-code「browser.debugger」节 **[官方·原文]** |
| **通过 WebSocket 接收指令 → 自己 eval/解释执行** | ❌ **违规** | §1.3，与走不走 WebSocket 无关 |
| **WASM** | ⚠️ **必须打包在扩展内** | RHC 定义明文把 WASM 列为 RHC 范畴；从远端拉 WASM 执行 **违规**。**随包分发的 WASM 是允许的**（MV3 本身支持 WASM，受 CSP `wasm-unsafe-eval` 约束）**[官方·原文（RHC 定义）]+[推断（结论）]** |
| 远端 JSON/CSS 配置数据 | ✅ **合规** | RHC 定义明文排除 data/JSON/CSS；mv3-requirements §3.2 **[官方·原文]** |
| 远端配置决定功能开关（A/B） | ✅ **合规（有条件）** | 前提："where **all logic** for the functionality is contained within the extension package" **[官方·原文]** |
| 远端图片等非逻辑资源 | ✅ **合规** | §3.3 **[官方·原文]** |
| Sandboxed iframe 内 `eval` 远端代码 | ✅ **合规（有条件）** | §2 末段明文豁免；但仍须可判定完整功能 + 遵守 Limited Use **[官方·原文]**；实现见 <https://developer.chrome.com/docs/extensions/develop/concepts/sandboxing> **[官方·索引]** |
| User Scripts API 执行用户脚本 | ✅ **合规但受限** | 仅限用户脚本管理器；"Users must enable developer mode"；滥用可被拒 **[官方·原文]** |

### 2.3 ⚠️ 最容易踩的坑：Remote Code 字段必须申报

`https://developer.chrome.com/docs/webstore/cws-dashboard-privacy` **[官方·原文]**

> "**Declare any remote code** — Your extension should avoid using remote code except where absolutely necessary. Extensions that use remote code will need extra scrutiny, resulting in longer review times. **Extensions that call remote code and do not declare and justify it using the field shown above will be rejected.**
>
> **Remote Code** — Use this field to tell reviewers whether your extension executes remote code and, if so, why this is necessary. If your extension doesn't need to execute remote code, make sure that it does not and select 'No, I am not using remote code.'"

**[推断]** 一个用 `chrome.debugger.sendCommand` 执行 agent 下发的 `Runtime.evaluate` / `Runtime.callFunctionOn` 的扩展，**实质上就是在执行远程代码**。虽然它是被**允许**的那一类，但按此原文，**若在 Dashboard 谎选"No"而被审核员发现，属于"call remote code and do not declare"→ 直接拒审**。**必须在 Remote Code 字段选择"Yes"并写明理由（"uses the Debugger API, an explicitly permitted API for remote execution under the Manifest V3 requirements"）**。

### 2.4 关于"下载即用"的额外硬约束

`https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code` **[官方·原文]** —— debugger 是**例外**但**不是替代品**：

> "Just like user scripts, **it is not a substitute for browser.scripting**, and has a much more notable user experience."

⇒ 审核员会问：**这个功能为什么不能用 `chrome.scripting` + `activeTab` 实现？** 若答案不充分，可能被按"过度权限"处理。你的场景（真实输入事件 `Input.*`、`Page.captureScreenshot`、跨 iframe 一致控制、网络拦截）**恰好是 `scripting` 确实做不到的**，这是最强的辩护理由。

---

## 3. `<all_urls>` host permission

### 3.1 结论：**不需要，且应当移除**

**这是本次调研第二个关键发现。** 官方明文：使用 `chrome.debugger` 时**不需要 host permissions**。

`https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions` **[官方·原文]**

> "In some special cases, host permissions are **not** required. These include:
> - Using the `chrome.tabs` API to access and modify tabs, including access to the tab's URL if you have the `tabs` permission.
> - **Interacting with the browser using the `chrome.debugger` API.**
> - Allowing the injection of a content script declared in the manifest."

⇒ **`debugger` 自带"访问所有网站"的能力**（这也是它触发 *"Read and change all your data on all websites"* 警告的原因），所以再申请 `<all_urls>` 是**纯冗余**，只会招致更严审查。

### 3.2 官方对 broad host permissions 的明确态度

`https://developer.chrome.com/docs/webstore/review-process` **[官方·原文]**

> "**Broad host permissions** — Host permissions patterns like `*://*/*`, `https://*/*`, and `<all_urls>` give extensions extensive access to the user's web activity, especially when combined with other permissions. Extensions with this kind of access can collect a user's browsing history, hijack web search behavior, scrape data from banking websites, harvest credentials, or exploit users in other ways."
>
> "Notable factors that increase review time: Reviews may take longer for extensions that request **broad host permissions or sensitive execution permissions**, or which include a lot of code or hard-to-review code."

`https://developer.chrome.com/docs/webstore/program-policies/permissions` **[官方·原文]**（Use of Permissions 全文）

> "Request access to the **narrowest permissions** necessary to implement your Product's features or services. If more than one permission could be used to implement a feature, you must request those with the least access to data or functionality. **Don't attempt to 'future proof' your Product by requesting a permission that might benefit services or features that have not yet been implemented.**"

`https://developer.chrome.com/docs/webstore/cws-dashboard-privacy` **[官方·原文]**

> "Your extension should request the **minimum permissions** consistent with the purpose of the extension. **Requesting broader permissions than necessary may cause your extension to be rejected.**"

### 3.3 是否"必须"改为 `optional_host_permissions`？

**严格来说：不必须 —— 因为在 debugger 场景下你根本不该有任何 host permission。**[官方·原文依据见 §3.1]

`optional_host_permissions` 的适用场景是：**你的确需要 host permission**（例如同时用 `chrome.scripting` 或 `content_scripts` 做兜底），此时应改为运行时按 origin 申请：

`https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions` **[官方·原文]**

> "Consider using **optional permissions** wherever the functionality of your extension permits, to provide users with informed control over access to resources and data."

`https://developer.chrome.com/docs/webstore/program-policies/user-data-faq`（Minimum Permission 节）**[官方·原文]**

> "Extensions must only require access to the **narrowest set of permissions** necessary ... Developers **may use minimally-scoped optional permissions** to further enhance the capabilities of the extension, but must not require users to agree to additional permissions."

> "**Does the 'minimum permission' policy also apply to optional permissions?** Yes. The policy applies to both required and optional permissions."

### 3.4 推荐的 UX 做法（**[推断]**）

1. **required permissions 只要 `debugger`（+ `storage` 等真正必需的）**，不要 `host_permissions`，不要 `content_scripts.matches` 泛匹配
2. 若确实需要脚本注入兜底 → 用 `activeTab`（用户点击时临时授权，无安装警告）或 `optional_host_permissions` + 在**用户手势**中调用 `chrome.permissions.request({origins:[...]})`
3. **在扩展 UI 内**解释 debugger 会做什么、"调试中"横幅是什么、如何中止
4. 在 CWS listing 描述里明确写出权限清单与用途（官方 FAQ 建议："include a list of permissions used and the reasons you require them in your Chrome Web Store listing or in an 'about page'"）**[官方·原文]**

**[第三方] 旁证**：Klaxon 项目的工程计划 <https://raw.githubusercontent.com/MuckRock/Klaxon-Cloud/main/plans/optional-host-permissions.md> 记录了同一判断——"The Chrome Web Store flags broad install-time host permissions (`http://*/*`, `https://*/*`) for an in-depth review that can delay publishing by **weeks**"，因此他们把 `<all_urls>` 改成 `optional_host_permissions`。**可信度：中**（同一文档自承"Google's review-policy page couldn't be fetched verbatim, so the review-skip is **highly likely but unconfirmed**"）。不过其核心事实已被 §3.2 官方原文独立证实。

---

## 4. 审核时长与流程

### 4.1 官方口径

`https://developer.chrome.com/docs/webstore/review-process` **[官方·原文]**

> "**Review times** — Chrome Web Store review times can vary ... For most extensions, review is completed within **a few days**, but it can take **up to a few weeks**. ...
> **Note:** If your extension is pending review for **more than three weeks**, please contact developer support to request assistance.
>
> The review process uses a combination of **manual and automated systems**. All submissions go through the same review system, regardless of the tenure of the developer or number of active users. However, some signals may cause the reviewer to examine an extension more closely, including:
> - new developers
> - new extensions
> - **dangerous permission requests**
> - significant code changes
>
> These signals may therefore cause the review to take longer. Review times may also be longer than normal after an extension has been rejected or warned.
>
> **Note:** all item submissions — whether for a new item or an update to an existing one — are subject to the same review process."

`https://developer.chrome.com/docs/webstore/check-review` **[官方·原文]**

> "All Chrome Web Store items go through an automated review process. **In some instances, a manual review is required, especially when sensitive permissions are requested.**"

### 4.2 直接回答

| 问题 | 答案 |
|---|---|
| 是否人工审核？ | **很可能是。** 官方明文：请求敏感权限时"manual review is required"*[官方·原文]*。`debugger` 属敏感执行权限 *[官方·原文，见 §1.2c]* |
| 时长 | 首次提交 + 新开发者 + 敏感权限 + 可能的大代码量 → 取官方区间上沿。**建议预算 1–3 周**；官方兜底"超过 3 周可联系支持" |
| 会不会更久 | 会。触发因素叠加：new developer + new extension + dangerous permission + broad host permissions + 大量/难审代码。官方："Where possible, consider submitting your code **as authored**" |

### 4.3 常见退回原因（violation ID）

`https://developer.chrome.com/docs/webstore/troubleshooting` **[官方·原文]** 给出全部 ID。与本项目最相关的：

| ID | 对应政策 | 对本项目的风险 |
|---|---|---|
| **`Blue Argon`** | MV3 远程代码（RHC） | ⚠️ **最高**。误把 debugger 用法、或依赖里混入远端 import 都会被判 RHC |
| **`Purple Potassium`** | 请求但不使用的权限 / 权限理由不足 | ⚠️ **高**。声明 `debugger` 却无实际调用，或留了 `<all_urls>` 没用 |
| **`Yellow Magnesium`** | 功能不工作 / 打包错误 | 中。审核员在**你无法控制的环境**测试，CDP 易受页面状态影响 |
| `Purple Lithium` / `Grey *` / `Yellow *` 等 | 其他（单用途、欺骗性行为、隐私政策缺失等） | 见原页面逐项 |

其他**流程性**注意点 **[官方·原文]**：
- 被拒/下架后审核时间会**更长**（"Review times may also be longer than normal after an extension has been rejected or warned"）
- 拒绝只影响**该次提交**，已上架版本不受影响；用户不会收到通知
- 申诉路径：Dashboard 的 **Appeal** 按钮，或 [One Stop Support](https://support.google.com/chrome_webstore/contact/one_stop_support)；支持回复最长 3 天

### 4.4 重要：Private / Unlisted **不能绕过审核**

`https://developer.chrome.com/docs/webstore/cws-dashboard-distribution` **[官方·原文]**

> "**IMPORTANT Key point:** All visibility settings have the same policy requirements and will go through the **same review process**."

⇒ 想"先私有发布试试水"是可行的（且便于验证审核反馈），但**同样要过审**。

---

## 5. Manifest 字段要求

### 5.1 必填项

`https://developer.chrome.com/docs/extensions/reference/manifest` **[官方·原文]**

- **Extensions platform 必需**：`manifest_version`（唯一支持值 `3`）、`name`（≤75 字符）、`version`
- **Chrome Web Store 额外必需**：`description`（≤132 字符）、`icons`

### 5.2 `minimum_chrome_version`

`https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version` **[官方·原文]**

> "An optional manifest key ... **New Installs**: In versions of Chrome older than the minimum version, the Chrome Web Store will show a 'Not compatible' message in place of the install button. **Existing Installs**: Existing users of your extension won't receive updates when the `minimum_chrome_version` is higher than their current browser version. This happens silently..."

**建议值：`"minimum_chrome_version": "125"`** **[推断]**

依据：`chrome.debugger` 的 **flat sessions**（`sessionId` 子会话，跨 OOPIF / worker 必需）是 **Chrome 125+** 引入的 —— `https://developer.chrome.com/docs/extensions/reference/api/debugger` **[官方·原文]**：

> "### DebuggerSession — **Chrome 125+**
> ## Attach to related targets — **Starting in Chrome 125**, the `browser.debugger` API supports flat sessions."

Agent 场景（跨 iframe 点击、操作 OOPIF）**几乎必然需要 flat sessions**，故 125 是合理下限。

**关于 `attach()` 的 `requiredVersion` 参数（官方文档内部表述不一致，已核实）**：

| 出处 | 用的值 |
|---|---|
| [Debugger API 参考 — `attach()` 参数说明](https://developer.chrome.com/docs/extensions/reference/api/debugger) **[官方·原文]** | `"0.1"`（"Required debugging protocol version ('0.1')"） |
| [Chrome 155 企业策略官方 blog 示例](https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions) **[官方·原文]** | `"1.3"`（`chrome.debugger.attach({ tabId }, "1.3")`） |
| [官方示例仓库 `api-samples/debugger`](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/debugger) **[官方·原文，经 curl 抓取]** | `'1.2'`（`chrome.debugger.attach({ tabId: tab.id }, '1.2', ...)`） |

**[推断]** 参考页的 `"0.1"` 疑似陈旧表述；**实践中应使用 `"1.3"`**（CDP 稳定版号，官方 blog 与企业策略示例均采用）。语义为"major 必须相同、minor 需 ≥"。

### 5.3 `nativeMessaging` 权限的额外要求

`https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging` **[官方·原文]**

> "To use these methods, the `"nativeMessaging"` permission must be declared in your extension's manifest file. **These methods are not available inside content scripts, only inside your extension's pages and service worker.** To communicate from a content script to the native application, send the message to your service worker to pass it along to the native application."
>
> "**Warning:** Because content scripts share a renderer process with untrusted web pages, your service worker **must validate `sender.origin` (or `sender.url`) and sanitize the message payload** before forwarding any data to the native host."

其他协议约束 **[官方·原文]**：
- 消息序列化为 JSON / UTF-8，前置 **32-bit 原生字节序长度前缀**
- **native host → Chrome：单条消息上限 1 MB**；**Chrome → native host：上限 64 MiB**
- Windows 上 host 还会收到 `--parent-window=<decimal handle>` 参数
- Windows-only 坑：I/O 模式须设为 `O_BINARY`，否则 `\n` 被转成 `\r\n` **破坏消息格式**
- 错误集：`Specified native messaging host not found` / `Access to the specified native messaging host is forbidden`（=`allowed_origins` 未含该扩展）等

### 5.4 Side panel 稳定性

`https://developer.chrome.com/docs/extensions/reference/api/sidePanel` **[官方·原文]**

- `"side_panel"` manifest key + `"sidePanel"` permission
- API 标注 **`Chrome 114+ MV3+`** → 属**稳定 API**，非实验性
- `sidePanel.open()` **Chrome 116+**，且**必须由用户手势触发**（action 点击 / 快捷键 / 右键菜单 / content script 中的用户手势）
- 后续版本仍在增补：`close()` Chrome 141+（行为在 **Chrome 145 变更**）、部分 OpenOptions 在 Chrome 140/141/142+

**[推断]** side panel 本身**稳定可用**，但**新的子特性版本跨度大（114→145）**——若依赖较新方法，需相应抬高 `minimum_chrome_version`。也可用 popup / 独立扩展页做 agent 控制台，减少对 side panel 版本差异的依赖。

**[推断] 另一个更致命的 MV3 问题**：service worker **会被回收**。长时间运行的 agent 会话必须在 SW 里保活或用 offscreen document，并监听 `chrome.debugger.onDetach` 处理中途断连。这是工程风险而非上架政策风险，但会引发 `Yellow Magnesium`（功能不工作）。

---

## 6. 改走 native messaging（Windows 注册要求 + 企业策略）

### 6.1 Windows 注册要求

`https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging` **[官方·原文]**

**manifest 格式**：

```json
{
  "name": "com.my_company.my_application",
  "description": "My Application",
  "path": "C:\\Program Files\\My Application\\chrome_native_messaging_host.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://knldjmfmopnpolahpmmgbagdohdnhkik/"]
}
```

**字段约束 [官方·原文]**：
- `name`：只能含**小写字母数字、下划线、点**；不能以点开头/结尾；**不能出现连续两个点**
- `path`：Linux/macOS **必须绝对路径**；**Windows 可相对 manifest 所在目录**
- `type`：唯一值 `"stdio"`
- **`allowed_origins`：值不能包含通配符**（"`allowed_origins` values *can't* contain wildcards"）

**注册表路径 [官方·原文]**：

> "On **Windows**, the manifest file can be located **anywhere in the file system**. The application installer must create a registry key, either
> `HKEY_LOCAL_MACHINE\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.my_company.my_application`
> or `HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.my_company.my_application`,
> and **set the default value of that key to the full path to the manifest file**."

```bat
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.my_company.my_application" /ve /t REG_SZ /d "C:\path\to\nmh-manifest.json" /f
```

> "When Chrome looks for native messaging hosts, **first the 32-bit registry is queried, then the 64-bit registry.**"

### 6.2 ⚠️ `allowed_origins` 的硬约束（对本项目影响重大）

**[官方·原文]**：`allowed_origins` 不能含通配符，且**必须是 `chrome-extension://<固定扩展 ID>/`**。

**[推断] 由此产生的连锁约束：**
1. **扩展 ID 必须固定**。未上架时，unpacked 扩展的 ID 随加载路径变化；必须用 manifest 里的 **`"key"` 字段**固定公钥 → 固定 ID
2. 一旦上架，CWS 分配的 ID 固定；但**开发/测试阶段的 ID 与上架 ID 可能不同**，两套 ID 都要写进 `allowed_origins`（或统一用 `key` 固定）
3. **native messaging 无法在浏览器内安装 host**：必须有 **NSIS/MSI 安装器写注册表**。这是分发体验上的重大成本——"装扩展"变成"装扩展 + 装桌面程序"
4. `HKLM` 需管理员权限；`HKCU` 可免提权，但仅当前用户生效

### 6.3 企业策略会不会阻止？

**结论：会 —— 而且是 native messaging 路线的额外风险面。**

`https://developer.chrome.com/docs/extensions/reference/api/debugger` **[官方·原文]**（Enterprise policy restrictions 节）

> "On enterprise devices, some policies can restrict extensions from attaching the debugger using an **all-or-nothing model** at attach time:
> - **Host restrictions:** If enterprise policy `ExtensionSettings` configures blocked hosts (`runtime_blocked_hosts`) for an extension, `browser.debugger.attach()` is **blocked on all targets** with the error `"Host access is restricted by policy."` (**even if individual origins are in `runtime_allowed_hosts`**).
> - **Screenshot and DLP policies:** If enterprise policy `DisableScreenshots` disables screenshot capture or Data Loss Prevention (DLP) rules apply to the target, `browser.debugger.attach()` fails with `"Screenshot capture is restricted by policy."`"

`https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions` **[官方·原文]** 补充：

> "Enterprise administrators managing extension policies should note that **extensions requiring the debugger permission cannot operate with partial host restrictions** (`runtime_blocked_hosts`). If an extension needs `chrome.debugger`, it must not have blocked hosts configured in `ExtensionSettings`."
> - 临时回退开关：`--disable-features=ExtensionDebuggerStrictPolicyRestrictions`，**将在 Chrome 160 移除**
> - **仅影响 managed 浏览器**；个人/未托管环境不受影响

相关企业策略 **[官方·索引]**（来自 Chrome 137 release notes 的策略清单，我抓到了描述文本但未逐字读各策略专页）：
- `ExtensionInstallForcelist` — "Configure the list of force-installed apps and extensions"（强制静默安装，用户**不能移除**）
- `ExtensionInstallAllowlist` / `ExtensionInstallBlocklist` — 安装白/黑名单
- `ExtensionSettings` — 扩展管理设置（含 `runtime_blocked_hosts` / `runtime_allowed_hosts` / `blocked_permissions`）
- `ExtensionDeveloperModeSettings` — "Control the availability of developer mode on extensions page"
- `ExtensionInstallSources` — 允许安装来源

**结论 [推断]**：
- **个人用户 / 未托管设备**：`chrome.debugger` **完全正常**，企业策略**不影响**
- **企业环境**：只要管理员配了 `runtime_blocked_hosts`、`DisableScreenshots` 或 DLP，**debugger attach 会整体失败**。这是 Chrome 155 起的明确行为，**无法用 `runtime_allowed_hosts` 绕过**
- Native messaging 另有风险：企业可通过 `ExtensionSettings` 的 `blocked_permissions` 单独禁掉 `nativeMessaging`，或干脆**禁止非商店来源安装**
- **企业自托管（ExtensionInstallForcelist + update_url）反而是企业环境的推荐路径**：可绕过商店审核，且能强制安装

---

## 7. 替代分发渠道

### 7.1 对比表

| 渠道 | `debugger` 态度 | 审核 | 可信度依据 |
|---|---|---|---|
| **Chrome Web Store** | ✅ **明文允许**（RHC 白名单） | 人工审核，需 justification + 申报远程代码 | **[官方·原文]** |
| **Edge Add-ons** | ✅ **很可能允许**（Chromium 内核；提交同源 CRX；Partner Center 有同样的权限理由 + 远程代码字段） | 有审核，同样需 justification | **[官方·原文]**（Partner Center 流程）+ **[推断]**（debugger API 兼容性未在 MS 文档中逐字确认） |
| **Firefox AMO** | ❌ **不适用** — Firefox **无 `chrome.debugger` 等价 API**。最接近的是 `devtools.*`（仅用于扩展 DevTools 面板，不能远程控制任意标签页） | 人工审核 + 源码提交 | **[官方·原文]**（AMO 政策）+ **[官方·索引]**（MDN devtools） |
| **企业自托管** | ✅ 允许（`ExtensionSettings` / `ExtensionInstallForcelist` + `update_url`） | 免商店审核 | **[官方·原文]** |
| **开发者模式（Load unpacked）** | ✅ 允许 | 无 | **[官方·原文]** |
| **开发者模式（`--load-extension`）** | ⚠️ **已在官方 Chrome 137+ 移除** | — | **[官方·原文]** |

### 7.2 Edge Add-ons

`https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension` **[官方·原文]**（Partner Center 提交流程）

> - "**Justify any permissions** — The Permission justification section contains a list of permissions that your extension uses (as declared in your manifest), with a field for you to state the justification for each permission."
> - "If there are permissions listed here that the extension doesn't require, **before continuing, remove them from the manifest**"
> - "The extension must request only the **minimum permissions** that are necessary to deliver its functionality."
> - "**The extension should avoid the use of remote code unless absolutely necessary. Remote code requires additional review, and might increase certification time.**"
> - "All of these disclosures must be consistent with the policies that are at the Privacy Policy URL"
> - 同样要求 **Single Purpose Description**、**Privacy Policy URL**、**data usage / limited-use certification**

**[推断]** Edge 的隐私面板字段与 Chrome 几乎一一对应（single purpose / permission justification / remote code / privacy policy / limited-use 认证），因此**一套合规材料可同时投两边**，边际成本很低。Edge 曾是许多"隐私敏感型"扩展的备份渠道。

⚠️ **不确定项**：Microsoft 的[受支持 API 列表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/api-support/supported-apis)为 JS 渲染页面，我抓取后**未能在文本中找到 `debugger` 字样**，无法逐字确认 Edge 是否暴露 `chrome.debugger`。由于 Edge 是 Chromium 且接受 Chrome CRX，**技术上极可能支持**，但建议**实测**后再承诺。**可信度：中**

### 7.3 Firefox AMO

`https://extensionworkshop.com/documentation/publish/add-on-policies/` **[官方·原文]**（经 curl 抓取）

> "**4. Development Practices** ... potentially dangerous APIs may only be used in ways that are demonstrably safe, and code within add-ons that cannot be verified as behaving safely and correctly may need to be refactored.
> - Add-ons must only request those permissions that are necessary for them to function.
> - **Add-ons must be self-contained and not load remote code for execution.**
> - Add-ons must not load or redirect to a remote new tab page.
> - Add-ons must not relax web page security headers, such as the Content Security Policy.
> - Add-ons must use encryption when transporting data remotely.
> - Add-ons should avoid including redundant code or files.
> - Add-ons must not negatively impact the performance or stability of Firefox.
> - Only release versions of third-party libraries and/or frameworks may be included..."

> "**5. User Scripts** — Usage of the `userScripts` API is allowed for user script managers only."

⚠️ **注意**：Firefox AMO 政策**没有**像 Chrome 那样给出"Debugger API / User Scripts API 允许远程执行"的明文豁免清单。AMO 是 **"must be self-contained and not load remote code for execution"** 的绝对口径 + **要求提交可读源码**（"The provided source code is reviewed by an administrator"、禁止混淆）。**Firefox 没有 `chrome.debugger`**，因此该路线对本项目**基本不可行**。**[官方·原文 + 推断]**

### 7.4 企业自托管 / 开发者模式

`https://developer.chrome.com/docs/webstore/cws-enterprise` **[官方·原文]**

> "**Force install:** Administrators can set policies that automatically and silently install extensions for users in the organization. ... **Note:** Users can't remove extensions that are force installed."
> "Domain publishing ... a nice side effect is that **domain-published extensions usually get through the review process more quickly**."

⇒ **两条企业可选路径**：
1. **Domain publishing**（Google Workspace 私有 CWS）—— **仍要过审，但官方明说更快**
2. **ExtensionInstallForcelist 强制安装**（走 `update_url` 指向自建 XML）—— **免商店审核**

**⚠️ 开发者模式的收紧（重要变化，必须知道）** —— `https://support.google.com/chrome/a/answer/10314655`（Chrome 137 release notes）**[官方·原文]**

> "**Chrome 134**: Starting in Chrome 134, **unpacked extensions loaded from the `chrome://extensions` page will only be enabled if the developer mode switch is turned on.** ... An enterprise policy, `ExtensionDeveloperModeSettings`, is available to gate the existing developer mode switch."

> "**Remove `--load-extension` command line switch** — Starting in Chrome 137 ... **official Chrome branded builds will be deprecating the ability to load extensions via the `--load-extension` command-line flag** ... Unpacked extensions can be loaded via the **Load Unpacked** button on the extension management page (`chrome://extensions/`) **with developer mode enabled**. Developers can still use the `--load-extension` switch in **non-branded builds such as Chromium and Chrome For Testing**."

⇒ **对 agent 类工具的影响**：自动化启动（"启动 Chrome 时自动带上我的 agent 扩展"）已不能依赖 `--load-extension`。**必须改用 Chromium / Chrome for Testing，或走 CDP 的 `--remote-debugging-port` + `Extensions.loadUnpacked`，或让用户手动 Load unpacked。**

### 7.5 关于"实际有没有 debugger 类扩展在架上" **[第三方]**

- 我尝试检索架上 AI agent 扩展（如 "Do Browser: AI Browser Agent" <https://chromewebstore.google.com/detail/do-browser-ai-browser-age/hjcibkpfgnljonndnnanhkholafmgmip>、Ui.Vision <https://chromewebstore.google.com/detail/uivision/gcbalfbdmfieckjlnblleoemohcganoc>）以确认其是否声明 `debugger`，但 **Chrome Web Store 详情页为 JS 渲染，`curl.exe` 无法解析出权限声明**，**未能取得一手证据**。
- 因此"某某 AI agent 扩展正在架上用 debugger"这一说法在本报告中**不作为依据**。
- **可确证的事实**：Ui.Vision（RPA/自动化类）与 Do Browser（AI browser agent）**确实在架**，说明此类目未遭整体封禁。**可信度：中**（存在性可查，权限构成未验证）。

---

## 8. 隐私合规

### 8.1 触发条件：你**一定**要发隐私政策

`https://developer.chrome.com/docs/webstore/program-policies/user-data-faq` **[官方·原文]**

> "**2. What does 'handle' mean in the User Data Policy?** ... Here are some examples of functionality that handle user data:
> - **Clipping or scraping content from a website that the user visits, such as taking screenshots or capturing data from a web page**
> - Collecting data obtained from web requests ...
> - **Collecting web browsing activity and any information about the website content or resources a user requests or interacts with**, including the domains or URLs the browser interacts with, the content of the HTTP requests and responses, and data in a website's browser storage (like cookies)"
>
> "**3. Does an extension need to disclose user data handling if the data is only processed or stored locally on a user's device?** **Yes.** Extensions are required to disclose how they handle user data, **even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties**."
>
> "**4. What are examples of user data?** ... **Website content and resources**, **Form data**, **Web browsing activity** ..., **Personal communications**, and **User-generated content**."

⇒ **你的扩展（读 DOM / 截图 / 输入）100% 命中"handle user data"，必须发隐私政策 —— 即使全部本地处理、从不外传。**

### 8.2 隐私政策必须包含什么

**政策原文**（`https://developer.chrome.com/docs/webstore/program-policies/privacy`）**[官方·原文]**

> "1. If your Product handles any user data, then you must post an accurate and up to date privacy policy.
> 2. The privacy policy must, together with any in-Product disclosures, **comprehensively disclose**:
>    1. How your Product collects, uses and shares user data
>    2. **All parties the user data will be shared with**
> 3. You must make the policy accessible by providing a **link in the designated Chrome Web Store Developer Dashboard field**."

**官方建议的三段结构**（`user-data-faq` §7）**[官方·原文]**

> - **What information do you collect?** — "Explain **all** the information your extension collects. This includes information that you may collect automatically, such as server and HTTP logs, data transmitted by the extension to you, and usage information. This also includes information that you get from the user, either directly or via the permissions API, **including persistent identifiers**."
> - **How do you use the information?** — "Disclose how you use the information you collect."
> - **What information do you share?** — "Describe the circumstances when you share information."

**加密要求**（§8、§9）**[官方·原文]**

> "Extensions must transmit user data over a secure connection (**e.g. HTTPS, WSS**) and **stored at rest using a strong encryption method such as RSA or AES**. You should not use any cipher suite that is denylisted by IETF."

**⚠️ 一个好的豁免**（§16）**[官方·原文]**

> "**16. Does data transmitted between a Chrome app or extension and native programs on the same computer need to be encrypted?** **No.** The requirement to handle the user data securely (under the Handling Requirements section) **does not apply to transmissions between a Chrome extension or app and a native program on the same computer.**"

### 8.3 ⚠️ 显著披露 + 明确同意（Prominent Disclosure）

`user-data-faq` §10 **[官方·原文]**

> "You must describe the types of user data to be collected and how they will be used, and **obtain the user's consent** to that collection and use. You must present the disclosure in a **prominent** way, so that the user sees it **prior to agreeing**. The disclosure ... **must not be located only in a privacy policy, terms of service, or similar document.**
> To obtain consent, the Product must ask the user to agree to the prominent disclosure in a manner that requires them to take a **specific action** clearly agreeing to the disclosure before collecting or handling user data.
> **The prominent disclosure and consent must occur within the Product's user interface. Disclosures in the Chrome Web Store description or inline installation page do not satisfy this requirement.**"

**[推断] 对你的产品的具体含义**：首次启动 agent 功能时，必须在**扩展自己的 UI 内**（onboarding 页 / side panel）弹出一个**明确的同意界面**，逐项列出"将读取你访问的网页内容（DOM）、截取页面截图、代你执行点击与输入、并将这些数据发送至 XXX 服务器"，用户必须**主动点击"同意"**才能启用。仅放个隐私政策链接**不合格**。

### 8.4 Limited Use（受限使用）

**政策原文**（`https://developer.chrome.com/docs/webstore/program-policies/limited-use`）**[官方·原文]** —— 全文 6 条，与 agent 最相关的：

> "2. You must **limit your use of the data to the practices you disclosed**.
> 3. Extensions may only collect, use, or transmit user data that is **necessary for the extension's disclosed single purpose**, including related operational purposes, such as maintaining, securing, or measuring the performance and reliability of those features.
> 4. **Collection and use of web browsing activity is prohibited, except to the extent required for a user-facing feature described prominently in the Product's Chrome Web Store page and in the Product's user interface.**
> 5. Upon accessing user data for a single purpose, your use of the user data obtained must comply with the following requirements. The requirements apply to both the raw data obtained and the data aggregated, anonymized, de-identified, or derived from the raw data. **They also apply to scraped content or otherwise automatically gathered user data.**
>    1. Limit your use of user data to providing or improving your single purpose
>    2. Only transfer user data to third parties — if necessary to providing/improving your single purpose; to comply with applicable laws; to protect against malware/spam/phishing/abuse; or as part of a merger/acquisition/sale after explicit prior consent
>    3. **Do not allow humans to read user data**, unless: (i) the user's explicit consent to read specific data is obtained; (ii) the data is aggregated and anonymized for internal operations; (iii) necessary for security purposes; or (iv) to comply with applicable laws
>    4. All other transfers, uses, or sale of user data is **completely prohibited**, including: transferring/using/selling data for **personalized advertisements**; transferring/selling to third parties like **advertising platforms, data brokers, or other information resellers**; transferring/using/selling to determine **credit-worthiness or for lending purposes**.
> 6. An **affirmative statement** that your use of the data complies with the Limited Use restrictions must be **disclosed on a website belonging to your extension**; for example, a link on a homepage to a dedicated page or privacy policy noting: **'The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.'**"

`user-data-faq` 补充 **[官方·原文]**：
- Limited Use 四要素：**Allowed use / Allowed transfer / Prohibited advertising / Prohibited human interaction**
- "**Does all user data need to be encrypted?** This policy establishes a minimal requirement of encrypting transmissions of all user data"
- §7 "**necessary for functionality**" — "Google considers whether the data collection is **proportionate** to the extension's stated single purpose and consistent with user expectations. **Data collection for unrelated advertising, profiling, or generalized market research purposes is not considered necessary.**"
- §8 — 可以收 analytics/性能数据，但必须：清楚披露、**与目的成比例**、避免收集与功能无关的数据

### 8.5 ⚠️ 对"人类不得读取用户数据"的特别警示

Limited Use §5.3 与 FAQ §6 **禁止开发者让人类阅读用户数据**。对 agent 类产品这是**高风险条款**：

- 若你的服务端**人工审核会话日志**（调试、质检、训练）→ **需要用户对"特定数据"的显式同意**
- 若把用户 DOM/截图用于**任何形式的模型训练**且未经显式同意 → 需要谨慎评估，可能被认定为超范围使用
- 常见的合规写法：**用户可选择开启"允许我们在脱敏后用于改进产品"**；默认关闭；并提供**聚合/匿名化**路径

### 8.6 ⚠️ 最严重的后果：三方不一致

`user-data-faq` §3 **[官方·原文]**

> "**3. What happens if there are inconsistencies between my item's privacy policy, the disclosures provided through the developer dashboard, and the behavior of my item?** ... Any discrepancies between the developer dashboard disclosures, your privacy policy, and the behavior of your item **would be a violation** of the Chrome Web Store developer program policies. This can result in **the suspension of all the items owned by the publisher, deactivation of the existing user-base, and ban of the entire publisher entity (including related accounts).**"

⇒ **隐私政策、Dashboard 表单、代码实际行为三者必须逐字一致。** 这是最容易被低估的封号风险。

### 8.7 Dashboard 必填项清单

`https://developer.chrome.com/docs/webstore/cws-dashboard-privacy` **[官方·原文]**

1. **Single purpose description** — 必须"narrow and easy to understand"
2. **Permissions justification** — 每个权限逐一说明；未使用的必须从 manifest 删除
3. **Remote Code** — 声明是否执行远程代码（**你必须选 Yes**）
4. **Data usage** — 勾选收集的数据类型 + 认证符合 Limited Use
5. **Privacy policy URL**

未填写后果 **[官方·原文]**：`user-data-faq` §2 — "Starting March 2021, the Chrome Web Store team will reach out to developers with a warning to complete the disclosure requirement. **Inaction after 30 days of the warning will result in the suspension of affected items and the deactivation of the existing user-base.**"

---

## 9. 上架检查清单（可执行）

### 9.1 Manifest

```jsonc
{
  "manifest_version": 3,
  "name": "...",
  "version": "1.0.0",
  "description": "...",            // ≤132 字符，CWS 必需
  "icons": { /* CWS 必需 */ },
  "minimum_chrome_version": "125", // debugger flat sessions
  "permissions": [
    "debugger",          // 核心
    "storage"
    // ❌ 不要放 "tabs"、"scripting"、任何 host pattern —— 除非确实在用
  ]
  // ❌ 不要 "host_permissions": ["<all_urls>"]  ← debugger 不需要
  // ❌ 不要 "content_scripts" 泛匹配
  // 如确需注入 → "activeTab" 或 "optional_host_permissions"
}
```

### 9.2 Dashboard 填写要点 **[推断，基于官方字段要求]**

- **Single purpose**：写成"让用户通过自然语言指令驱动 AI agent 在其本人浏览器中自动完成网页操作"这样一个**窄而清楚**的目的；**不要**写成"AI 助手平台"这类宽泛说法
- **`debugger` 权限理由**：必须点明**为什么 `chrome.scripting`/`activeTab` 不够**（真实输入事件、跨 iframe/OOPIF 一致控制、CDP 截图与网络能力），并说明**用户可见横幅 + 可随时中止**
- **Remote Code**：**选 "Yes"**，写"通过 Chrome Debugger API（MV3 requirements 明文许可的远程执行 API）执行 agent 下发的 CDP 命令；扩展包内不含任何远端脚本加载"
- **Data usage**：勾选 **Website content**、**Web browsing activity**（必须，因为读 DOM/URL）、**Screenshots**（如适用）；如实勾选，宁可多不可少
- **Privacy policy URL**：必须可访问、内容与表单一致

### 9.3 隐私政策必备段落 **[推断，基于官方要求]**

1. 收集什么（DOM 内容、URL/域名、截图、表单输入、会话日志）
2. 如何使用（仅用于执行用户指令）
3. 与谁共享（列出**全部**接收方：LLM 供应商、云服务商、分析服务）
4. 传输与存储加密（HTTPS/WSS + 静态 AES/RSA）
5. 保留期限、删除方式
6. **人工读取政策**（默认不读；如用于改进则须显式同意）
7. **Limited Use 声明原文**："The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."
8. 不用于广告、不出售、不用于信用评估

### 9.4 产品内（防 `Purple Potassium` / 隐私违规）

- **首次启用必须有带主动同意的 onboarding**（不能只放链接）
- 必须在 UI 里常驻显示"agent 正在操作"状态 + **一键中止**
- 处理 `chrome.debugger.onDetach`，用户关闭调试横幅时优雅退出
- 捕获 Chrome 155 的两种企业策略错误：`"Host access is restricted by policy."` / `"Screenshot capture is restricted by policy."`，给出清晰提示
- **不要**为了"以后可能用到"而留下任何未调用的权限

### 9.5 提交策略建议 **[推断]**

1. **先私密/Unlisted 试投**（同样过审，但失败不公开、便于验证审核口径）
2. 若因 `Blue Argon` 被拒，重点排查**编译后产物**里的 `http://` / `https://` 字符串与依赖中的远端 import（官方明说："make sure you are searching the **compiled** version of the code"）
3. 代码**尽量以源码形态提交**、避免混淆（官方："Obfuscation is disallowed"、minify 允许但增加审核难度）
4. 被拒后**不要立刻反复重投**（官方：被拒后审核时间会更长）；先申诉或按指引修复
5. 同步准备 Edge Add-ons 提交（材料可复用）

---

## 10. 最终裁决

### ❓ 用 `chrome.debugger` 权限做的 agent 扩展，能不能通过 Chrome Web Store 审核？

## ✅ 能 —— 这是 Google 官方明文允许的做法。

**最强依据（官方原文，见 §1.2a）**：Chrome Web Store 的《Additional Requirements for Manifest V3》把 **Debugger API 与 User Scripts API 并列为"允许从远端执行逻辑"的仅有两个 API**。第二份官方文档（`remote-hosted-code`）在 "Is there any workaround?" 一节里，把一个本应"Generally speaking, no"的问题对 `browser.debugger` 单独开了口子，并明确写道"With it, an extension **can request and execute remote code**"。

**真正的风险不在"能不能用 debugger"，而在以下 5 点（按风险从高到低）**：

| 风险 | 后果 | 规避 |
|---|---|---|
| 1. Dashboard **未申报远程代码** | 官方明文"**will be rejected**" | Remote Code 选 Yes + 说明理由 |
| 2. 为 debugger **多申请 `<all_urls>`** | 触发 broad host permission 深度审查，延迟数周；可能被判过度权限 | **直接删掉** —— debugger 不需要 host permission |
| 3. **声明的权限未真实使用** | `Purple Potassium` 拒审 | 只留实际调用的权限 |
| 4. **单用途描述过宽** | 达不到 single purpose 要求 | 窄化到"代用户在其浏览器中执行网页操作" |
| 5. **隐私政策/表单/行为不一致** | 可导致**账号封禁 + 存量用户被停用** | 三者逐字对齐；产品内显著披露 + 主动同意 |

**必须接受的固有代价（无法规避，是产品设计约束）**：

- 🔴 **Chrome 无法关闭的调试横幅**：debugger 附加期间，Chrome 会在窗口顶部常驻"*Debugger Extension started debugging this browser*"横幅；**用户关闭横幅 ⇒ 会话立即终止**（官方原文）。这决定了你的产品**必须能被随时打断**，且 UX 上要让用户理解这条横幅。
- 🔴 **企业环境可能整体不可用**（Chrome 155+）：管理员一旦配置 `runtime_blocked_hosts` / `DisableScreenshots` / DLP，`attach()` **在所有目标上失败**，且**不能用 `runtime_allowed_hosts` 绕过**。
- 🟠 **人工审核 + 较长时长**：新开发者 + 新扩展 + 敏感权限叠加，建议预算 1–3 周。
- 🟠 **无法用 `--load-extension` 自动部署**（Chrome 137+ 官方版已移除），必须 Load unpacked 或改用 Chromium / Chrome for Testing。

**若被拒或不愿承担审核不确定性，推荐退路**（按推荐度）：
1. **Edge Add-ons** —— 隐私面板字段与 Chrome 几乎一致，材料可复用，边际成本最低
2. **企业自托管**（`ExtensionInstallForcelist` + `update_url`）—— 免商店审核，且能强制安装
3. **开发者模式分发**（Load unpacked + 安装脚本）—— 零审核，但用户体验差、Chrome 134+ 强制要求开发者模式常开
4. ~~Firefox AMO~~ —— **不可行**，Firefox 无 `chrome.debugger` 等价 API

---

## 附录 A：官方文档 URL 清单（均已逐字抓取核对）

| 主题 | URL |
|---|---|
| MV3 附加要求（**RHC 白名单**） | https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements |
| 远程托管代码（**browser.debugger 例外**） | https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code |
| Debugger API 参考 | https://developer.chrome.com/docs/extensions/reference/api/debugger |
| 企业策略对 debugger 的收紧（Chrome 155） | https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions |
| 审核流程（时长 / 敏感权限） | https://developer.chrome.com/docs/webstore/review-process |
| 审核状态与人工审核 | https://developer.chrome.com/docs/webstore/check-review |
| 违规 ID 与修复（Blue Argon 等） | https://developer.chrome.com/docs/webstore/troubleshooting |
| 权限警告清单（debugger 两条警告） | https://developer.chrome.com/docs/extensions/reference/permissions-list |
| **Host permissions 不需要**（debugger 例外） | https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions |
| 权限声明概念 | https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings |
| Privacy 面板填写（**Remote Code 字段**） | https://developer.chrome.com/docs/webstore/cws-dashboard-privacy |
| 隐私政策政策 | https://developer.chrome.com/docs/webstore/program-policies/privacy |
| Limited Use 政策 | https://developer.chrome.com/docs/webstore/program-policies/limited-use |
| Use of Permissions 政策 | https://developer.chrome.com/docs/webstore/program-policies/permissions |
| 用户数据 FAQ（**显著披露/同意**） | https://developer.chrome.com/docs/webstore/program-policies/user-data-faq |
| 全部政策单页版 | https://developer.chrome.com/docs/webstore/program-policies/policies |
| Native messaging（Windows 注册表） | https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging |
| Manifest 键清单 | https://developer.chrome.com/docs/extensions/reference/manifest |
| minimum_chrome_version | https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version |
| Side Panel API（Chrome 114+） | https://developer.chrome.com/docs/extensions/reference/api/sidePanel |
| 分发可见性（Private 也要过审） | https://developer.chrome.com/docs/webstore/cws-dashboard-distribution |
| 企业分发总览 | https://developer.chrome.com/docs/webstore/cws-enterprise |
| Chrome 137 release notes（`--load-extension` 移除 / Chrome 134 开发者模式） | https://support.google.com/chrome/a/answer/10314655 |
| Edge Partner Center 提交流程 | https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension |
| Firefox AMO 开发者政策 | https://extensionworkshop.com/documentation/publish/add-on-policies/ |
| One Stop Support（申诉/咨询） | https://support.google.com/chrome_webstore/contact/one_stop_support |

## 附录 B：第三方来源（仅作旁证，已标注可信度）

| 来源 | 用途 | 可信度 |
|---|---|---|
| https://june07.com/chrome-web-store-rejection-notification-purple-potassium/ | 真实开发者 8 次遭 `Purple Potassium` 误报（与 debugger 权限相关），**但每次最终过审** | 中（情绪化、有立场；事实部分与官方一致） |
| https://raw.githubusercontent.com/lagrangee/weread_deepreading/main/SUBMISSION_RESPONSE.md | `Purple Potassium` = 请求但未使用权限的独立佐证 | 中 |
| https://raw.githubusercontent.com/MuckRock/Klaxon-Cloud/main/plans/optional-host-permissions.md | 开发者实测"broad host permissions 会让审核延迟数周"；已改用 `optional_host_permissions` | 中（核心事实已被官方原文独立证实） |
| https://dev.to/rory_1af399b9b9528d47ab36/how-to-fix-the-purple-potassium-chrome-web-store-rejection-and-catch-it-before-you-submit-414b | `Purple Potassium` 的排查方法 | 低-中（未逐字核实全文） |

## 附录 C：本报告未能确证的事项（诚实披露）

1. **Edge 是否暴露 `chrome.debugger`** —— Microsoft API 支持列表为 JS 渲染，未能抓到 `debugger` 字样。技术上几乎必然支持（Chromium 内核），但**建议实测**。
2. **架上 AI agent 扩展的实际权限构成** —— Chrome Web Store 详情页为 JS 渲染，`curl.exe` 无法解析权限声明，故未采信"某扩展正在用 debugger"的说法。
3. **`minimum_chrome_version: "125"` 是否最优** —— 基于 flat sessions（官方标注 Chrome 125+）的工程推断，非官方推荐值。
4. **Chrome Web Store 是否有"debugger 专项 justification 表单"** —— 未发现专门表单；官方只用统一的 *Permissions justification* 字段（已原文引用）。

---

*报告生成：2026-10-12 · 所有 [官方·原文] 引文均从 developer.chrome.com 官方 `.md.txt` 端点逐字抓取*
