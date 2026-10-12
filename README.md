# BUA — Browser Use Agent

**让任意 Agent 操作用户真实浏览器的通用能力层。**

> Playwright 让你操作「一个浏览器」。BUA 让你操作「用户的**那个**浏览器」。

---

> Playwright 让你操作「一个浏览器」。BUA 让你操作「用户的**那个**浏览器」。

BUA 是一个 Chrome MV3 扩展 + 本地桥 + 精简 SDK，把「控制浏览器」做成一个中立、可被**任何** agent 复用的能力：DSH、Claude Code、Codex、自研脚本都能连同一个桥。

- **用真实浏览器** —— 真实标签页、真实 Cookie、真实登录态。不用重新登录，不用过风控
- **不用重启浏览器** —— 通过扩展内的 `chrome.debugger` 从**内部** attach
- **不绑定任何 Agent** —— 协议中立，API 形状对齐 Codex 以便迁移

## 为什么需要它

现有的浏览器 agent 方案分三类，各自有一个硬伤：

| 路线 | 代表 | 硬伤 |
|---|---|---|
| 独立浏览器自动化 | Playwright / Puppeteer | **没有用户的登录态**。要重新登录、过风控、扫验证码 |
| 直连 CDP 端口 | `--remote-debugging-port` + Puppeteer | **CDP 端口无认证** —— 本机任意进程连上 `127.0.0.1:<port>` 就等于拿到浏览器完全控制权。且 Chrome 136+ 对默认 user-data-dir **静默失效该端口**，144+ 每次连接都要用户点批准 |
| 浏览器扩展 | Codex 的 ChatGPT 扩展、Browser MCP | 方案本身对，但要么闭源、要么绑定单一 agent，**且现有的本地桥普遍没有鉴权** |

**BUA 走扩展路线，并且把两个公认的缺口补上。**

### 差异一：零本地端口

扩展通过 `chrome.debugger` 从**内部** attach —— 天然拥有用户真实标签页、Cookie、登录态，**无需重启浏览器**，也**不需要在 `127.0.0.1` 上开任何 CDP 端口**。

这意味着「本机进程连上调试端口即接管浏览器」这个风险面**根本不存在**。

> 注：BUA 自己的桥仍然监听本地端口（扩展要连它），所以 token 鉴权是硬需求 —— 见 §安全。

### 差异二：安全不靠 URL 白名单

竞品调研发现，**URL 级域名白名单不是安全边界**，三方独立承认：

> Chrome 155 官方博客：*"Because CDP operates beneath the web platform's origin model, **origin-based filtering cannot securely restrict it**"*

BUA 因此把真正的闸门放在**扩展侧的动作级分级**：`read` 免审批 / `write` 按 origin 授权 / `destructive`（提交、支付、删除、发送、上传下载）**每次必审批**，且审批 UI 强制展示人类可读的目标描述 —— 因为**坐标无法让人判断风险，描述可以**。

### 差异三：不抢用户进程

调研中发现的行业反面教材：Browser MCP（7.2k★）开 `9009` 端口无任何鉴权，`killProcessOnPort(9009)` 会**强杀用户机器上占用该端口的任意进程**，新连接还会直接踢掉旧连接。

BUA 明确**不做**这三件事（kill 端口占用进程 / 踢旧连接 / 无鉴权）。端口被占用就报错让用户换，多客户端各自独立会话。

## 状态

🚧 **早期设计阶段（M0 完成）**。API 面已定型，`protocol` 包已实现并测试，扩展与桥未开始。

已完成的可行性验证：
- ✅ CDP 全链路实测通过（读 DOM / 点击 / 真实鼠标与键盘事件注入 / 截图）
- ✅ 抠出 OpenAI Codex 浏览器扩展的完整 API 面作为对齐基准（22 接口 / 152 声明 / 67 类型，共 219 条，逐条核对一致）
- ✅ 竞品调研（Playwright MCP / chrome-devtools-mcp / Stagehand / Browser MCP / open-browser-use / WebMCP）
- ✅ 上架政策调研 —— **结论：`chrome.debugger` 是 Google 官方明文允许的远程执行例外，能过审**


## 文档

| 文档 | 内容 |
|---|---|
| [docs/design.md](docs/design.md) | **设计主文档**：架构、API 对齐映射、安全模型、路线图、未决问题 |
| [docs/protocol.md](docs/protocol.md) | 桥协议：JSON-RPC 方法、类型、错误码 |
| [research/](research/) | 调研材料：竞品、上架政策、Codex API 参考 |

## 架构一览

```
┌──────────────┐   MCP / HTTP / SDK   ┌──────────────┐   WebSocket    ┌──────────────┐
│  任意 Agent   │ ───────────────────▶ │  bua-server  │ ◀────────────▶ │  BUA 扩展     │
│              │ ◀─────────────────── │  (本地桥)     │   token 鉴权    │  (MV3)       │
└──────────────┘                      └──────────────┘                └──────┬───────┘
                                                                             │ chrome.*
                                                                             ▼
                                                                  用户真实浏览器
```

```
packages/
├── protocol/    # 唯一真源：类型、方法名、schema
├── extension/   # Chrome MV3 扩展（控制节点）
├── server/      # 本地桥：ws 服务端 + token + 会话路由
├── sdk/         # agent 侧 SDK（对齐 Codex 形状）
├── mcp/         # MCP 适配器（可选）
└── cli/         # bua 命令行
```

## API 速览

BUA 的 agent 侧 API 直接对齐 Codex，为同一个标签提供**四个抽象层次**，让 agent 按任务精度选择：

```js
const browser = await agent.browsers.getDefault();

// 接管用户已经打开的一个标签（不是新开一个）
const [userTab] = await browser.user.openTabs();
const tab = await browser.user.claimTab(userTab);

// ① Playwright 层：语义定位，最稳 —— 默认首选
const el = tab.playwright.getByRole("button", { name: "提交" });
await el.click();

// ② AX 层：无障碍树，用于视觉确认与结构化读取
await tab.ax.write("both");

// ③ DomCUA 层：可见 DOM 节点 id，坐标不稳时的折中
const dom = await tab.dom_cua.get_visible_dom();

// ④ CUA 层：视口坐标，无语义元素时的兜底
await tab.cua.click({ x: 320, y: 480 });

// 能力协商：只做后端真正支持的事
const caps = await tab.capabilities.list();
const cdp = await tab.capabilities.get("cdp");
await cdp.send("Network.enable");
```

## 安全

一个能读你所有标签页并代你点击的组件，权限等级等同于**遥控你的浏览器**。BUA 的设计前提：

- 桥**只绑 `127.0.0.1`**，且强制一次性高熵 token —— 本机其他进程连不上
- **域名白名单**默认拒绝，敏感操作（提交/支付/删除）逐次确认
- **凭据永不穿过桥**：`browserAuth` 在扩展侧填表，值不进 agent 上下文
- **所有页面内容标记为不可信数据**（防提示注入）
- **完整审计轨迹**：每次变更记录变更前状态，可撤销

详见 [docs/design.md §4](docs/design.md)。

## 明确不做

- ❌ 独立浏览器自动化（那是 Playwright 的地盘）
- ❌ 内置模型推理（BUA 不是 agent，是 agent 的手）
- ❌ 账号密码托管
- ❌ 验证码绕过

## 许可

MIT

---

**API 形状对齐** [OpenAI Codex 浏览器扩展](https://openai.com/)，无代码复用。感谢其在浏览器 agent 接口设计上的探索。
