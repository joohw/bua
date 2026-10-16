# BUA — Browser Use Agent

让任意 Agent 操作用户真实浏览器的通用能力层。使用已有标签页、Cookie 和登录态，无需重启浏览器或开放 CDP 调试端口。

[官网](https://joohw.github.io/bua/) · [安装指南](https://joohw.github.io/bua/install.html) · [下载扩展 v0.1.1](https://joohw.github.io/bua/downloads/bua-extension-v0.1.1.zip) · [Agent 接入指南](docs/integrations/README.md)

BUA 由浏览器扩展、本地桥和 Agent 客户端组成。Agent 通过本地桥调用扩展，由扩展使用 `chrome.debugger` 操作真实页面。支持页面读取、截图、点击、输入、滚动和导航；可通过 DeepSeek Harness 原生插件、MCP 或 SDK 接入。

## 安装浏览器扩展

Chrome 用户可从 [Chrome Web Store](https://chromewebstore.google.com/detail/mbfbbokigcicpcgaiiahbbmicokdjflm) 安装。官网 ZIP 提供最新的手动安装构建，商店版本以商店页面为准。

Chrome / Edge 手动安装：

1. 下载 [v0.1.1 ZIP](https://joohw.github.io/bua/downloads/bua-extension-v0.1.1.zip)，解压到固定文件夹。可下载 [SHA-256 校验文件](https://joohw.github.io/bua/downloads/bua-extension-v0.1.1.zip.sha256)核对完整性。
2. 打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的文件夹。
4. 在引导页阅读风险告知并主动同意启用。

点击扩展图标直接进入设置页。点击“查看操作日志”进入独立日志页，选择标签页后查看该标签当前完整地址的记录。日志每页加载 20 条，滚动自动加载更多，页面选项显示网站图标。

更新 ZIP 安装的扩展时，将新版文件解压覆盖到原文件夹，再到扩展管理页点击“重新加载”。ZIP 安装不会因官网下载包更新而自动升级。

## 接入 Agent

### DeepSeek Harness

原生插件自动启动或复用本地桥，浏览器扩展仍需独立安装并启用：

```sh
dsh plugin --profile demo add dsh-plugin-bua
dsh --profile demo
```

工具以 `bua_*` 出现。详见 [DSH 安装与使用](docs/integrations/dsh.md)。

### MCP 客户端

先从源码构建并启动本地桥，再为客户端配置 stdio 入口：

```sh
pnpm install --config.auto-install-peers=false
pnpm build
node packages/server/dist/cli.js
```

```json
{
  "mcpServers": {
    "bua": {
      "command": "node",
      "args": ["<仓库绝对路径>/packages/mcp/dist/stdio.js"],
      "env": { "BUA_BRIDGE_PORT": "17432" }
    }
  }
}
```

配置和工具说明见 [MCP 文档](packages/mcp/README.md)，其他客户端参考 [Harness 接入指南](docs/integrations/README.md)。

### SDK

`@bua/sdk` 当前作为本仓库工作区包使用。构建并启动本地桥后，可在工作区中调用：

```ts
import { connect } from '@bua/sdk';

const agent = await connect({ port: 17432, client: { name: 'my-agent' } });
try {
  const browser = await agent.browsers.getDefault();
  const tabs = await browser.user.openTabs();
  const chosen = tabs.find(tab => tab.url?.startsWith('https://example.com/'));
  if (!chosen) throw new Error('请先打开目标页面');
  const tab = await browser.tabs.get(chosen.id);
  console.log(await tab.title());
  const png = await tab.screenshot();
} finally {
  await agent.close();
}
```

变更型操作需提供人类可读的 `targetDescription`。详见 [SDK 文档](packages/sdk/README.md)。

## 连接与操作提示

- 本地桥默认监听 `127.0.0.1:17432`，扩展使用固定端口连接。
- 启用后自动等待客户端；连接成功后每 20 秒发送心跳，断线自动重试，后台定时唤醒检查连接。
- Agent 接管未分组、未固定的标签时，扩展会创建蓝色“BUA · 正在调试”分组，并在扩展图标显示 `DBG`。
- 会话结束或连接断开后清理对应调试提示。已有分组和固定标签不会被重新分组。
- Chrome 的原生调试横幅由浏览器显示，关闭它会终止调试连接。

## 安全模型

**BUA 不做调用方身份认证。任何能访问本机回环地址的进程都可能通过本地桥操作浏览器，包括已登录页面。** 首次启用前须阅读并同意引导页披露。

本地桥绑定回环地址并校验 Host；不会强杀占用端口的进程。操作记录用于追溯，不构成身份认证或权限隔离。浏览器企业策略、受限页面或其他调试器占用可能使部分操作不可用。

## 源码开发与验证

需要 Node.js 20+ 和 pnpm；仓库配置的 pnpm 版本见 `package.json`。

```sh
pnpm install --config.auto-install-peers=false
pnpm build
pnpm --filter @bua/extension dev
```

开发时加载 `packages/extension/dist`。页面改动后刷新设置或日志页；后台脚本或 manifest 改动后重新加载扩展。

```sh
pnpm --filter @bua/extension typecheck
pnpm --filter @bua/extension test
pnpm --filter @bua/extension release
```

`release` 执行构建、自检和打包，输出 ZIP 与 SHA-256 校验文件到 `packages/extension/release/`。v0.1.1 发布时通过了 34 项扩展测试；实机端到端测试另见 `pnpm --filter @bua/extension test:e2e`。

## 项目结构与文档

| 位置 | 内容 |
|---|---|
| [packages/extension](packages/extension/) | Chrome MV3 扩展、设置和日志页 |
| [packages/server](packages/server/) | 本地 WebSocket 桥、会话路由和审计 |
| [packages/protocol](packages/protocol/) | 协议类型、方法和错误码 |
| [packages/sdk](packages/sdk/) | Agent SDK |
| [packages/mcp](packages/mcp/) | MCP stdio 服务 |
| [packages/dsh-bundle](packages/dsh-bundle/) | DeepSeek Harness 原生插件 |
| [设计文档](docs/design.md) | 架构与设计背景，部分内容为规划 |
| [协议文档](docs/protocol.md) | JSON-RPC 方法和数据结构 |
| [research](research/) | 调研材料与历史参考 |

## 许可

MIT。API 形状参考 Codex 浏览器接口，无代码复用。字体及图标的许可证随相关资源分发。
