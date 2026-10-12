# BUA（Browser Use Agent）同类项目调研报告

> **调研对象**：拟建项目 = Chrome MV3 扩展 + 本地桥（WebSocket），让**任意** AI agent 操作用户**真实浏览器**（真实标签页、真实登录态），API 对齐 OpenAI Codex 的 CUA / Browser Use API。
> **调研日期**：2026-10-12
> **方法**：`web_search` + `curl.exe` 直取 raw 文件 / GitHub HTML / npm / PyPI / 官方文档。
> **约束**：本机 `web_fetch` 无法访问 `github.com`、`developer.chrome.com`（DNS fake-IP），所有此类内容均通过 `curl.exe` 获取。

## 可信度标注约定

| 标记 | 含义 |
|---|---|
| ✅ **已确认** | 直接读到一手源码 / 官方文档 / 官方规范原文，附 URL |
| 🟡 **间接确认** | 来自第三方文档、逆向笔记、二手教程，来源可查但非官方 |
| ⚠️ **推测/未确认** | 我的推断，或无法验证的声明 |

**Star 数**：2026-10-12 通过 `curl.exe` 抓取 GitHub 仓库页面 HTML 中的 `"stargazerCount"` 字段得到，为**量级参考**，非精确值。

---

## 0. 总览对比表

| 项目 | 仓库 / URL | 技术路线 | API 风格 | 许可 | Stars 量级 | 有状态/持久会话 |
|---|---|---|---|---|---|---|
| **Playwright MCP** | `microsoft/playwright-mcp` | Node 进程内启动/连接浏览器，CDP（Playwright 封装）；`--extension` 走扩展连接真实浏览器 | MCP tools，`browser_*` snake_case | Apache-2.0 ✅ | ~38k | ✅ 持久 profile + 显式 tab 索引 |
| **chrome-devtools-mcp** | `ChromeDevTools/chrome-devtools-mcp` | Puppeteer + CDP；`--autoConnect`/`--browserUrl`/`--wsEndpoint` 连真实 Chrome | MCP tools，扁平 `snake_case` | Apache-2.0 ✅ | ~53k | ✅✅ `pageId` 路由 + 持久 user-data-dir |
| **browser-use** | `browser-use/browser-use` | Python，自带浏览器 + 可选真实浏览器；MCP server 内置 | MCP tools `browser_*` + index/坐标双模 | MIT ✅ | ~118k | ✅✅ 多 session + TTL 过期 |
| **Chrome MCP Server** | `hangwin/mcp-chrome` | **MV3 扩展 + Native Messaging + Streamable HTTP(12306)** | MCP over HTTP，`chrome_*` | MIT ✅ | ~12k | ✅ 跨标签页上下文 |
| **Browser MCP** | `browsermcp/mcp` + 扩展 | **MV3 扩展 + 本地 WebSocket:9009** | MCP tools `browser_*` | Apache-2.0 ✅ | ~7k | ⚠️ 单连接，新连接踢掉旧连接 |
| **open-browser-use** | `iFurySt/open-browser-use` | **MV3 扩展 + Go Native Messaging + Unix socket** | JSON-RPC + CLI + JS/Py/Go SDK + MCP | MIT ✅ | **~365（早期项目）** | ✅✅ tab group + `chrome.storage.local` 恢复 |
| **Codex Chrome 扩展 1.1.4** | Chrome Web Store `hehggadaopoacecdllhhajmbjkdcmajg` | **MV3 扩展 + Native Messaging + native pipe** | JSON-RPC + `cua_*`/`playwright_*` 命令 | 专有 | — | ✅✅ `session_id` + `turn_id` |
| **Nanobrowser** | `nanobrowser/nanobrowser` | **纯扩展**（无本地桥），多 agent | 扩展内 UI，非对外 API | Apache-2.0 ✅ | ~14k | ⚠️ 扩展内会话 |
| **Stagehand** | `browserbase/stagehand` | Node/Python SDK，CDP/Playwright | `act`/`extract`/`observe`/`agent` | MIT ✅ | ~26k | ✅ |
| **Hermes agent（参考实现）** | `NousResearch/hermes-agent` | 独立 Chromium / real-profile 快照 / CDP | 自有 `browser_*` tools | MIT ✅ | ~253k | ✅ CDP supervisor 持久 WebSocket |
| **patch-browser** | `DreamXiaoJing/debug-default-profile` | **二进制补丁**绕过 Chrome 默认 profile CDP 限制 | 非 agent，纯工具 | MIT ✅ | — | N/A |

---

## 1. 方向一：浏览器 MCP 服务器

### 1.1 Playwright MCP（`microsoft/playwright-mcp`）

- **URL**：<https://github.com/microsoft/playwright-mcp> ｜ 文档 <https://playwright.dev/mcp/capabilities>
- **技术路线**：Node 进程；默认自己 launch Chromium；`--cdp-endpoint` 连接已有 CDP；`--extension` 通过「Playwright Extension」连接正在运行的真实 Edge/Chrome。✅
- **许可**：Apache-2.0 ✅（读 `LICENSE` 头部确认）
- **Stars**：~38,037 ✅
- **API 风格**：MCP tools，**全部 `browser_` 前缀 snake_case**，且**每个工具都带 `read-only: true/false` 标注**（README 自动生成区块）。✅

**核心工具与参数（节选，均为一手 README）** ✅

| 工具 | 参数（`?` = 可选） | read-only |
|---|---|---|
| `browser_navigate` | `url` | false |
| `browser_navigate_back` | — | false |
| `browser_click` | `element?`, `target`, `doubleClick?`, `button?`, `modifiers?` | false |
| `browser_type` | `element?`, `target`, `text`, `submit?`, `slowly?` | false |
| `browser_snapshot` | `target?`, `filename?`, `depth?`, `boxes?` | **true** |
| `browser_take_screenshot` | `element?`, `target?`, `type?`, `filename?`, `fullPage?`, `scale?` | **true** |
| `browser_find` | `text?` \| `regex?`, `filename?` | **true** |
| `browser_fill_form` | `fields` (array) | false |
| `browser_select_option` | `values` (array) | false |
| `browser_hover` / `browser_drag` / `browser_drop` | … | false |
| `browser_press_key` | `key` | false |
| `browser_wait_for` | `time?`(≤30s), `text?`, `textGone?` | false |
| `browser_tabs` | `action`, `index?`, `url?` | false |
| `browser_evaluate` | `function`, `element?`, `target?`, `filename?` | false |
| `browser_file_upload` | `paths?`（省略则取消） | false |
| `browser_run_code_unsafe` | `code?` \| `filename?` | false |
| `browser_handle_dialog` | `accept`(bool), `promptText?` | false |

**关键设计点（我们能学的）** ✅

1. **`browser_click` 的 `element` / `target` 双参数**：`element` 是「人类可读描述」，官方注释写明用途是 **"used to obtain permission to interact with the element"**。这是一个**把审批粒度嵌进 schema** 的设计——不只是 ref，还带语义描述用于用户确认。**这点非常值得抄**。
2. **`browser_run_code_unsafe`**：官方描述直言 *"Unsafe: executes arbitrary JavaScript in the Playwright server process and is RCE-equivalent."*——诚实标注破坏性能力，配 MCP `destructiveHint` 语义。⚠️ 但它本身没有标注 `readOnlyHint:false` 之外的任何防护。
3. **`--caps` 能力分层**：`vision` / `pdf` / `devtools` / `network` / `storage` / `config` / `testing`。工具集按能力裁剪，默认只暴露核心集。**这是很干净的「工具面收敛」机制**，值得抄。
4. **坐标输入默认关闭**：`browser_mouse_click_xy` 等只在 `--caps=vision` 下出现，需 computer-use 模型。✅
5. **持久会话**：默认 `--isolated` 关闭，profile 落在 `~/.cache/ms-playwright/mcp-chrome-profile`（README 称 persistent profile），并明确警告 *"A persistent profile can only be used by one browser instance at a time, so concurrent MCP clients sharing the same workspace will conflict."* ✅ 另有 `--storage-state` 导入 cookies/localStorage、`browser_storage_state` 导出。
6. **`--allowed-hosts`**（env `PLAYWRIGHT_MCP_ALLOWED_HOSTS`）：注释为 *"comma-separated list of hosts this server is allowed to serve from. Defaults to the host the server is bound to. Pass `'*'` to disable the host check."* ——**这是针对自家 HTTP server 的 DNS rebinding 防护（Host 头校验）**。
7. **`--allowed-origins` / `--blocked-origins`**：官方注释**自认不是安全边界**：*"Important: does not serve as a security boundary and does not affect redirects."* ✅ **重要反面教材**：URL 黑名单无法防重定向绕行。

**它没解决什么**

- `--extension` 模式的实现细节、握手、鉴权在 README 中**未见描述** ⚠️。
- 没有「按域名索要用户审批」的机制（`--allowed-origins` 自认非安全边界）。
- `--extension` 的具体连接协议无文档 → 逆向成本高。

---

### 1.2 chrome-devtools-mcp（`ChromeDevTools/chrome-devtools-mcp`）

- **URL**：<https://github.com/ChromeDevTools/chrome-devtools-mcp> ｜ 工具参考 `docs/tool-reference.md`
- **技术路线**：**Puppeteer 驱动 Chrome**（官方 README 明写 "Uses puppeteer to automate actions in Chrome and automatically wait for action results"）。支持 `--browserUrl` / `--wsEndpoint` / `--wsHeaders` 连已有 Chrome。✅
- **许可**：Apache-2.0 ✅
- **Stars**：~53,301 ✅（本次调研中 star 数最高的浏览器 MCP）
- **API 风格**：MCP tools，**扁平 snake_case，无统一前缀**（`click` / `fill` / `navigate_page`）。✅

**工具分组（一手 `docs/tool-reference.md`）** ✅

| 组 | 工具 |
|---|---|
| Input automation (10) | `click`, `drag`, `fill`, `fill_form`, `handle_dialog`, `hover`, `press_key`, `type_text`, `upload_file`, `click_at` |
| Navigation (6) | `close_page`, `list_pages`, `navigate_page`, `new_page`, `select_page`, `wait_for` |
| Emulation (2) | `emulate`, `resize_page` |
| Performance (3) | `performance_analyze_insight`, `performance_start_trace`, `performance_stop_trace` |
| Network (2) | `get_network_request`, `list_network_requests` |
| Debugging (9) | `evaluate_script`, `get_console_message`, `get_css_styles`, `lighthouse_audit`, `list_console_messages`, `take_screenshot`, `take_snapshot`, `screencast_start`, `screencast_stop` |
| Memory (14) | `take_heapsnapshot`, `analyze_heapsnapshot_contexts`, `query_heapsnapshot_objects`, … |
| Extensions (5) | `install_extension`, `list_extensions`, `reload_extension`, `trigger_extension_action`, `uninstall_extension` |
| Third-party (2) | `execute_3p_developer_tool`, `list_3p_developer_tools` |
| **WebMCP (2)** | **`execute_webmcp_tool`, `list_webmcp_tools`** |
| PWA (4) | `get_os_app_state`, `install_pwa`, `launch_pwa`, `uninstall_pwa` |

**参数要点（一手）** ✅

