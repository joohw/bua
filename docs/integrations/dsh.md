# DeepSeek Harness 接入 BUA

使用本仓库的 **dsh-plugin-bua 原生插件**，不再通过 MCP 客户端配置接入。Chrome 扩展继续独立安装并同意启用；插件自动管理本地桥，无需手动启动 bua-server。

本地构建和安装：

```sh
pnpm install --config.auto-install-peers=false
pnpm --filter dsh-plugin-bua... run build
dsh plugin --profile demo add ./packages/dsh-bundle
dsh --profile demo --dump-config
dsh --profile demo
```

工具名为 `bua_*`。先请求 Agent 调用 `bua_browser_info`，再调用 `bua_tabs_list` 列出标签，验证时只读。

插件尚未发布 npm；完整打包、生命周期与验证边界见 [插件 README](../../packages/dsh-bundle/README.md)。其他 Harness 继续使用独立 MCP 入口。
