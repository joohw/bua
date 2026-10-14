# OpenClaw 接入 BUA

OpenClaw 当前官方文档提供原生 MCP 客户端，服务配置位于 `mcp.servers`。优先使用这一入口，不将其他客户端的 `mcpServers` 配置直接粘贴到 OpenClaw。

先完成[共同准备](README.md#共同准备)，在运行 OpenClaw Gateway 的同一环境执行：

```sh
openclaw mcp add bua --command node --arg D:/bua/packages/mcp/dist/stdio.js
openclaw mcp doctor bua --probe
```

替换入口为当前机器的绝对路径。默认桥端口已是 17432，无需额外环境变量。可先运行 `openclaw mcp add --help` 确认当前安装支持这些选项。若 PATH 找不到 Node，将 `--command` 替换为 Node 可执行文件的绝对路径。

也可以在 Control UI 的 Settings → MCP 添加服务：名称 `bua`、传输 `Stdio`、命令 `node`、参数为上述入口绝对路径。选择这些方式之一即可，不要重复添加同名服务。

探测成功后，向会话发送[第一次验证](README.md#第一次验证)中的请求。工具仍受 OpenClaw 当前 agent 的工具 profile 和策略控制；能添加服务不意味着会话已经获准使用工具。配置变更通常影响下一轮工具发现，旧会话未更新时按官方 MCP 排查说明重载连接。

## 旧版本使用 mcporter

若本机版本没有 `openclaw mcp add`，可升级到支持原生 MCP 的版本，或使用 OpenClaw 仓库附带的 `mcporter` skill。在已经安装 `mcporter` 的环境中执行：

```sh
mcporter call --stdio "node D:/bua/packages/mcp/dist/stdio.js" browser_info
```

此方式由 CLI 调用 MCP，不等价于在模型工具目录中原生注册所有 BUA 工具。路径含空格时需要按当前 shell 正确引用；截图 image 块是否显示由 CLI 和宿主决定。连续任务建议使用原生 MCP，避免每次 CLI 调用新建进程导致会话反复结束。

结束使用时，在 Settings → MCP 停用 BUA 并确认对应连接及子进程结束。详见[生命周期与故障排查](README.md#会话与故障排查)。这些步骤按官方接口准备，尚未在实际 OpenClaw 安装中执行端到端验证。

官方依据：[连接 MCP 服务](https://docs.openclaw.ai/tools/mcp)、[MCP CLI](https://docs.openclaw.ai/cli/mcp)、[mcporter skill](https://github.com/openclaw/openclaw/blob/main/skills/mcporter/SKILL.md)。核实日期：2026-10-12。