- **每个 page-scoped 工具都有 `pageId` (number, required)** —— `documented as "Targets a specific page by ID."`
- 元素定位用 **`uid` (string)**，来自 `take_snapshot` 的 a11y 树快照，**不是 CSS selector**。
- 大多数交互工具有 `includeSnapshot` (boolean, optional)，默认 false —— **允许把「操作+重新快照」合并成一次往返，省 token**。这是很聪明的设计。
- `fill_form` 一次填多个：`elements` (array) + `pageId`；描述里明确 *"ALWAYS prefer this tool over multiple individual 'fill' or 'click' calls … reduces turn count."*
- `navigate_page`：`type`(enum `url|back|forward|reload`)、`url`、`timeout`、`ignoreCache`、`handleBeforeUnload`(enum `accept|dismiss`)、**`initScript`（新文档前注入脚本）**。
- `new_page`：`url`, `background`, `isolatedContext`（**命名隔离 context，用于干净 cookie/登录态测试**）, `timeout`。
- `click_at`：`x`, `y`, `dblClick?` ——「requires flag: `--experimentalVision=true`」。
- `evaluate_script`：`function` \| `sourcePath`, `args`, `format`(enum `function|script`), `dialogAction`, `waitForStableDom`, `filePath`。**明确拒绝 ESM**。

**有状态/持久会话设计（重点）** ✅✅

1. **`--pageIdRouting`（默认 true）**：官方描述 *"Require pageId on page-scoped tools and route requests by page ID (useful for concurrent agent sessions)."* —— **这是本次调研里最成熟的「多会话共享一个浏览器」设计**：服务端持有 browser，每个会话拿一个 `pageId`，工具调用显式声明目标页，避免共享 mutable "selected page"。另有 `select_page` 提供 sticky 语义。**强烈建议 BUA 直接采用 `pageId` 显式路由而非隐式 current-tab。**
2. **持久 user-data-dir**：默认 `~/.cache/chrome-devtools-mcp/chrome-profile`（Windows `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile`），非 stable 通道追加后缀（`-canary`）。*"The user data directory is not cleared between runs and is reused for subsequent runs… Only one browser can use it at a time."* `--isolated` 则用临时目录。
3. **连接真实 Chrome 的两条路**（`docs/advanced-usage.md`）✅：
   - **自动（Chrome 144+）**：用户在 `chrome://inspect/#remote-debugging` 打开远程调试开关，服务端用 **`--autoConnect`** 连接，Chrome 弹出**许可对话框**，用户点 Allow。官方补充：*"The autoConnect option requires the user to start Chrome. If the user has multiple active profiles, the MCP server will connect to the default profile… The MCP server has access to all open windows for the selected profile."*
   - **手动**：`--browser-url=http://127.0.0.1:9222`。
   - ⚠️ **官方安全警告原文**：*"Enabling the remote debugging port opens up a debugging port on the running browser instance. **Any application on your machine can connect to this port and control the browser.** Make sure that you are not browsing any sensitive websites while the debugging port is open."*

**安全相关开关（`docs/configuration.md`）** ✅ —— 这一组是本次调研里**最完整的「能力收窄」清单**，值得整体借鉴：

