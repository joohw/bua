# BUA — Browser Use Agent

**让任意 Agent 操作用户真实浏览器的通用能力层。**

> Playwright 让你操作「一个浏览器」。BUA 让你操作「用户的**那个**浏览器」。

---

## 这是什么

BUA 是一个 Chrome MV3 扩展 + 本地桥 + 精简 SDK。它把「控制浏览器」做成一个中立、可被任何 agent 复用的能力：

- **用真实浏览器** —— 真实标签页、真实 Cookie、真实登录态。不需要重新登录，不用过风控
- **不用重启浏览器** —— 通过扩展内的 `chrome.debugger` 从内部 attach，绕开「Chrome 不允许在默认 profile 上开调试端口」的限制
- **不绑定任何 Agent** —— DSH、Claude Code、自研脚本都能连同一个桥
- **API 对齐 Codex** —— 已有的 Codex 浏览器 agent 逻辑可低成本迁移

## 状态

🚧 **早期设计阶段（M0 完成）**。API 面已定型，实现未开始。

已完成的可行性验证：
- ✅ CDP 全链路实测通过（读 DOM / 点击 / 真实鼠标与键盘事件注入 / 截图）
- ✅ 抠出 OpenAI Codex 浏览器扩展的完整 API 面作为对齐基准（22 接口 / 152 声明 / 67 类型，共 219 条）
- ✅ 竞品与上架政策调研

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
