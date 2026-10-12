# DSH 组合包（`@bua/dsh-bundle`）

把 BUA 的浏览器操作能力装进 **DeepSeek Harness**。装好之后，DSH 的会话里会多出
14 个 `mcp__bua__*` 工具，agent 就能操作你**真实的**浏览器。

本组合包**不含任何代码** —— 只有配置、图标和文案。所有逻辑在
[`bua-mcp`](../mcp/README.md) 里，那份实现同时也能给 Claude Code / Codex 用。

---

## 为什么走 MCP 而不是原生 Host 插件

| 方案 | 评价 |
|---|---|
| **MCP（本方案）** | 一份实现多处复用（DSH / Claude Code / Codex）；组合包零代码，审阅成本最低；DSH 已有的 MCP 客户端负责工具命名、环境擦除、重连 |
| 原生 Host 插件 | 只能用在这一种 harness 上，且要自己实现工具注册、生命周期、重连 |

## 安装

在 DSH 会话里让 agent 执行（需要 Full access，`install_bundle` 属于要审批的操作）：

```
把 D:\bua\packages\dsh-bundle 这个组合包安装到当前 profile
```

agent 会用 `plugin_manager` 的 `install_bundle`，`target` 指向该目录的绝对路径。

安装是 `link:` 语义 —— pnpm 把 profile 的依赖**符号链接**到这个目录。因此：

- **改了 bundle 内容**（patch / locale / icon）→ 重新安装或重启生效
- **改了 `bua-mcp` 的代码** → 需要 `pnpm --filter @bua/mcp run build`，然后重启

### 前置条件

安装组合包只让工具**出现**；真正能用还需要两件事：

1. **桥在运行** —— `bua-server`（端口 17432）
2. **扩展已启用** —— 在 `chrome://extensions` 加载 `packages/extension/dist` 并在引导页勾选同意

缺任一项时工具仍在目录里，但调用会返回**可操作的错误**（而不是静默失败）。这是有意的：
`failOnStartupError: false` 保证桥没起时不会阻断 DSH 启动。

## ⚠️ 路径是本机的绝对路径

`cordis.patch.yml` 里的 `args` 指向本机的 `packages/mcp/dist/stdio.js`：

```yaml
command: node
args:
  - D:\bua\packages\mcp\dist\stdio.js
```

**换机器或移动仓库后必须改这里**，否则插件的行会激活失败、工具一个都不出现。

自检会发现这个问题：

```sh
pnpm --filter @bua/dsh-bundle run test
```

其中一项专门验证「patch 里声明的路径真实存在」，失败时会直接给出应改成的绝对路径。

**想免去绝对路径**：把 `@bua/mcp` 发布到 npm，然后改成

```yaml
command: npx
args: ['-y', '@bua/mcp']
```

## 自检覆盖什么

`test/bundle.test.mjs` 的 11 项逐条对应 DSH 的 `install_bundle` 会读的东西：

- `dsh.bundle.patch` 声明且文件存在
- `exports` 提供 `./locale/*.json` 与 `./icon`（DSH 读展示元信息靠这两个出口）
- `files` 覆盖 patch / locale / icon
- patch 插入的是**已随 DSH 交付**的 `@deepseek-ai/dsh-mcp-client`
- **`args` 指向真实存在的 `stdio.js`**（最容易因移动仓库而失效的一条）
- `failOnStartupError: false`（桥没起时不该阻断启动）
- `!!js` 没出现在 `command`/`args` 上（该字段只支持 `env` / `headers`）
- 中英文 locale 都有 `meta.title` / `meta.description`，且**不是同一份复制品**
- `icon.svg` 合法、自包含（无外部引用）、体积在 256 KiB 内
- **patch 里的端口与扩展硬编码的端口一致** —— 不一致会永远连不上

## 图标

`icon.svg` 沿用扩展运行时注入页面的**边缘泛光**视觉语言 —— 深色圆角底 + 蓝色泛光边框 +
窗口标题栏。用户在插件列表里认得出「就是那个会在页面上发光的东西」。

原创绘制，无第三方素材，无外部引用（DSH 会拒绝绝对路径、URL、以及指向包外的符号链接）。
