# BUA Chrome 扩展（`@bua/extension`）

Chrome MV3 扩展。通过 `chrome.debugger`（CDP）操作用户**真实**浏览器 —— 真实标签页、真实登录态，无需重启浏览器、无需开放 CDP 端口。

设计见 [设计文档 §4](../../docs/design.md)、协议见 [docs/routing.md](../../docs/routing.md)。本文件只讲这一层的实现。

---

## 构建与加载

```sh
pnpm --filter @bua/extension run build
```

产物在 `packages/extension/dist/`。然后：

1. 打开 `chrome://extensions`
2. 打开右上角**开发者模式**
3. 点**加载已解压的扩展程序**，选 `packages/extension/dist`
4. 首次加载会自动打开**引导页** —— 读完风险告知并勾选同意后才启用

## 为什么没有侧边栏

侧边栏会长期占用页面宽度，而 agent 操作浏览器时用户多数并不盯着看。所以状态表达分成两层：

| 层 | 位置 | 职责 |
|---|---|---|
| **边缘泛光** | 注入到页面 | **氛围信号**：正在被操作 / 已降级 / 已暂停 |
| **工具栏弹窗** | 点扩展图标 | **完整信息**：连接状态、操作流水 |

这样页面面积零占用，而追溯信息随时可得。

## 边缘泛光（`src/overlay.ts`）

| 状态 | 颜色 | 含义 |
|---|---|---|
| `active` | 蓝 | CDP 可用，正常操作 |
| `degraded` | **琥珀 + 警示行** | 企业策略拒绝 CDP，已降级到 `chrome.scripting` |
| `paused` | 灰 | 用户暂停 |
| `idle` | 浅灰 | 已连接但无操作 |

实现上的几个关键选择：

- **`closed` Shadow DOM** —— 页面 CSS 的 `* { }` 规则和 `z-index` 战争无法影响覆盖层，覆盖层也不会污染页面。这是必须的，普通注入在真实站点上会被样式冲突搞坏。
- **`pointer-events: none`** —— 覆盖层在视觉上存在、交互上透明，绝不拦截用户点击。
- **泛光 = 三层 inset + 一层外溢 `box-shadow`** —— inset 画向内的光晕，外溢那一层让光晕超出视口边缘，看起来像屏幕在发光而不只是一个内边框。
- **徽标在底部居中** —— 页面顶部是导航、通知条、聊天组件的密集区，放那里会遮挡内容。
- **注入方式用 `Page.addScriptToEvaluateOnNewDocument`**（带 `runImmediately`）而非 `Runtime.evaluate` —— 前者在**每次导航**后自动重跑，后者只在当前文档有效，页面一跳泛光就没了。
- **覆盖层源码是「被序列化的真实 TypeScript 函数」** —— 这样 `tsc` 和编辑器能对注入代码做语法检查，改错立刻在编译期暴露，而不是等注入到用户页面里才静默失败。
- 尊重 `prefers-reduced-motion`。

### 一个值得记住的坑

覆盖层会自初始化成 `idle`。而页面脚本常在**解析阶段**就调 `set(active)`。早期实现里 `DOMContentLoaded` 回调会无条件再 `apply(idle)`，把已设好的状态覆盖掉 —— 现象是**泛光是对的（蓝），徽标却显示「待机」**。

用 `hasExplicitState` 标志修掉：一旦有调用方显式设过状态，自初始化就不再执行。`test/overlay.test.mjs` 里有三条回归用例覆盖这条路径。

> 这个 bug 靠**肉眼看截图**发现，不是靠测试 —— 因为原有测试全用 `readyState: 'complete'` 且先注入再 `set`，永远走不到那个顺序。

## 权限（按上架调研结论）

```json
"permissions": ["debugger", "tabs", "storage", "scripting", "activeTab"],
"host_permissions": []
```

**刻意没有 `<all_urls>`**：官方明文 `chrome.debugger` **不需要** host permission（它自带「访问所有网站」的能力）。多申请只会招致更严审查 —— 官方同时警告「申请超出必要的权限可能导致被拒」。

