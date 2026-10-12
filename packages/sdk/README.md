# BUA agent 侧 SDK（`@bua/sdk`）

把「手搓 JSON-RPC 消息」变成可发现、可补全的对象树。**形状对齐 OpenAI Codex 的浏览器 API**（对齐基准：[research/03-codex-api-reference.md](../../research/03-codex-api-reference.md)），使已有针对 Codex 写的 agent 逻辑能低成本迁移。

---

## 快速开始

```sh
# 终端 1：起桥
bua-server --port 17432

# 终端 2：装扩展并完成引导页授权（扩展会主动连桥）
```

```ts
import { connect } from '@bua/sdk';

const agent = await connect({ port: 17432, client: { name: 'my-agent', version: '1.0' } });

const browser = await agent.browsers.getDefault();

// 接管用户**已经打开**的标签 —— 真实登录态，不用重新登录
const [userTab] = await browser.user.openTabs();
const tab = await browser.user.claimTab(userTab);

// 默认优先用语义定位（Playwright 层）
await tab.playwright.getByRole('button', { name: '提交' })
  .click({ targetDescription: '提交按钮' });

console.log(await tab.text());
const png = await tab.screenshot();
await agent.close();
```

## `targetDescription` 是必填的

所有**变更型**方法（`click` / `fill` / `type` / `goto` / `cua.*` …）都必须传一个**人类可读的意图描述**：

```ts
await tab.click('#checkout', { targetDescription: '结算按钮（￥299，含运费）' });
```

理由：**坐标无法让人判断风险，描述可以**。它进审计日志，让用户事后能读懂 agent 干了什么。桥会在转发前校验非空，缺失直接拒绝（`BUA_MISSING_TARGET_DESCRIPTION`）。

读操作（`title()` / `url()` / `domSnapshot()` / `evaluate()` / `screenshot()`）不需要。

## 四层操作抽象

同一个标签提供四个精度层次，按任务选，不必只用一个：

| 层 | 入口 | 语义 | 何时用 |
|---|---|---|---|
| **Playwright** | `tab.playwright` | 语义定位器 | **默认首选**，最稳 |
| **AX** | `tab.ax` | 无障碍树 | 视觉确认与结构化读取 |
| **DomCUA** | `tab.domCua` | 可见 DOM 节点 id | 坐标不稳时的折中 |
| **CUA** | `tab.cua` | 视口坐标 | 无语义元素时的兜底 |

```ts
// Playwright 层
await tab.playwright.locator('#q').fill('bua', { targetDescription: '搜索框' });
const nodes = await tab.playwright.domSnapshot();   // 带 id 的可交互元素清单

// AX 层
const state = await tab.ax.get();

// CUA 层（真实鼠标事件，scripting 做不到）
await tab.cua.click(320, 480, { targetDescription: '画布中心' });
```

## 能力协商：先探测再使用

BUA **不限制 agent、不签发凭据**（见[设计文档 §4.0](../../docs/design.md)），所以没有「授权层级」。取而代之的是**如实的能力声明**：

```ts
const caps = agent.capabilities;
if (caps?.cdp === false) {
  // 企业策略拒绝了 CDP（Chrome 155+），扩展已降级到 chrome.scripting
  // —— 此时不要调 cua.* / screenshot，改走 DOM 路径
}
```

`agent.onEvent` 能感知**运行时**的能力变化（例如用户后来在受管机器上启用了策略）：

```ts
agent.onEvent((e) => {
  if (e.type === 'backend.ready') console.log('能力已更新', e.capabilities);
  if (e.type === 'debugger.detached') console.log('⚠ 用户关闭了调试横幅，会话终止');
  if (e.type === 'backend.gone') console.log('扩展断开');
});
```

> `debugger.detached` 值得特别处理：Chrome 的调试横幅**用户一关就终止 attach**，agent 必须能感知，否则会对着一个已死的会话继续发指令。

## 错误处理：按码路由

`BuaError` 把机器可路由的 `buaCode` 单独暴露 —— **不要解析错误文案**：

