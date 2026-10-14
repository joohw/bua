# Hermes Agent 接入 BUA

这里指 Nous Research 的 Hermes Agent。它支持原生 stdio MCP 客户端，直接连接现有 `@bua/mcp` 即可，无需另写 Python 工具插件。

先完成[共同准备](README.md#共同准备)，再将下面条目合并到当前 Hermes profile 的 `config.yaml`。默认位置为 `~/.hermes/config.yaml`；已有 `mcp_servers` 时只添加其 `bua` 子项，不要创建重复顶层键。

```yaml
mcp_servers:
  bua:
    command: node
    args:
      - 'D:/bua/packages/mcp/dist/stdio.js'
    env:
      BUA_BRIDGE_PORT: '17432'
    enabled: true
    supports_parallel_tool_calls: false
```

将路径改为 Hermes 实际运行环境中的绝对路径；若其 PATH 找不到 Node，`command` 使用 Node 可执行文件的绝对路径。

启动 `hermes chat`，或在现有会话使用 `/reload-mcp`。通过[第一次验证](README.md#第一次验证)检查浏览器。Hermes 将工具名前加 `mcp_bua_`，例如 `mcp_bua_tabs_list`。

浏览器导航、点击和输入依赖页面状态，因此保持顺序调用。若只想先测试读取，可为 `bua` 加过滤配置：

```yaml
    tools:
      include:
        - browser_info
        - tabs_list
        - tab_info
        - tab_dom_snapshot
        - tab_text
        - tab_screenshot
```

这是 `bua` 条目下的 `tools`，与 `env` 同级。过滤使用原始 MCP 工具名，不能写带 Hermes 前缀的名称。`tab_evaluate` 能执行 JavaScript，不包含在本例的读取工具清单中。

停止时将本条目的 `enabled` 改为 `false` 并重载 MCP，核实 BUA 子进程已退出。完整生命周期和故障排查见[共同说明](README.md#会话与故障排查)。本配置按官方接口准备，尚未在实际 Hermes 安装中执行端到端验证。

官方依据：[MCP 集成](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)、[配置参考](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)。核实日期：2026-10-12。