## 引导页（`src/onboarding.ts`）

承担两件事：

1. **风险告知 + 主动同意** —— 告知「任何本机能访问回环的程序都可以操作你的浏览器」，用户必须**主动勾选**才启用
2. 展示连接信息（**端口固定，不提供配置入口**）

**未同意时 `background.ts` 的 `connect()` 直接返回**，所以绕过这一页也没有连接。

这同时满足 Chrome Web Store 的 **Prominent Disclosure** 要求 —— 官方明文：商店描述或内联安装页里的披露**不算数**，必须发生在扩展自己的 UI 内、且要有明确的用户动作。

### 端口固定为 17432

端口**硬编码**在 `background.ts` 的 `BRIDGE_PORT`，与 `server/src/cli.ts` 的 `DEFAULT_PORT` 必须一致。

**为什么不做成可配置**：端口可配会引入一个纯粹自找的失败模式 —— 用户填一个端口、桥起在另一个端口，两边都「看起来正常」但连不上，而错误信息完全指不到真正原因。这个坑真实发生过。固定之后，连不上就只有一个解释：桥没跑。

若 17432 被占用，桥会明确报冲突；换端口后必须重新加载扩展。

### 连接失败会自动重试

扩展在 service worker 启动时连一次桥，之后**按 2 秒 → 30 秒的指数退避持续重试**，连上后重置。

这个重试是必需的：「先装扩展、后启动桥」是最常见的操作顺序，早期版本只连一次、失败了永不重试，用户体感就是「一直提示未能连接」且**永远不会恢复**。

连接后每 20 秒发送 WebSocket 心跳，保持后台活跃。另使用 `chrome.alarms` 每 30 秒检查连接；后台被回收或电脑唤醒后，会自动恢复重连。未同意启用时不创建此定时任务。浏览器退出、扩展被禁用或电脑休眠期间无法保持连接。

## CDP 降级

`attachTab()` 区分两类失败：

| 失败 | 处理 |
|---|---|
| DevTools 占用了该标签 | 临时冲突，`BUA_DEBUGGER_UNAVAILABLE`（可重试） |
| **企业策略拒绝**（Chrome 155+） | 错误串含 `restricted by policy`，**无法绕过**，必须降级 |
| 用户关闭调试横幅 | `chrome.debugger.onDetach` 感知并广播 `debugger.detached` |

企业策略场景下错误串来自 Chrome 官方文档：
- `runtime_blocked_hosts` 非空 → `"Host access is restricted by policy."`
- `DisableScreenshots` / DLP → `"Screenshot capture is restricted by policy."`

## MV3 状态持久化

service worker 会被 Chrome 随时回收，因此下表的状态**存在 `chrome.storage`**，不放模块作用域：

| 数据 | 位置 | 理由 |
|---|---|---|
| 桥端口 | `storage.local` | 用户配置 |
| 同意时间戳 | `storage.local` | 合规证据，且门控连接 |
| 能力清单 | `storage.local` | 降级状态必须跨 SW 重启保留 |
| 操作流水 | `storage.local` | 审计，保留最近 200 条 |
| WebSocket / 已 attach 标签集 | 模块作用域 | 运行时资源，回收即失效 |

## 测试

```sh
pnpm --filter @bua/extension run test
```

25 项，含：

- `overlay.test.mjs` —— 覆盖层行为。**在隔离的 `node:vm` 上下文里真正执行注入脚本**，配最小 DOM 桩（不引 jsdom）。覆盖幂等注入、`readyState: 'loading'` 时延迟挂载、状态配色、警示行显隐与清理、`destroy` 后重建，以及两条页面安全契约（`pointer-events: none`、只新增一个全局键）
- `demo-artifacts.test.mjs` —— 从**生成的预览 HTML** 里把脚本抠出来按顺序执行，验证最终状态。这一层才是复现上面那个竞态的地方

```sh
node scripts/demo-overlay.mjs   # 生成三张预览页（用生产 OVERLAY_SCRIPT）
```

预览页用 `?nobanner` 去掉模拟的 Chrome 调试横幅，便于单独检查徽标与警示行的渲染。