```ts
import { BuaError } from '@bua/sdk';

try {
  await tab.click('#buy', { targetDescription: '购买' });
} catch (err) {
  if (err instanceof BuaError) {
    switch (err.buaCode) {
      case 'BUA_MISSING_TARGET_DESCRIPTION': /* 补上描述重试 */ break;
      case 'BUA_TAB_CLAIMED':                /* 换标签 */ break;
      case 'BUA_UNSUPPORTED':                /* 没有后端或能力已关 */ break;
      case 'BUA_DEBUGGER_UNAVAILABLE':       /* err.retryable === true */ break;
    }
  }
}
```

`err.retryable` 按码判定（`DEBUGGER_UNAVAILABLE` / `NAVIGATION_TIMEOUT`）。

## 形状对齐 Codex 的对照

| Codex | BUA SDK | 说明 |
|---|---|---|
| `agent.browsers.get/getDefault/getForUrl/list` | ✅ 同名 | `getDefault` 在无后端时抛 `BUA_UNSUPPORTED` |
| `browser.tabs.new/get/list/selected/content` | ✅ 同名 | |
| `browser.user.openTabs/claimTab/getTabContext` | ✅ 同名 | **操作真实浏览器登录态**的核心 |
| `browser.history` / `nameSession` | ✅ 同名 | |
| `tab.goto/back/forward/reload/close` | ✅ 同名 | |
| `tab.url()/title()/screenshot()` | ✅ 同名 | `screenshot()` 返回 `Buffer` |
| `tab.markDeliverable/markHandoff` | ✅ 同名 | 会话生命周期 |
| `tab.playwright.*` | ✅ 子集 | `locator` / `getByRole` / `getByText` / `getByLabel` / `getByPlaceholder` / `getByTestId` / `domSnapshot` / `evaluate` / `waitFor*` |
| `tab.ax.*` | ✅ 子集 | `get` / `click` |
| `tab.cua.*` | ✅ 子集 | `click` / `doubleClick` / `move` / `scroll` / `type` / `keypress` |
| `tab.domCua.*` | ✅ 子集 | `getVisibleDom` / `click` |
| `tab.content.export()` | ✅ | |
| `tab.capabilities.*` | ⚠️ 见下 | BUA 用 `agent.capabilities` 快照 |

### 我们相对 Codex 的差异

| 差异 | 原因 |
|---|---|
| **没有 `tab.capabilities.get()` 的逐个能力文档** | BUA 的能力是**固定的六项布尔值**，不需要逐个取文档。用 `agent.capabilities` 一次拿全 |
| **`targetDescription` 是必填参数** | Codex 把意图描述放在部分工具里；BUA 把它提升为**所有变更型方法的协议契约**，因为无鉴权模型下审计是唯一的追溯手段 |
| **没有 grant / 授权层级** | 产品决策：不限制 agent。见[设计文档 §4.0](../../docs/design.md) |
| **定位器按选择器重查，不用服务端句柄** | 简化实现，避免句柄过期这类坑。代价是复杂链式定位（`first().filter()`）暂不支持 |

### 明确的糖（非 Codex API）

为了让常见操作少写样板，`Tab` 上加了三个便捷方法 —— 底层是同一套 locator 调用：

```ts
await tab.click('#a', { targetDescription: 'A' });          // = playwright.locator('#a').click(...)
await tab.fill('#b', 'hi', { targetDescription: 'B' });
const text = await tab.text();                              // = evaluate('document.body.innerText')
```

## 测试

```sh
pnpm --filter @bua/sdk run test
```

20 项，两层：

- **对假桥** —— 精确验证请求形状（方法名、参数名）、`targetDescription` 是否真的发出、CDP 返回值解包（`{result:{value}}` 两层）、错误映射、事件分发与退订、心跳间隔
- **对真桥**（`@bua/server`）—— SDK → 桥 → 假扩展 → 回到 SDK 的完整接线，验证桥注入的 `__buaSessionId`、审计记录、`targetDescription` 透传

> 测试里有个值得记住的坑：WebSocket 的 `'open'` 监听器**必须在创建后立刻挂**。早期写法是先 `await connect(...)` 再挂监听，中间那段 await 足够让 open 事件派发过去，于是 Promise 永不 resolve、整个测试挂死。

## 依赖

`@bua/protocol`（协议真源）+ `ws`。