| 开关 | 语义 |
|---|---|
| `--blockedUrlPattern` | 用 [URLPattern](https://urlpattern.spec.whatwg.org/) 阻断网络访问；**连接时静默 detach 掉被阻断的 target**，并阻断运行时请求（含导航与子资源）；**拒绝含 regexp group / named group 的 pattern**（因为「在重定向和子资源上无法强制执行」） |
| `--allowedUrlPattern` | 白名单版，**要求 Chrome 149+**，同样静默 detach 未允许的 target |
| `--javascriptEvaluation=false` | 关闭 `evaluate_script`、关闭 `navigate_page.initScript`、**禁止导航到 `javascript:` / `data:` / `vbscript:`** |
| `--fileNavigations=false` | 禁止 `file:` URL（含指向它们的 `view-source:`）；官方明确 **"It is not a filesystem sandbox"** |
| `--redactNetworkHeaders` | 返回客户端前脱敏敏感网络头 |
| `--slim` | 只暴露 3 个工具（导航 / 脚本执行 / 截图） |
| `--filesystemRoot` / `--allowUnrestrictedPaths` | 文件工具路径限制，默认限制在 OS 临时目录（未协商 MCP roots 时） |
| `--cat*` 系列 | 按类别裁剪工具（`--categoryInput=false` 等），**默认全开** |
| `--categoryExperimentalWebmcp` | 启用 WebMCP 工具，**需 Chrome 150+ 且带 `--enable-features=WebMCP`** |
| `--pageIdRouting` | 见上 |

**它没解决什么**

- **默认仍是「新开一个 Chrome 实例」**，不是用户日常浏览器；接真实浏览器要 `--autoConnect`（Chrome 144+ 且用户手动开开关）或开调试端口（官方自己警告不安全）。
- `--blockedUrlPattern` 的 pattern 校验说明**承认了 URL 级过滤的固有缺陷**（不覆盖重定向/子资源），这是一个**我们必须在设计里正面回答的坑**。
- 没有「相同 action 的用户审批」机制，只有启动期静态开关。
- 收集使用统计（`--usageStatistics` 默认 true）。

---

### 1.3 browser-use（`browser-use/browser-use`）

- **URL**：<https://github.com/browser-use/browser-use> ｜ MCP 文档 <https://docs.browser-use.com/open-source/customize/integrations/mcp-server>
- **技术路线**：Python 库 + 自带 Chromium；MCP server 走 stdio。✅（源码 `browser_use/mcp/server.py`）
- **Stars**：~117,665 ✅（本方向最高）
- **许可**：MIT ✅
- **API 风格**：MCP tools `browser_*`；**支持「索引」与「坐标」双模**。✅

**工具与 schema（一手 `server.py`）** ✅

| 工具 | schema 关键字段 |
|---|---|
| `browser_navigate` | `url` (string, required), `new_tab` (boolean, default false) |
| `browser_click` | `index` (int, "from browser_get_state"), `coordinate_x`/`coordinate_y` (int), `new_tab` (bool)。描述：*"Click an element by index or at specific viewport coordinates… Provide this OR coordinate_x+coordinate_y."* |
| `browser_type` | `index` (int), `text` (string) — 两者 required；`text=""` 仅清空 |
| `browser_get_state` | `include_screenshot` (bool, default false)；**`annotations=ToolAnnotations(read_only_hint=True)`** |
| `browser_extract_content` | `query` (string, required), `extract_links` (bool, default false) |
| `browser_get_html` | `selector` (string, optional) — readOnlyHint ✅ |
| `browser_screenshot` | `full_page` (bool, default false) — readOnlyHint ✅ |
| `browser_scroll` | `direction` (enum `up|down`, default `down`) |
| `browser_go_back` | `{}` |
| `browser_list_tabs` | `{}` — readOnlyHint ✅ |
| `browser_switch_tab` | `tab_id` (string, **"4 Character Tab ID"**) |
| `browser_close_tab` | `tab_id` (string) |
| `retry_with_browser_use_agent` | 「last resort」回退到完整 agent |

**有状态/持久会话设计（重点）** ✅✅

源码 `server.py` 里的 session 管理是一套**显式的多会话 + 生命周期**模型：

- `_list_sessions()`、`_close_session(session_id)`、`_close_all_sessions()`
- `_cleanup_expired_sessions()` + `_start_cleanup_task()`（后台 `cleanup_loop`）
- 入口签名：`async def main(session_timeout_minutes: int = 10)` —— **10 分钟 TTL**
- `_init_browser_session(allowed_domains: list[str] | None = None, **kwargs)` —— **会话初始化时接受 `allowed_domains` 白名单**

**这点非常重要**：`allowed_domains` 是**在 session 创建时注入**的，而不是全局配置。这意味着「每个 agent 会话可以有各自的域名边界」。**BUA 应该抄这个：把信任边界做成 per-session 属性，而不是全局开关。**

**它没解决什么**

- `browser_click` 的 `coordinate_x/coordinate_y` 无任何防护——纯坐标点击对「点错按钮」零保护。
- MCP server 是 stdio，**没有本地端口暴露问题**（这是 stdio 相对 HTTP/WS 的结构性优势，见 §5）。
- 工具集**没有审批/二次确认**概念，`readOnlyHint` 只标了 4 个只读工具，**破坏性工具没有 `destructiveHint` 反向标注**。

---

### 1.4 Chrome MCP Server（`hangwin/mcp-chrome`）——扩展路线的 MCP 代表

- **URL**：<https://github.com/hangwin/mcp-chrome>
- **技术路线** ✅：**MV3 Chrome 扩展 + `mcp-chrome-bridge`（npm 全局包，同时是 Native Messaging host）+ Streamable HTTP**。
  - 扩展从 GitHub Releases 下载 zip，`chrome://extensions/` Load unpacked。
  - `npm install -g mcp-chrome-bridge`，postinstall 自动注册 native host manifest；失败可用 `mcp-chrome-bridge register`。
  - **HTTP 入口：`http://127.0.0.1:12306/mcp`**，MCP 客户端用 `"type": "streamableHttp"`。
  - stdio 备选：`node <global>/mcp-chrome-bridge/dist/mcp/mcp-server-stdio.js`。
- **许可**：MIT ✅
- **Stars**：~12,482 ✅
- **API 风格**：MCP tools，`chrome_*` / `get_*` / `search_*`。✅

**工具清单（一手 README）** ✅

- 浏览器管理（6+1）：`get_windows_and_tabs`, `chrome_navigate`, `chrome_switch_tab`, `chrome_close_tabs`, `chrome_go_back_or_forward`, `chrome_inject_script`, `chrome_send_command_to_inject_script`
- 截图（1）：`chrome_screenshot`
- 网络（4）：`chrome_network_capture_start/stop`（webRequest API）、`chrome_network_debugger_start/stop`（**Debugger API，带 response body**）、`chrome_network_request`
- 内容分析（4）：`search_tabs_content`（**内置向量库语义搜索**）、`chrome_get_web_content`、`chrome_get_interactive_elements`、`chrome_console`
- 交互（3）：`chrome_click_element`（**CSS selector**）、`chrome_fill_or_select`、`chrome_keyboard`
- 数据管理（5）：`chrome_history`, `chrome_bookmark_search/add/delete`

**它没解决什么** ⚠️ **这是它最大的问题**

- README 的 Roadmap 里 **`- [ ] Authentication` 是未完成项**。也就是说 **`127.0.0.1:12306/mcp` 这个端口当前没有鉴权**——任何能访问 127.0.0.1 的本机进程都能接管用户浏览器。且它自己也强调卖点是 *"directly uses your daily Chrome browser… login states"*。
- 官方对比表自称比 Playwright 方案快、免重登、免装依赖 —— 这些是**真实优势**，但也正是**真实登录态带来的风险放大**。

---

### 1.5 Puppeteer MCP（参考服务器）

- **URL**：npm `@modelcontextprotocol/server-puppeteer`，归档仓库 `modelcontextprotocol/servers` 的 `src/puppeteer` ⚠️（本次未直读源码，仅见 npm 镜像页与社区整理）
- **工具名（社区文档整理，🟡 间接确认）**：`puppeteer_navigate`, `puppeteer_screenshot`, `puppeteer_click`, `puppeteer_hover`, `puppeteer_fill`, `puppeteer_select`, `puppeteer_evaluate`
- **许可**：MIT ⚠️
- **意义**：这是 MCP 生态最早的浏览器 server 形态，**已被官方归档**，说明「一个进程自起浏览器 + 一组简单工具」的路子已经商品化，**差异化不在工具集，而在「接哪个浏览器」和「安全模型」**。

---

## 2. 方向二：浏览器扩展路线的 agent

### 2.1 ⭐ open-browser-use（`iFurySt/open-browser-use`）——与本项目最同构的对手

- **URL**：<https://github.com/iFurySt/open-browser-use> ｜ 博客 <https://www.ifuryst.com/en/blog/2026/open-browser-use/>
- **许可**：MIT ✅
- **Stars**：**~365** ✅ —— ⚠️ **重要判断：这是一个早期项目，不是成熟竞品。** 它的人群定位（agent runtime 中立 + Codex Browser Use 开源替代）与本项目高度重合，架构参考价值极大，但**尚未形成生态壁垒**。这是 BUA 的时间窗口。
- **自我定位**（README 原文）：*"`open-browser-use` is a browser automation layer that stays neutral across agent runtimes. It is also an open-source alternative to the Chrome Browser Use capability recently shipped in Codex.app."* —— **「agent runtime 中立」+「Codex Browser Use 的开源替代」。这几乎就是我们的项目定义。**

**技术路线（一手 `docs/ARCHITECTURE.md`）** ✅✅

```
upper-layer runtime / SDK / CLI
  -> /tmp/open-browser-use/<uuid>.sock          (Unix domain socket)
  -> open-browser-use Go native host            (native messaging stdio 中继)
  -> Chrome Native Messaging stdio
  -> Open Browser Use MV3 service worker
  -> chrome.tabs / chrome.debugger / chrome.history / chrome.tabGroups
  -> user's real Chrome profile
```

- **Native messaging host name**（固定）：`com.ifuryst.open_browser_use.extension`
  - 文档明确一条**非常实用的坑**：*"Chrome native messaging host name 只能使用小写字母、数字、underscore 和 dot；hyphen 版本 … 会被 `chrome.runtime.connectNative` 直接拒绝。"* ✅ **BUA 命名 native host 时必须遵守。**
- **帧格式**：native-endian 4-byte 长度前缀 + JSON。
- **多实例发现**：默认 socket `/tmp/open-browser-use/<uuid>.sock`，并写 `/tmp/open-browser-use/active.json`（**权限 0600** ✅）供 CLI/SDK 自动发现；registry 失效时按 mtime 扫描 `*.sock` 并修复 registry。
- **Windows 注册**：写入 `%LOCALAPPDATA%\OpenBrowserUse\NativeMessagingHosts\com.ifuryst.open_browser_use.extension.json`，并注册 `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>` 默认值。
- **扩展 ID**：Chrome Web Store 版 `bgjoihaepiejlfjinojjfgokghnodnhd`。beta 手动安装走「写入稳定 public key → 用该 id 注册 native host allowed origin」。
- **host mode 检测**：Chrome 启动 native host 时把 `chrome-extension://...` origin 作为第一个 argv 传入；Windows Chrome 可能只暴露 `--parent-window=<handle>`，CLI 两者都识别为 host mode。

**扩展侧方法（MV3 core handlers）** ✅

`getInfo`, `createTab`, `getTabs`, `getUserTabs`, `getUserHistory`, `claimUserTab`, `finalizeTabs`, `nameSession`, `attach`, `detach`, `executeCdp`, `moveMouse`, `webmcp_list_tools`, `webmcp_invoke_tool`, `waitForFileChooser`, `setFileChooserFiles`, `waitForDownload`, `downloadPath`, `readClipboardText`, `writeClipboardText`, `readClipboard`, `writeClipboard`, `turnEnded`

**事件转发** ✅：`chrome.debugger.onEvent` → `onCDPEvent`；`chrome.downloads` 创建/变更 → `onDownloadChange`；cursor content script 回报落点以支持 `moveMouse` 等待。

**对外 API 面** ✅

- **CLI**：`ping`, `info`, `tabs`, `user-tabs`, `history`, `open-tab`, `navigate`, `claim-tab`, `finalize-tabs`, `name-session`, `cdp`, `move-mouse`, `wait-file-chooser`, `set-file-chooser-files`, `turn-ended`, `profiles`, `call`（unrestricted JSON-RPC）, `run`（line-oriented action plan）
- **MCP tools**（stdio，newline-delimited JSON-RPC）：`user_tabs`, `open_tab`, `navigate`, `page_info`, `cdp`, `run_action_plan`, `finalize_tabs`, `call`
- **SDK**：JS / Python / Go 三个官方 SDK，直接连 socket，暴露 `tab.goto`、`tab.waitForLoadState`/`wait_for_load_state`、`tab.playwright.domSnapshot`/`dom_snapshot`、`locator(...).inner_text(...)`

**⭐ 最有价值的设计：tab ownership + tab group 生命周期** ✅✅

- 新 session 默认任务组名 **`Task - OBU`**，上层 runtime 应通过 `nameSession` 设成 `<short task> - OBU`。
- `deliverable` tabs 统一移到共享 **`✅ Open Browser Use`** tab group；`handoff` tabs 留在当前任务组。
- 每个 Chrome 窗口**至多一个** `✅ Open Browser Use` 分组：`moveToDeliverables` 按 `windowId` 用 `chrome.tabGroups.query` 找已有同名分组，**合并重复分组**（如 session restore 带回来的）后再加入新 tab。
- **Session 状态持久化到 `chrome.storage.local`**：tab group id、tab origins、group title、deliverable group id、逻辑 active tab id —— **目的明确：「so MV3 service worker restarts can recover session tab listing semantics」**。
- `turnEnded` / `finalizeTabs` 清除 active session state，**使下载通知只在 session 活跃期触发**。

> **这是 MV3 service worker 随时被杀这一硬约束下最完整的一套解法，BUA 应当直接借鉴（tab group 作为"会话可视锚点" + storage.local 持久化 state）。**

**WebMCP 集成（一手）** ✅：两层 content script —— **MAIN world** 优先用浏览器原生 `document.modelContext`，没有则安装最小 page-facing shim（覆盖 `registerTool`/`getTools`/`executeTool`/`AbortSignal` 注销/`toolchange`）；**ISOLATED world** 只做 extension messaging 与页面消息转发。`document_start` 动态注册，已打开 tab 用 lazy inject 补偿。`webmcp_list_tools` 生成 opaque `registration_id`，`webmcp_invoke_tool` 必须回传同一 id + tool name；页面 `toolchange`、重新 list 或 navigation 使旧快照失效。

**它没解决什么 —— 这是我们的机会** ✅（官方 `docs/SECURITY.md` 自述）

> *"The SDKs and CLI do not implement a Codex-style site policy, command allowlist, or user approval workflow."*
> *"Upper-layer runtimes are responsible for deciding which sites, methods, downloads, clipboard operations, and destructive actions are allowed."*
> *"Planned hardening includes client tokens, peer validation, safer stale-socket handling, and security-focused failure-path tests."*

**即：安全模型是空白，且本地 transport 是「同用户即可用的 Unix socket」，无 token、无 peer validation。** 这正是 BUA 可以正面拉开差距的地方（见 §5）。

---

### 2.2 ⭐ Codex Chrome 扩展 1.1.4（OpenAI 官方实现，第三方逆向快照）

> ⚠️ **可信度声明**：以下内容来自 `iFurySt/open-browser-use` 仓库中 `docs/references/codex-chrome-extension-1.1.4/` 的**第三方逆向快照**，附带 SHA-256 与文件清单，可信度较高，但**未经 OpenAI 官方确认**。标记为 🟡。既然 BUA 要「API 设计对齐 Codex CUA API」，这份材料是本报告最有价值的部分。

- **来源**：<https://github.com/iFurySt/open-browser-use/tree/main/docs/references/codex-chrome-extension-1.1.4> 与 `docs/references/browser-client-reverse-engineering.md`
- **被分析产物**：`~/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/scripts/browser-client.mjs`，817,168 bytes，SHA-256 `20c5e21b…48972`，导出名 **`setupAtlasRuntime`** 🟡

**Chrome 扩展侧** 🟡

| 项 | 值 |
|---|---|
| Extension ID | `hehggadaopoacecdllhhajmbjkdcmajg` |
| 名称 / 版本 | `Codex` / `1.1.4`，Manifest V3 |
| 快照日期 | 2026-05-08 |
| 权限 | `nativeMessaging`, `debugger`, `tabs`, `tabGroups`, `downloads`, `history`, `scripting`, `storage`, `<all_urls>` |
| Native host 名 | `com.openai.codexextension` |
| `allowed_origins` | `["chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/"]` ✅（sanitized manifest 原文） |

**传输协议** 🟡

- **native pipe 分帧**：`uint32 message_length_in_native_endianness` + `utf8 JSON payload`
- JSON-RPC：`sendRequest(method, params)`，自增数字 ID；支持 backend-originated notification 与 event handler；backend request handler 注册（含本地 `ping` → `pong`）
- **两根管**：Chrome 扩展后端 `codex-browser-use`；应用内浏览器后端 `codex-browser-use-iab`
- **回退路径**：macOS/Linux `/tmp/codex-browser-use.sock`；Windows `\\.\pipe\codex-browser-use`。IAB 对应 `-iab` 后缀。
- **发现机制**：扫描平台相关 `codex-browser-use*` pipe 路径，每次连接尝试与 **3000 ms 超时**race；扩展后端 fallback info 对象为 `{name: "Chrome", version: "0.0.1", type: "extension", fileUploads: false}`
- **每个请求注入 `session_id` + `turn_id`**，来源 `globalThis.nodeRepl.requestMeta["x-codex-turn-metadata"]`；成功命令会设置响应 metadata key `codex/browserUse`

**Browser API 方法（session RPC wrapper 层）** 🟡
`executeCdp`, `attach`, `detach`, `getTabs`, `getUserTabs`, `claimUserTab`, `createTab`, `finalizeTabs`, `nameSession`, `moveMouse`, `getInfo`

**⭐ 命令面（runtime command registry `Object.values(Om)`）** 🟡 —— **这是 Codex CUA 的实际 action 名，BUA 的 API 命名应对齐这一层**

- **Tab / session**：`browser_user_claim_tab`, `browser_user_open_tabs`, `create_tab`, `close_tab`, `list_tabs`, `selected_tab`, `name_session`, `finalize_tabs`
- **CUA（坐标级）**：`cua_click`, `cua_double_click`, `cua_drag`, `cua_get_visible_screenshot`, `cua_keypress`, `cua_move`, `cua_scroll`, `cua_type`；另见 `dom_cua_keypress`
- **导航**：`navigate_tab_url`, `navigate_tab_back`, `navigate_tab_forward`, `navigate_tab_reload`
- **Playwright 层**：`playwright_dom_snapshot`, `playwright_screenshot`, `playwright_file_chooser_set_files`, `playwright_wait_for_file_chooser`, `playwright_wait_for_load_state`, `playwright_wait_for_timeout`, `playwright_wait_for_url`, `playwright_locator_click`, `playwright_locator_dblclick`, `playwright_locator_fill`, `playwright_locator_press`, `playwright_locator_select_option`, `playwright_locator_set_checked`, `playwright_locator_count`, `playwright_locator_get_attribute`, `playwright_locator_inner_text`, `playwright_locator_text_content`, `playwright_locator_is_enabled`, `playwright_locator_is_visible`, `playwright_locator_wait_for`, `playwright_locator_download_media`
- **调试**：`tab_dev_logs`

**⭐ 三层安全闸门（顺序执行，在任何 dispatch 之前）** 🟡 —— **这是本报告对 BUA 安全设计最重要的参考**

1. **Capability 检查**：download 命令要求 `browserInfo.capabilities.downloads` 或 `mediaDownloads` 不为 false；file chooser 命令要求 `capabilities.fileUploads` 不为 false。
2. **站点策略检查**：非本地的 `http`/`https` URL 归一化为 origin / display URL；**cache key = hostname 去掉前导 `www.`**；**cache TTL = 1440 分钟（24h）**；后端 `https://chatgpt.com/backend-api/aura/site_status`；**`feature_status.agent === true` 表示该站点被阻断**。
3. **用户 origin 授权**：`localhost`、`*.localhost`、`127.0.0.1`、`::1` **绕过** origin 提示；其他 `http`/`https` origin 调用 `nodeRepl.createElicitation`，参数 **`connector_id: "browser-use"`, `persist: "always"`**（即"始终允许此 origin"）。**无 URL 或无正 `tab_id` 的命令按"无 origin 命令"处理。**

**显式声明为 no-origin 的命令**（不做 origin 校验）🟡：
`browser_user_open_tabs`, `close_tab`, `create_tab`, `list_tabs`, `name_session`, `playwright_wait_for_timeout`, `selected_tab`

`navigate_tab_url` 按**目标 URL** 校验；其他 tab-scoped 命令在执行前校验**当前 tab URL**。

**⭐ Playwright selector 的独特做法** 🟡：**不依赖外部 Playwright 进程**，而是把 Playwright 的 injected selector script 以字符串内嵌、在页面里 eval：

- 页面全局对象：`window.__codexPlaywrightInjected`
- 解析：`injected.parseSelector(selector)`；查询：`injected.querySelectorAll(parsed, document)`
- **strictness 规则**：0 匹配 → 无元素；1 匹配 → 成功；**多匹配 → 若可能则收敛到唯一可见元素，否则抛 strict mode violation**
- **locator click 在页面 JS 里算中心点，然后通过 CUA/CDP 发鼠标事件 —— 不是直接 `element.click()`**。这是「更像真人」且能触发真实事件链的关键。

**导航实现** 🟡：`Page.enable` / `Page.getNavigationHistory` / `Page.navigate` / `Page.reload` / `Page.navigateToHistoryEntry`；load 完成由 CDP 事件推断 —— start-like: `Page.frameStartedLoading`, `Page.frameNavigated`, `Page.navigatedWithinDocument`；complete-like: `Page.domContentEventFired`, `Page.loadEventFired`；policy block: `Page.navigationBlocked`。`playwright_wait_for_load_state` **只支持 `load` 和 `domcontentloaded`，显式拒绝 `networkidle`** ✅（这条很值得抄：`networkidle` 在真实浏览器里不可靠）。

**它没解决什么**

- **站点策略依赖 OpenAI 的远程服务**（`chatgpt.com/backend-api/aura/site_status`）—— 开源项目无法复用，**BUA 需要一个本地/可替换的等价机制**。
- 远程站点策略 + 24h 缓存意味着**策略变更最长延迟一天生效**。
- 逆向材料；正式 schema 无官方公开文档。

---

### 2.3 Browser MCP（`browsermcp/mcp` + Browser MCP 扩展）

- **URL**：<https://github.com/browsermcp/mcp> ｜ 官网 <https://browsermcp.io> ｜ 文档 <https://docs.browsermcp.io>
- **许可**：Apache-2.0 ✅
- **Stars**：~7,176 ✅
- **技术路线** ✅：**MCP server（stdio）+ 本地 WebSocket server，端口 9009；Chrome 扩展作为 WS 客户端接入。**
  - README 自述：*"Browser MCP was adapted from the Playwright MCP server in order to automate the user's browser rather than creating new browser instances. This allows using the user's existing browser profile to use logged-in sessions and avoid bot detection mechanisms."*
  - 端口 9009 由 issue 标题确认：*"…When Port 9009 is Free"*（<https://github.com/BrowserMCP/mcp/issues/14>）🟡
- **API 风格**：MCP tools `browser_*`。✅（一手 `src/tools/*.ts`）

**工具与参数** ✅

| 工具 | 参数 |
|---|---|
| `browser_navigate` | `url` |
| `browser_go_back` / `browser_go_forward` | — |
| `browser_wait` | `time`（秒） |
| `browser_press_key` | `key` |
| `browser_snapshot` | a11y/ARIA 快照（`src/utils/aria-snapshot.ts`） |
| `browser_click` | ref + `text` |
| `browser_drag` | ref + `text` |
| `browser_hover` | ref + `text` |
| `browser_type` | ref + `text` |
| `browser_select_option` | ref + `text` |

（后 5 个来自 `src/tools/snapshot.ts` 的正则提取；参数名以 `text` 为通用载体 🟡）

**内部消息命名** ✅：MCP tool → socket message 是**同名的**（`browser_navigate` → `context.sendSocketMessage("browser_navigate", {url})`），另有 `browser_go_back` / `browser_go_forward` / `browser_wait` / `browser_press_key`。**这是一个非常干净的「工具名 = 线协议方法名」映射，BUA 可以照抄。**

**⚠️ 安全性（一手源码，重点负面案例）** ✅

`src/ws.ts` 全文只有：

```ts
export async function createWebSocketServer(port: number = mcpConfig.defaultWsPort): Promise<WebSocketServer> {
  killProcessOnPort(port);            // 暴力杀掉占用端口的进程！
  while (await isPortInUse(port)) { await wait(100); }
  return new WebSocketServer({ port });   // 无 host、无 Origin 校验、无 token
}
```

`src/server.ts`：

```ts
wss.on("connection", (websocket) => {
  if (context.hasWs()) { context.ws.close(); }   // 新连接直接踢掉旧连接
  context.ws = websocket;
});
```

**结论（BUA 必须避免）**：
1. **`new WebSocketServer({ port })` 默认绑定所有接口**（Node `ws` 未指定 `host` 时监听 `::`/`0.0.0.0`）→ ⚠️ 局域网可达（需实测确认，标注为推测）。
2. **无握手 token、无 Origin 校验**。
3. **`killProcessOnPort` 会强杀用户机器上占用 9009 的任意进程**——这是设计缺陷，BUA 绝不能这么做（应改为「端口占用时报错并让用户选择端口」）。
4. **新连接踢旧连接**：任何本机进程只要连上 9009 就能**劫持/挤掉**当前 agent 会话。

> 这是本报告中最强的「反面教材」，也是 BUA 最容易做出差异化的点。

---

### 2.4 Nanobrowser（`nanobrowser/nanobrowser`）

- **URL**：<https://github.com/nanobrowser/nanobrowser> ｜ Chrome Web Store「Nanobrowser: AI Web Agent」
- **Stars**：~14,069 ✅
- **许可**：Apache-2.0 ✅
- **技术路线** ⚠️/🟡：**纯 MV3 扩展，无本地桥、无外部 API**。多 agent 架构（Planner / Navigator / Validator），用户自带 LLM API key，本地执行。使用 `chrome.tabs` / `chrome.scripting`，LLM 调用直连厂商 API。
- **API 风格**：**不是对外 API**——它是「扩展自身即 agent」，工具面在扩展内部。
- **参考价值**：它是「扩展内自带 agent」路线的标杆；对 BUA 而言**是竞品而非可复用组件**，因为 BUA 的设计前提是「任意外部 agent 接入」。

**它没解决什么**：
- 没有对外协议 → 无法被任意 agent 复用；每个 agent 想用就得分叉这个扩展。
- 无本地桥 → 无法做进程级隔离/审计/审批层。
- 已有 Firefox 分叉（`moodynooby/nanobrowser-firefox` ⚠️），说明跨浏览器是社区痛点。

---

### 2.5 Stagehand（`browserbase/stagehand`）

- **URL**：<https://github.com/browserbase/stagehand> ｜ 文档 <https://docs.stagehand.dev>
- **Stars**：~25,630 ✅
- **许可**：MIT ✅（`Copyright (c) 2024 Browserbase Inc.`）
- **技术路线**：Node/Python SDK；可驱动本地 Playwright/CDP，也可接 Browserbase 云。有 v3/v4 两代文档，v4 有 `integrations/agent-frameworks/deep-agents`、`integrations/cli-agents/pi` 等集成。
- **API 风格**：**高层语义 API，与 CUA 的坐标/动作模型不同**：
  - `act()` —— 自然语言动作
  - `extract()` —— 结构化抽取
  - `observe()` —— 观察可用元素
  - `agent()` —— 自主 agent 循环
- **参考价值**：`observe()` 这个「先观察再行动」的分层**值得借鉴**——BUA 应当在 `page_info` 类只读工具里返回可供 LLM 决策的元素清单（Codex 用 `playwright_dom_snapshot`，chrome-devtools-mcp 用 `take_snapshot`，open-browser-use 用 `page_info`）。

---

### 2.6 Claude in Chrome / ChatGPT Atlas（专有，架构分析）

- **Claude in Chrome**：有官方权限指南 <https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide> 🟡。要点：**按站点授权（site-level permission）**，用户可在扩展内查看/撤销每个站点的权限，**敏感操作需用户确认**；默认不访问银行等敏感类站点。
- **ChatGPT Atlas / OpenAI Operator**：专有，无公开架构文档 ⚠️。Atlas 为独立浏览器（自有渲染进程），不驱动用户的 Chrome。
- **参考价值**：**「按 origin 授权 + 可撤销 + 持久化」是业界共识**（与 Codex 的 `createElicitation(persist: "always")` 一致 ✅）。**BUA 应把 origin 授权做成扩展内的可视 UI**，而不是配置文件。

---

### 2.7 Playwright MCP 的扩展模式

- 文档仅一行（`README.md`）：`--extension` —— *"Connect to a running browser instance (Edge/Chrome only). Requires the 'Playwright Extension' to be installed."* ✅
- 配套参数：`--profile-dir-name <name>` —— *"name of the profile directory in the user data dir to connect to with --extension, for example 'Profile 1'. Defaults to the last used profile that has the extension installed."* ✅
- ⚠️ **握手协议、鉴权、端口均无公开文档**——需要逆向。这本身说明**「扩展 + 本地桥」的协议层仍是各家私有，没有事实标准** → **BUA 有机会定义标准。**

---

## 3. 方向三：标准与协议

### 3.1 WebMCP（W3C，网站主动向 agent 暴露工具）

- **一手来源**：<https://github.com/webmachinelearning/webmcp>（`README.md`，37,575 bytes）✅ ｜ 规范：<https://webmachinelearning.github.io/webmcp/>
- **状态** ✅：W3C **Web Machine Learning** WG 的 explainer / 规范草案。Chrome 侧尚未默认开启 —— chrome-devtools-mcp 明确要求 **`--categoryExperimentalWebmcp` 需 Chrome 150+ 且带 `--enable-features=WebMCP`** ✅。

**API 面（一手 README）** ✅

```js
const controller = new AbortController();

await document.modelContext.registerTool({
  name: "add-todo",
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "The text content of the todo item" } },
    required: ["text"]
  },
  async execute({ text }) {
    await addTodoItemToCollection(text);
    return { content: [{ type: "text", text: `Added todo item: "${text}" successfully.` }] };
  }
}, { signal: controller.signal });

// 注销：controller.abort();
```

| 成员 | 语义（原文要点） |
|---|---|
| `document.modelContext.registerTool(tool, options?)` | `tool` = `{name, description, inputSchema, execute}`；`options` = `{signal?, exposedTo?}`。**通过 abort `signal` 注销** |
| `exposedTo` | 跨 origin iframe 暴露，仅接受 **secure origins** |
| `document.modelContext.getTools({fromOrigins?})` | 返回 `RegisteredTool[]`，每项含 **`name`, `description`, `inputSchema`, `origin`, owner `window`**；默认只返回同源工具 |
| `document.modelContext.executeTool(tool, args)` | 浏览器中介执行，校验 `exposedTo` 与 `fromOrigins` 一致，**在工具所有者的执行上下文里运行** |
| `toolchange` 事件 | 工具增/删/改时触发，参数接收方应刷新工具列表 |
| `AbortSignal` | `executeTool(tool, args, {signal})` 可中途取消（对应 agent UI 的 "stop" 按钮） |
| Permissions Policy | 默认只在 top-level `Window` + 同源 iframe 启用；跨源 iframe 需 `allow="tools"`；禁用时 `registerTool()` 返回 **`NotAllowedError` DOMException**；HTTP 侧用 `Permissions-Policy: tools=()` |
| Built-in browser agents | 文档提到工具默认也暴露给 **built-in browser agents** |

**演化方向** ✅：`outputSchema` 仍在讨论（Issue #9）；**声明式 API（从 `<form>` 合成工具）不在当前规范内**，另有 `declarative-api-explainer.md`。

**对 BUA 的意义**

- **WebMCP 与「浏览器操作 agent」是互补而非竞争**：WebMCP 是**站点主动给工具**（结构化、语义明确），BUA 是**站点没给工具时兜底**（DOM/CUA）。
- **建议 BUA 的 `page_info` / 工具发现返回里同时列出**：① WebMCP 注册的工具（`document.modelContext.getTools()`）；② 可交互元素清单。open-browser-use 已经这么做了（`webmcp_list_tools` / `webmcp_invoke_tool`）✅，chrome-devtools-mcp 也有（`list_webmcp_tools` / `execute_webmcp_tool`）✅ —— **这是已经形成的共识，BUA 必须支持**。
- **`registration_id` 快照失效语义值得抄**：open-browser-use 的 `webmcp_list_tools` 生成 opaque `registration_id`，`webmcp_invoke_tool` 必须回传同一 id → **防止 agent 拿着过期的工具快照调用**（TOCTOU 防护）。✅

---

### 3.2 `chrome.debugger` API 的能力边界

- **官方博客（一手，curl 取得）**：<https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions> ✅
- **核心 API**：`chrome.debugger.attach({tabId}, "1.3")` —— 第二个参数是 **CDP 协议版本字符串 `"1.3"`**；manifest 需 `"permissions": ["debugger"]`。✅
- **Chrome 155 的企业策略变更**（Published 2026-09-08，Updated 2026-09-16；Beta 2026-09-16，**Stable 滚动 2026-10-06**）✅ —— **本报告调研时刚刚落地，对 BUA 影响直接**：

| 条件（仅托管浏览器） | 结果 |
|---|---|
| `ExtensionSettings` 里该扩展配了非空 `runtime_blocked_hosts` | `chrome.debugger.attach()` **在所有 target 上被拒绝**，错误 `"Host access is restricted by policy."` —— **即使某些 origin 在 `runtime_allowed_hosts` 里也一样** |
| `DisableScreenshots` 或 DLP 规则禁用截图 | `attach()` 失败，错误 `"Screenshot capture is restricted by policy."` |
| 非托管浏览器 / 无上述策略 | **行为不变** |

**官方给出的理由（极其重要的一句）** ✅：
> *"The chrome.debugger API grants direct Chrome DevTools Protocol (CDP) access for powerful capabilities, including arbitrary script evaluation and network interception. **Because CDP operates beneath the web platform's origin model, origin-based filtering cannot securely restrict it** so Chrome 155 resolves this with an all-or-nothing model, validating enterprise policies upfront on `chrome.debugger.attach()` call."*

**官方建议的替代 API** ✅：`chrome.scripting`（执行脚本/插样式）、`chrome.declarativeNetRequest`（声明式拦截网络）、`chrome.cookies`（配合标准 host permissions）。

**对 BUA 的直接影响**：

1. **`chrome.debugger` 一旦 attach，就绕过了 origin 模型** —— 所以「域名白名单」**必须在我们的桥/扩展逻辑层实现，不能靠浏览器**。这与 §1.2 中 chrome-devtools-mcp 的 URL pattern 说明互相印证。
2. **在企业托管环境，扩展可能完全无法 attach** → **BUA 必须有降级路径**：`chrome.scripting` + `chrome.tabs` 的「无 CDP 模式」（功能受限但不全废）。**这是 open-browser-use 和 mcp-chrome 都没做的**（open-browser-use 的扩展核心方法重度依赖 `attach`/`executeCdp`）。
3. **必须优雅处理 attach 失败**，官方给了 MV3 的 try/catch 示例。

**其他已知边界** ⚠️（本报告未能逐一实测，标注为推测/待验证）：

- `chrome.debugger` 是 **per-tab** attach；浏览器级 target（如其他扩展页、`chrome://` 页面）不可 attach。
- **DevTools 已在该 tab 打开时的行为**：⚠️ 未获取到一手的当前文档。历史上 Chrome 会 detach 或弹出提示。**BUA 必须实测并文档化**。
- 权限警告文案（Chromium 源码 `generated_resources.grd` 中的 `IDS_EXTENSION_PROMPT_WARNING_DEBUGGER`）：🟡 来源 <https://chromium.googlesource.com/chromium/src/+/90ac58cb2c56df119ca3d5631cbbc3feabb8a82b/chrome/app/generated_resources.grd> —— 这是**安装时对用户展示的高危警告**，是本路线最大的分发阻力。

---

### 3.3 MCP（Model Context Protocol）

- **一手来源**：<https://github.com/modelcontextprotocol/modelcontextprotocol>（`docs/specification/draft/...`）✅

**传输与安全（Streamable HTTP，一手 spec 原文）** ✅

> 1. Servers **MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks.
>    - If the `Origin` header is present and invalid, servers **MUST** respond …
> 2. When running locally, servers **SHOULD** bind only to localhost (127.0.0.1) rather than all network interfaces (0.0.0.0).
> …
> Without these protections, attackers could use DNS rebinding to interact with …

**这是本报告对 BUA 本地桥设计最直接的可引用规范依据。** 注意 MCP 只说「校验 Origin，不合法就拒绝」——**但原生进程可以在 WS 握手里随便伪造 `Origin`**，所以 Origin 校验只能防浏览器发起的攻击（DNS rebinding），**防不住本机恶意进程**（见 §5）。

**Tool Annotations（一手 `schema.json`）** ✅

| 字段 | 默认 | 原文要点 |
|---|---|---|
| `readOnlyHint` | `false` | — |
| `destructiveHint` | **`true`** | *"If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates. (This property is meaningful only when `readOnlyHint == false`)"* |
| `idempotentHint` | **`false`** | *"If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment. (This property is meaningful only when `readOnlyHint == false`)"* |
| `openWorldHint` | — | 描述与外部世界交互 |

**⚠️ 规范明确的安全警告** ✅（`docs/.../server/tools.mdx`）：
> *"For trust & safety and security, clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers."*

→ **含义：`destructiveHint` 不能作为唯一防线。BUA 的审批判断必须基于自己扩展侧的动作分类，而不是信任 agent 传来的 hint。**

**Tool 命名规范** ✅：1–128 字符；大小写敏感；仅允许 `A-Za-z0-9_-` 与 `.`；不得含空格/逗号；同一 server 内唯一；多 server 聚合时客户端 **SHOULD** 做前缀消歧。**→ BUA 工具名应据此设计（Codex 用 `cua_*`/`playwright_*` 前缀，天然符合）。**

**Elicitation（审批通道，一手 `client/elicitation.mdx`）** ✅

| 项 | 内容 |
|---|---|
| 方法 | `elicitation/create` |
| `mode` | `"form"`（默认，可省） \| `"url"`（**2025-11-25 版新增**） |
| form 参数 | `message`, `requestedSchema`（**JSON Schema，且限定为扁平的 primitive-only 对象**，以简化客户端 UI） |
| url 参数 | `message`, `url`, 可选 `requestState`；**用于认证流、支付等敏感/安全操作** |
| 响应 | `action: "accept"` \| `"decline"` \| `"cancel"` |
| 客户端能力 | 必须在 `_meta.io.modelcontextprotocol/clientCapabilities` 声明 `elicitation`（`{}` 等价于 `{"form": {}}`）；**至少支持一种 mode** |
| 硬约束 | 服务端 **MUST NOT** 用 form mode 索取密码/API key 等敏感信息；**MUST** 用 url mode；不得在 URL 里带敏感信息或预认证 URL |
| 客户端硬约束 | **MUST NOT** 自动预取 URL；**MUST NOT** 未获显式同意就打开；**MUST** 展示完整 URL；**MUST** 以客户端与 LLM 都无法窥探内容的方式打开 |
| 安全 | 服务端 **MUST** 把 elicitation 绑定到 client + user 身份；客户端 **SHOULD** 提供用户审批控件与随时拒绝 |

**→ BUA 的审批通道有一个天然选择：如果 agent 是 MCP 客户端，用 `elicitation/create` 回问；但更可靠的是在**扩展 UI 层**做审批（不依赖 agent runtime 配合），因为规范允许客户端拒绝/不支持。**注意 Codex 走的就是 `nodeRepl.createElicitation`（集成在 runtime 里），而不是裸 MCP。**

---

### 3.4 OpenAI CUA / Computer Use API（BUA 要对齐的目标）

- **一手来源**：`openai/openai-python` 类型定义 ✅
  - `src/openai/types/responses/computer_tool.py`
  - `src/openai/types/responses/response_computer_tool_call.py`
  - 文档 <https://platform.openai.com/docs/guides/tools-computer-use>

**工具声明** ✅

```python
class ComputerTool(BaseModel):
    type: Literal["computer"]     # 永远是 "computer"
```

**`ResponseComputerToolCall`（一手类型定义逐字）** ✅

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `str` | computer call 的唯一 ID |
| `call_id` | `str` | **回复 tool call output 时使用的标识** |
| `pending_safety_checks` | `List[PendingSafetyCheck]` | 待处理安全检查 |
| `status` | `Literal["in_progress","completed","incomplete"]` | |
| `type` | `Literal["computer_call"]` | |
| `action` | `Optional[Action]` | 单个动作 |
| `actions` | `Optional[ComputerActionList]` | **"Flattened batched actions for `computer_use`"** —— 批量动作，每项含 `type` discriminator 与各自字段 |

**`PendingSafetyCheck`** ✅：`{id: str, code: Optional[str], message: Optional[str]}`
- `code` = "The type of the pending safety check"
- 🟡 社区文档常引用的 `code` 取值包括 `malicious_instruction` / `irrelevant_domain` / `sensitive_domain` —— ⚠️ **本次未在官方 SDK 类型或文档中直接读到枚举值，标注为未确认。**

**⭐ Action 全集（discriminator = `type`）** ✅ —— **BUA 的 CUA API 应与此对齐**

| `type` | 字段 |
|---|---|
| `click` | `x: int`, `y: int`, `button: Literal["left","right","wheel","back","forward"]`, `keys?: List[str]` |
| `double_click` | `x: int`, `y: int`, `keys?: List[str]` |
| `drag` | `path: List[{x:int, y:int}]`, `keys?: List[str]` |
| `keypress` | `keys: List[str]` |
| `move` | `x: int`, `y: int`, `keys?: List[str]` |
| `screenshot` | （无字段） |
| `scroll` | `x: int`, `y: int`, `scroll_x: int`, `scroll_y: int`, `keys?: List[str]` |
| `type` | `text: str` |
| `wait` | （无字段） |

**关键观察** ✅：
- **所有动作都是坐标级（`x`/`y`），没有 selector/ref 概念。** 这与 Codex 的**双层设计**（`cua_click` 坐标层 + `playwright_locator_click` 语义层）不同 —— **OpenAI 公开的 CUA API 只暴露坐标层**，语义层是 Codex 客户端内部的事。
- `keys: List[str]` 在 click/double_click/drag/move/scroll 上都存在 → **支持"按住修饰键再做鼠标动作"**（如 Shift+点击）。
- `actions`（批量）是新字段，**batch 是一等公民**；chrome-devtools-mcp 的 `fill_form` + `includeSnapshot` 是同一思路（减少往返/turn 数）。
- **`safety_checks` 是 API 一级字段**，不是外挂——说明 OpenAI 把「审批」做进了协议层。🟡 `acknowledged_safety_checks` 用于在回传 `computer_call_output` 时确认已知悉（⚠️ 本次未从官方类型读到该字段名，标注未确认）。

**Anthropic Computer Use（对比）** 🟡：工具类型名 `computer_20250124`（版本化日期后缀，见 `llms`/`anthropic` 生态的类型定义），actions 与 OpenAI 类似（`screenshot`/`left_click`/`type`/`key`/`scroll` 等）⚠️ 本次未直读官方 schema，仅见第三方 crate 文档 <https://docs.rs/llm-kit-anthropic/latest/llm_kit_anthropic/provider_tool/computer_20250124/fn.computer_20250124.html>。**关键差异：Anthropic 把版本号写进类型名（`computer_20250124`），OpenAI 用固定 `"computer"`。BUA 若要对齐两家，用「基础类型 + `version` 字段」更稳。**

---

### 3.5 AGENTS.md 等互操作约定

- 🟡 **AGENTS.md** 已成为跨厂商的 agent 指令约定（有报道称 Anthropic 采纳 OpenAI 的 AGENTS.md 协议，见 <https://eu.36kr.com/zh/p/3989811919076098>）。open-browser-use 仓库**根目录同时有 `AGENTS.md` 和 `CLAUDE.md`** ✅，且提供 `skills/open-browser-use/` 作为 agent skill（`npx skills add iFurySt/open-browser-use`）。
- **对 BUA 的建议**：交付物应包含 ① `AGENTS.md`（约定 agent 如何调用 BUA）② 一个 skill 包（`npx skills add` 可安装）③ MCP server。**open-browser-use 已经把「CLI + SDK + MCP + Skill」四件套做成了分发矩阵，BUA 应对齐。**
- ⚠️ `llms.txt`、agent identity/consent 提案本次未深入，属**未覆盖项**。

---

## 4. 方向四：真实浏览器 vs 独立浏览器（本项目最核心的约束）

### 4.1 Chrome 的两道禁令（必须先搞清楚，这是整个赛道的分水岭）

**禁令 A：Chrome 136+ 忽略默认 profile 上的调试开关** ✅

官方博客原文（<https://developer.chrome.com/blog/remote-debugging-port>，Published 2025-03-17，作者 Will Harris）：
> *"…from Chrome 136 we're making changes to the behavior of `--remote-debugging-port` and `--remote-debugging-pipe`. **These switches will no longer be respected if attempting to debug the default Chrome data directory.** These switches must now be accompanied by the `--user-data-dir` switch to point to a non-standard directory. A non-standard data directory uses a different encryption key meaning Chrome's data is now protected from attackers."*

动机（原文）：App-Bound Encryption 上线后，攻击者**转向用 Chrome Remote Debugging 偷 cookie**；这个手法自 2018 年就被讨论，近期因博客与现成工具而流行。
官方建议：*"For browser automation scenarios, we recommend using **Chrome for Testing** which will continue to respect the existing behavior."*

**行为特征（🟡 来自 hermes-agent 文档，与官方博客一致）**：**静默忽略，什么都没有监听，没有对话框**；即使冷启动、没有其他 Chrome 在跑也一样；`curl http://127.0.0.1:9222/json/version` 直接 connection refused。

**禁令 B：Chrome 144+ 的「每次连接都要批准」流程** ✅/🟡

- chrome-devtools-mcp 一手文档 ✅：*"**Automatic connection (available in Chrome 144)** … 1. Navigate to `chrome://inspect/#remote-debugging` to enable remote debugging. 2. Follow the dialog UI to allow or disallow incoming debugging connections."* 服务端用 `--autoConnect`。
- hermes-agent 补充 🟡：这是 **per incoming connection** 的许可对话框，不是 per launch；**Allow 之前端口上什么都不监听**；toggle 一旦打开，每次新连接都会弹。
- hermes 的 commit message 把两者关系说得很清楚 ✅：*"Chrome 136+ simply stops respecting --remote-debugging-port/--remote-debugging-pipe against the default data dir — no dialog, nothing listens. The 'Allow remote debugging?' prompt … is the separate Chrome 144+ opt-in approval flow (chrome://inspect/#remote-debugging), which asks per incoming connection, not per launch."*

**第三个坑（与上面无关，但同样致命）** 🟡：
- **已有 Chrome 实例在跑时，再启动一次只会向已有进程开个新窗口**，而该进程**没有** `--remote-debugging-port` → 端口永远不开。（hermes 文档原文）
- **同一个 user-data-dir 不能被两个浏览器实例同时使用**（Playwright MCP / chrome-devtools-mcp 文档均提到 profile 独占）。

---

### 4.2 ⭐ 全部已知绕过方案矩阵

> 「绕过」的目标：**在用户真实 profile（含登录态）上获得可编程控制能力。**

| # | 方案 | 具体做法 | 优点 | 缺点 / 风险 | 证据 |
|---|---|---|---|---|---|
| **A** | **专用 `--user-data-dir`** | `chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile-stable` | 最简单；两道禁令都不触发；跨平台一致 | **全新 profile，没有任何登录态** —— 根本不解决问题 | ✅ [chrome blog](https://developer.chrome.com/blog/remote-debugging-port)、[chrome-devtools-mcp advanced-usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) |
| **B** | **`RemoteDebuggingAllowed` 企业策略** | 按 OS 写策略（macOS `defaults write <bundle-id> RemoteDebuggingAllowed -bool true`；Windows 注册表；Linux JSON policy），然后 `chrome --remote-debugging-port=9222 --remote-allow-origins=*` 启在**真实 profile** 上，客户端用 `--cdp` 连 | **真登录态 + 自动化可用**；实测通过（hermes 称 E2E 验证过 LinkedIn feed） | 需要**管理员/注册表写权限**；篡改企业策略的安全/合规问题；托管设备可能被策略覆盖；Chrome 版本可能失效；`--remote-allow-origins=*` 本身是弱化 | 🟡 [hermes commit c0c5a97](https://github.com/NousResearch/hermes-agent/commit/c0c5a97b9e209a697bca193dce9756dade27ddde) |
| **C** | ⭐ **真实 profile 快照**（`use_real_profile`） | 读 `Local State → profile.last_used` 找到活跃 profile，把 cookies / 登录 / 偏好**复制/快照**到 `~/.hermes/browser-profile/<browser>/`，**用真实浏览器二进制**（不是自带 Chromium）在该副本上启动（默认 headless），客户端连它 | **是真登录态**；是**非默认 user-data-dir → 两道禁令都不触发**；不抢真实 profile 的锁；**必须用真实二进制才能解开 OS 加密的 cookie**（macOS Keychain / App-Bound Encryption，mock-keychain 启动会静默丢掉所有 cookie）；关掉开关时删除快照 | **必须完全退出浏览器**（Windows 对 cookie/login 数据库是 deny-all 独占锁；macOS/Linux 的 `Login Data`/`Web Data` 有热写锁）；SQLite online backup 只有 5 秒预算；登录态**只在每次新会话启动时重新同步**，会过期；磁盘翻倍；**不是隔离边界**（hermes 原文：*"this is a consent-gated convenience, not an isolation boundary"*） | 🟡 [hermes browser.md](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/browser.md) |
| **D** | **Chrome 144+ 官方批准流程** | 用户在 `chrome://inspect/#remote-debugging` 打开开关；客户端 `--autoConnect`；用户对每次连接点 Allow | **官方路径**；跑在真实 profile；无需策略 hack；有明确用户同意 | **每次连接都要用户点**；Chrome 144+；需要用户在场；`--autoConnect` 要求用户先启动 Chrome，且多 profile 时会连到 Chrome 认定的 default profile | ✅ [chrome-devtools-mcp advanced-usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md) |
| **E** | ⭐⭐ **MV3 扩展 + `chrome.debugger` + Native Messaging**（**= BUA 路线**） | 扩展用 `chrome.debugger.attach({tabId}, "1.3")` 拿 per-tab CDP；扩展与本地 host 用 `chrome.runtime.connectNative` 通信；host 与上层用本地 socket/pipe | **完全不对外开端口** → 无本地劫持面；天然跑在真实 profile 与真实登录态；**per-tab 粒度**；可在扩展内做 UI 审批与动作分级；不受 Chrome 136 禁令约束（不走命令行开关） | 安装时 `debugger` 高危权限警告（分发摩擦大）；**企业策略可整体拒绝 attach**（Chrome 155，`runtime_blocked_hosts`）；Chrome Web Store 审核；需要注册 native host manifest | ✅ [Codex 扩展逆向](https://github.com/iFurySt/open-browser-use/tree/main/docs/references/codex-chrome-extension-1.1.4)、[open-browser-use ARCHITECTURE](https://github.com/iFurySt/open-browser-use/blob/main/docs/ARCHITECTURE.md)、[Chrome 155 博客](https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions) |
| **F** | **`--remote-allow-origins`** | 直连 CDP WebSocket 时 Chrome 会校验 `Origin`，需显式放行 | 直连 WS 的必要条件 | **弱化安全**；`=*` 等于放行任意来源 | 🟡 hermes commit |
| **G** | **Chrome for Testing** | 用 CfT 二进制 | 官方推荐的自动化路径，保留旧行为 | **不是用户的浏览器**，无登录态 | ✅ chrome blog |
| **H** | ⚠️ **二进制补丁**（patch-browser） | 反汇编 `chrome.dll`/`msedge.dll`，把 `IsRemoteDebuggingAllowed()` 判定里的 `jne` 改成 NOP，**让默认 user-data-dir 也能开 CDP** | **真登录态 + 默认 profile + 无策略依赖**；带 `--dry-run` / `--restore`；作者称"全版本通杀"（未收录版本用 `auto` 现场按闸门指令形状定位） | **修改浏览器二进制** —— 破坏代码签名/完整性校验、每次 Chrome 更新失效、需要管理员权限、**杀软/EDR 高度可疑**、企业环境不可接受。作者自己在免责声明里强调 **"CDP 端口没有任何认证：能访问 `127.0.0.1:<port>` 的本机进程就等于拿到浏览器的完全控制权"**，并警告别用 `--remote-allow-origins=*` | ✅ [PyPI patch-browser 0.2.1](https://pypi.org/project/patch-browser/)（MIT，2026-10-02 发布，实测版本 Chrome 154.0.8037.98 / Edge 154.0.4258.53） |
| **I** | **扩展 `--extension` 模式**（Playwright MCP） | 安装 Playwright Extension，MCP server 通过它接管已运行浏览器 | 官方支持、跑在真 profile | 协议无文档；仍需扩展安装 | ✅ [playwright-mcp README](https://github.com/microsoft/playwright-mcp) |

**⭐ 对 BUA 的结论**

- **方案 E（BUA 自身路线）在「安全性」和「真实登录态」两项上同时最优** —— 它根本不需要在 127.0.0.1 上开 CDP 端口，因此 B、D、F、H 的全部风险与摩擦都不存在。**这应当是 BUA 的核心卖点，要写进 README。**
- **E 的两个真实风险必须正面处理**：① 企业策略拒绝 attach（Chrome 155）→ 需要 `chrome.scripting` 降级模式；② `debugger` 权限警告 → 需要清晰的价值说明 + 可撤销。
- **方案 C（profile 快照）值得作为「补充模式」考虑**：它能做到 E 做不到的事 —— **后台 headless 跑，不占用用户的窗口、不抢 tab**。代价是必须让用户先完全退出浏览器。这与 E 是**互补**关系：E = 前台、实时、真 tab；C = 后台、批处理、快照态。⚠️ 但需注意快照态下用户的登录可能失效，且不是隔离边界。
- **`--remote-debugging-port` 开在真实 profile 上永远是「不安全」的**：chrome-devtools-mcp 官方、MCP 规范、patch-browser 作者三方都独立指出 **CDP 端口无认证，本机任意进程可接管浏览器**。**BUA 不要把「开调试端口」作为默认路径。**

---

### 4.3 专门解决「用户真实浏览器」的项目清单

| 项目 | 如何拿到真实浏览器 | 是否开本地端口 |
|---|---|---|
| **open-browser-use / Codex browser-use** | MV3 扩展 + `chrome.debugger` + Native Messaging | ❌ 不开（Unix socket / named pipe，本机文件系统权限） |
| **Chrome MCP Server (mcp-chrome)** | MV3 扩展 + Native Messaging | ✅ **开 `127.0.0.1:12306`（无鉴权）** |
| **Browser MCP (browsermcp.io)** | MV3 扩展 + WebSocket | ✅ **开 9009（无鉴权、无 Origin 校验、踢连接、杀端口占用进程）** |
| **Playwright MCP `--extension`** | Playwright Extension | ⚠️ 未文档化 |
| **chrome-devtools-mcp** | `--autoConnect`（Chrome 144 批准）或 `--browserUrl` 开调试端口 | ✅ 开 9222（官方自认不安全） |
| **hermes-agent** | ① real-profile 快照 ② `RemoteDebuggingAllowed` 策略 + 9222 ③ 独立 Chromium | ✅ 对 ② 开 9222 |
| **Stagehand** | 本地 CDP endpoint 或云 | ✅ CDP URL 由用户提供 |
| **Nanobrowser** | 纯扩展（`chrome.tabs`/`scripting`），不接外部 agent | ❌ 不开 |
| **patch-browser** | 二进制补丁让默认 profile 开 CDP | ✅ 开 9222 |

**分类洞察**：
- **「扩展 + Native Messaging」= 零本地端口**（open-browser-use、Codex、mcp-chrome 的 host 侧）。这是**最安全的结构**：攻击面被降级为「本机同用户文件系统权限」。
- **「扩展 + 本地 WebSocket」** 目前被 Browser MCP 做成了反面教材（见 §2.3）。**但 BUA 的既定架构就是 WebSocket 桥**，所以 §5 的加固是必须的。
- **「直连 CDP 端口」** 全行业共识是**无认证、不安全**，只适合开发环境。

---

## 5. 方向五：安全模型

### 5.1 威胁 → 现有项目做法 → 缺口

| 威胁 | 现有项目做法 | 缺口（BUA 的机会） |
|---|---|---|
| **1. 本机其他进程劫持本地端口** | ① **Browser MCP**：无任何防护，`new WebSocketServer({port})`、新连接踢旧连接 ✅ ② **mcp-chrome**：无鉴权（Roadmap 里 Authentication 未完成）✅ ③ **open-browser-use**：用 Unix socket + native messaging，**降级为文件系统权限**，但自述 *"Planned hardening includes **client tokens, peer validation**, safer stale-socket handling"* ✅ | **没有一个项目的 WebSocket 桥有握手 token。这是 BUA 最大的差异化机会。** |
| **2. DNS rebinding** | ① **MCP 规范强制**：servers **MUST** validate `Origin`；本地 **SHOULD** 只绑 127.0.0.1 ✅ ② **Playwright MCP** 有 `--allowed-hosts`（Host 头校验，默认绑定 host，`'*'` 关闭检查）✅ ③ mcp-chrome / Browser MCP：无 | Origin 校验只防**浏览器发起**的攻击；Host 校验防 DNS rebinding。**两者的组合是必须的，但业界普遍缺失。** |
| **3. 端口绑定到 0.0.0.0** | Playwright MCP 显式提供 `--host`（默认 `localhost`，可选 `0.0.0.0`）；MCP 规范 **SHOULD** 绑 127.0.0.1 ✅ | Browser MCP 未指定 host（⚠️ 推测监听所有接口）。**BUA 必须硬绑 127.0.0.1，不提供 0.0.0.0 选项。** |
| **4. 域名白名单（防 agent 乱逛）** | ① **chrome-devtools-mcp**：`--blockedUrlPattern` / `--allowedUrlPattern`（URLPattern），**连接时静默 detach 被阻断 target**，并拒绝含 regexp group 的 pattern（因为不覆盖重定向/子资源）✅ ② **Playwright MCP**：`--allowed-origins`/`--blocked-origins`，**官方自认 "does not serve as a security boundary and does not affect redirects"** ✅ ③ **browser-use**：`_init_browser_session(allowed_domains=...)` **每会话注入** ✅ ④ **Codex**：远程 `site_status` 服务，cache key = 去掉 `www.` 的 hostname，TTL 1440 分钟，`feature_status.agent === true` 即阻断 🟡 | **URL 级黑名单被三家独立承认不可靠**（重定向、子资源、以及 `chrome.debugger` 本身绕过 origin 模型）。**BUA 必须做「导航前 + 每次 tab-scoped 动作前」双点校验，并且校验对象是当前 tab 的顶层 URL。** Codex 的做法（`navigate_tab_url` 校验目标 URL、其他命令校验当前 tab URL）是正确的形态。 |
| **5. 用户审批 / 敏感操作确认** | ① **Codex**：`nodeRepl.createElicitation(connector_id:"browser-use", persist:"always")`，**按 origin 提示，可持久化**；`localhost`/`127.0.0.1`/`::1` 自动放行；列出显式免检的 no-origin 命令 🟡 ② **OpenAI CUA API**：`pending_safety_checks[{id, code, message}]` 是**协议一级字段** ✅ ③ **MCP elicitation**：`elicitation/create`，三态 `accept`/`decline`/`cancel`，`requestedSchema` 限扁平，`mode: "url"` 专用于支付/认证 ✅ ④ **Claude in Chrome**：按站点授权 + 可撤销 + 敏感操作确认 🟡 | **几乎没有项目做「支付/提交类」的动作级识别**。open-browser-use 的 `SECURITY.md` 只说 *"Integrations should confirm uploads, downloads, file selection, **form submission, purchases, deletion, and external message sending** before execution"* —— **是建议，不是实现** ✅。**BUA 应把「动作风险分级」做进扩展侧（不依赖 agent 自律）。** |
| **6. Prompt injection（不可信页面内容）** | ① **MCP 规范**：*"clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers"* ✅ ② **Playwright MCP**：`browser_click` 的 `element` 参数用于 *"obtain permission"*，即把人工确认嵌进 schema ✅ ③ Anthropic / OpenAI 的 guidance 🟡 | **没有任何项目把「页面内容 → 动作」的信任降级做成机制**。BUA 的机会：**把「最终动作目标」与「页面文本」解耦**——例如所有破坏性动作必须回显人类可读的目标描述（抄 Playwright MCP 的 `element` 参数）并要求确认。 |
| **7. 企业策略冲突** | **Chrome 155**：`runtime_blocked_hosts` 非空 → `attach()` 全量拒绝；`DisableScreenshots`/DLP → 拒绝 ✅。官方建议迁移到 `chrome.scripting` / `declarativeNetRequest` / `chrome.cookies` | **所有扩展路线的项目都没做 CDP 不可用时的降级模式。** BUA 应做「无 CDP 模式」。 |
| **8. 过期作用域 / TOCTOU** | **open-browser-use 的 WebMCP**：`webmcp_list_tools` 生成 opaque `registration_id`，`webmcp_invoke_tool` 必须回传同一 id；`toolchange`/重新 list/navigation 使旧快照失效 ✅。**chrome-devtools-mcp**：`take_snapshot` 的 `uid` 有时效性，文档说 *"Always use the latest snapshot."* ✅ | 一般性的 TOCTOU（元素/页面在「观察」和「操作」之间变化）普遍靠 prompt 约束，**没有协议级机制**。BUA 可以把 `uid`/`pageVersion` 做成**强校验**（不匹配就拒绝并让 agent 重新快照）。 |
| **9. 凭据泄露到 LLM** | **Playwright MCP**：`--secrets <path>`（dotenv 格式）+ `browser_type` 的 `element` 描述；**chrome-devtools-mcp**：`--redactNetworkHeaders` ✅；**browser-use**：`sensitive_data` 占位符注入 🟡（文档 <https://docs.browser-use.com/open-source/examples/templates/sensitive-data>） | **BUA 应实现 `--secrets` 等价物**：agent 传 `{{secret:github_password}}` 占位符，由扩展侧替换为真实值再输入，**真实值永不进入 LLM 上下文**。 |

### 5.2 ⭐ 给 BUA 的具体威胁模型与机制建议

**信任边界声明**（应写进 README，参考 open-browser-use `SECURITY.md` 的诚实风格 ✅）：
> BUA 把用户的**真实浏览器**暴露给本地调用方。**它不是沙箱。** 能访问本机用户账号的进程 = 能访问浏览器自动化通道。

**分层机制建议**

**L1 · 传输层（防本机劫持 + DNS rebinding）**

1. **只绑 `127.0.0.1`，硬编码，不提供 `0.0.0.0` 选项。**（MCP 规范 SHOULD ✅）
2. **强制 `Origin` 校验**：WS upgrade 时校验 `Origin`。允许值 = `chrome-extension://<我们的扩展ID>`（扩展侧连接）+ 显式的本地客户端来源；**不合法一律 403**。（MCP 规范 MUST ✅）
3. **强制 `Host` 头校验**：只接受 `127.0.0.1:<port>` / `localhost:<port>`，其余 403 —— 这是**防 DNS rebinding 的关键一环**（Playwright MCP 的 `--allowed-hosts` 思路 ✅，但 BUA 应默认开启且不可用 `*` 关闭）。
4. **⭐ 握手 token（业界空白，BUA 的核心差异化）**：
   - 桥启动时生成**高熵随机 token**（≥256 bit），写入**仅当前用户可读**（Unix `0600` / Windows 用户 ACL）的文件，例如 `~/.bua/bridge.json`；或直接打印到启动终端 + 写入扩展可读的安全存储。
   - 客户端必须在 WS 第一条消息（或 `Authorization: Bearer` 头）里提交 token；**校验失败立即断开、记审计日志、可选限速/冷却**。
   - **token 一次性轮换或长生命周期 + 撤销命令**。
   - 参考 open-browser-use 的 `active.json` **0600 权限** 做法 ✅，但**要加 token**（他们只有 registry 没有鉴权）。
5. **不做 `killProcessOnPort`**（Browser MCP 的反面教材 ✅）。端口占用 → 报错 + 提示用户改端口。
6. **不复用连接**：允许多客户端并存但**各自独立会话**，不搞「新连接踢旧连接」（Browser MCP 反面教材 ✅）。这点与 §1.2 `pageId` 路由天然契合。
7. **审计日志**：所有动作记 `{ts, session_id, turn_id, action, target_url, origin, approved_by, result}`，本地仅追加。

**L2 · 授权层（谁能调、能调什么）**

8. **per-session origin 白名单**（抄 browser-use 的 `allowed_domains` 会话级注入 ✅ + Codex 的 per-origin elicitation ✅）：session 建立时声明允许的 origin 集合；**每次 tab-scoped 动作前校验当前 tab 顶层 URL 的 origin**；`navigate` 校验**目标 URL**。
9. **扩展内可视授权 UI**：按 origin 的允许/拒绝/一次性，可撤销（抄 Claude in Chrome 的 site permission 模型 🟡，以及 Codex 的 `persist: "always"` ✅）。**不要把授权只放在配置文件里**——用户改不动就等于没有。
10. **`localhost` / `127.0.0.1` / `::1` 的自动放行要谨慎**：Codex 直接放行 🟡。BUA 建议**默认放行但可关**，因为本地服务常是用户自己的 dashboard，但也是 SSRF 的目标。
11. **能力开关（capabilities）**：抄 Codex 的 `capabilities.fileUploads` / `.downloads` / `.mediaDownloads` ✅ —— 能力在 `getInfo` 里声明，命令执行前先校验。
12. **无 CDP 降级模式**：检测 `attach()` 失败（尤其是 Chrome 155 的政策错误字符串 ✅），降级到 `chrome.scripting` + `chrome.tabs` 模式，并**在 `getInfo` 的 capabilities 里如实声明**可用能力子集。

**L3 · 动作层（防误操作与注入）**

13. **动作风险分级**（建议三级，扩展侧硬编码，**不信任 agent 传的 hint** ✅ MCP 规范警告）：
    - `read`：`page_info` / `screenshot` / `dom_snapshot` / `list_tabs` / `get_tabs` —— 免审批（对标 MCP `readOnlyHint` ✅）
    - `write`：`click` / `type` / `navigate` / `scroll` / `select_option` —— 按 origin 授权即可
    - `destructive`：**提交表单、支付/结算、删除、发送消息、上传/下载文件、写剪贴板、`finalize_tabs` 关 tab** —— **每次必审批**，且**必须在审批 UI 上展示人类可读的目标描述 + 目标 origin + 关键参数**
14. **⭐ 把审批信息嵌进 action schema**（抄 Playwright MCP ✅ + Codex）：每个 `write`/`destructive` action 都要求一个 `element`（或 `target_description`）人类可读字段，例如 `{"type":"click","x":..,"y":..,"element":"Checkout 按钮（￥299）"}`。**坐标本身无法让人判断风险，描述可以。**
15. **敏感字段占位符**（抄 Playwright MCP `--secrets` ✅ + browser-use `sensitive_data` 🟡）：agent 传占位符，扩展侧替换。**真实凭据不进 LLM 上下文。**
16. **TOCTOU 强校验**：`page_info`/`dom_snapshot` 返回一个 `pageVersion`/`snapshotId`；后续动作携带它；**不匹配 → 拒绝并要求重新观察**（抄 open-browser-use `registration_id` 的快照失效语义 ✅）。
17. **`networkidle` 之类不可靠等待一律不做**（Codex 显式拒绝 ✅），改用显式条件等待。
18. **`javascript_evaluation` 可关闭**（抄 chrome-devtools-mcp ✅）；关闭时禁止 `javascript:`/`data:`/`vbscript:` 导航、禁止 `initScript`。
19. **明确不做的事**：不开本地 CDP 端口；不做二进制补丁（patch-browser 路线 ✅ 但不应采用）；不提供 `remote-allow-origins=*`。

---

## 6. 结论：BUA 的架构取向建议

### 6.1 五条最重要的发现

1. **`chrome.debugger` + Native Messaging 是唯一同时满足「真登录态」和「零本地端口暴露」的路线**，而且 Chrome 136/144 的两道 CDP 禁令**完全不适用于它**。Codex 官方和 open-browser-use 都已验证这条拓扑。
2. **本地 WebSocket 桥目前全行业都是安全洼地**：Browser MCP 无 token/无 Origin 校验/踢连接/杀端口占用进程；mcp-chrome 的 Authentication 还在 Roadmap 上。**「带 token 握手 + Origin/Host 双校验的 WS 桥」是本项目最容易建立的技术权威** —— 且 MCP 规范已经为我们背书（Origin MUST、127.0.0.1 SHOULD）。
3. **URL 级域名白名单被三家独立承认不可靠**（Playwright MCP 官方、chrome-devtools-mcp 的 pattern 限制、以及 `chrome.debugger` 官方声明 *"CDP operates beneath the web platform's origin model"*）。安全必须做成**扩展侧的动作级闸门**，而不是 URL 过滤器。
4. **Codex 的三层闸门（capabilities → 站点策略 → per-origin elicitation）+ 双层命令面（`cua_*` 坐标层 / `playwright_locator_*` 语义层）是被验证过的最佳形态**，open-browser-use 已把它逆向并文档化，BUA 可以直接对齐。
5. **有状态会话的正确解法已经形成共识**：显式 `pageId` 路由（chrome-devtools-mcp）、session TTL + 后台清理（browser-use 10 分钟）、tab group 作为可视锚点 + `chrome.storage.local` 持久化以对抗 MV3 service worker 重启（open-browser-use）。**三者应全部采纳。**

### 6.2 建议的架构取向

- **路线**：MV3 扩展（`chrome.debugger`）**必须**是主路径；本地桥**必须**走 WebSocket（对齐既定设计），但**必须在协议层补齐 token 握手 + Origin/Host 校验**，并**默认硬绑 127.0.0.1**。同时提供 **Native Messaging 作为高安全档位**（零端口）——把 open-browser-use 的拓扑作为可选加固模式。
- **API 分层（对齐 Codex）**：`get_info` / `list_tabs` / `user_tabs` / `claim_tab` / `create_tab` / `finalize_tabs` / `name_session`（会话层）+ `cua_*`（坐标层，对齐 OpenAI action 全集：click/double_click/drag/keypress/move/screenshot/scroll/type/wait）+ `dom_*` / `locator_*`（语义层）+ `webmcp_list_tools` / `webmcp_invoke_tool`（站点自暴露工具层）。**每个请求带 `session_id` + `turn_id`**。
- **必须补齐的三个空白**（这是差异化，不是抄）：① **握手 token + peer 校验**；② **动作风险三级分类 + 破坏性动作强制审批 + 人类可读目标描述**；③ **CDP attach 被企业策略拒绝时的无 CDP 降级模式**。
- **分发矩阵对齐 open-browser-use**：CLI + JS/Py/Go SDK + MCP server（stdio）+ agent skill + `AGENTS.md`。

---

## 附录 A：核心 URL 索引

**项目**

- Playwright MCP — <https://github.com/microsoft/playwright-mcp> ｜ <https://playwright.dev/mcp/capabilities>
- chrome-devtools-mcp — <https://github.com/ChromeDevTools/chrome-devtools-mcp> ｜ `docs/tool-reference.md`、`docs/configuration.md`、`docs/advanced-usage.md`
- browser-use — <https://github.com/browser-use/browser-use> ｜ `browser_use/mcp/server.py` ｜ <https://docs.browser-use.com/open-source/customize/integrations/mcp-server>
- Chrome MCP Server — <https://github.com/hangwin/mcp-chrome>
- Browser MCP — <https://github.com/browsermcp/mcp> ｜ <https://browsermcp.io> ｜ <https://docs.browsermcp.io>
- open-browser-use — <https://github.com/iFurySt/open-browser-use> ｜ <https://www.ifuryst.com/en/blog/2026/open-browser-use/>
- Codex 扩展逆向快照 — <https://github.com/iFurySt/open-browser-use/tree/main/docs/references/codex-chrome-extension-1.1.4>
- Nanobrowser — <https://github.com/nanobrowser/nanobrowser>
- Stagehand — <https://github.com/browserbase/stagehand> ｜ <https://docs.stagehand.dev>
- Hermes agent browser 文档 — <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/browser.md>
- patch-browser — <https://pypi.org/project/patch-browser/> ｜ <https://github.com/DreamXiaoJing/debug-default-profile>
- Claude in Chrome 权限 — <https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide>

**平台与规范**

- Chrome 136 远程调试变更 — <https://developer.chrome.com/blog/remote-debugging-port>
- Chrome 155 `chrome.debugger` 企业策略 — <https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions>
- WebMCP — <https://github.com/webmachinelearning/webmcp> ｜ <https://webmachinelearning.github.io/webmcp/>
- MCP 规范（tools）— <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/tools.mdx>
- MCP 规范（elicitation）— <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/client/elicitation.mdx>
- MCP Streamable HTTP 传输 — <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>
- OpenAI Computer Use 文档 — <https://platform.openai.com/docs/guides/tools-computer-use>
- URLPattern — <https://urlpattern.spec.whatwg.org/>

## 附录 B：未确认 / 待验证项

| 项 | 状态 |
|---|---|
| OpenAI CUA `pending_safety_checks[].code` 的枚举值（`malicious_instruction` / `irrelevant_domain` / `sensitive_domain`） | ⚠️ 未从官方 SDK 类型或文档读到 |
| `acknowledged_safety_checks` 字段名 | ⚠️ 未从官方类型读到 |
| Anthropic `computer_20250124` 的完整 action schema | 🟡 仅见第三方 crate 文档 |
| `chrome.debugger` 与已打开 DevTools 的冲突行为 | ⚠️ 未获取一手当前文档，需实测 |
| `chrome.debugger` 能否 attach 到 `chrome://` / 其他扩展页 / OOPIF | ⚠️ 未验证 |
| Browser MCP 的 `WebSocketServer` 是否真的监听 0.0.0.0 | ⚠️ 推测（Node `ws` 默认行为），未实测 |
| Browser MCP 的 `browser_click` 等工具的完整参数名 | 🟡 从 `snapshot.ts` 正则提取 |
| Puppeteer MCP 的工具名与许可 | 🟡 社区文档整理 |
| Playwright MCP `--extension` 的连接协议 | ⚠️ 无公开文档 |
| `llms.txt`、agent identity/consent 提案 | ⚠️ 本次未覆盖 |
| 各项目 stars 的精确值 | ⚠️ 单次 HTML 抓取，量级参考 |

> **已在本轮补验并确认**（无需再查）：`iFurySt/open-browser-use` = 365 stars / MIT；`NousResearch/hermes-agent` = 252,849 stars / MIT；`nanobrowser/nanobrowser` = 14,070 stars / Apache-2.0；`browser-use/browser-use` = 117,668 stars / MIT；`ChromeDevTools/chrome-devtools-mcp` = 53,301 stars / Apache-2.0。获取方式：`curl.exe` 抓 GitHub 仓库页 HTML 中的 `"stargazerCount"` 与 license 徽章。
