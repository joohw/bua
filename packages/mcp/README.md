# BUA 的 MCP 服务器（`@bua/mcp`）

把 BUA 的浏览器操作能力以 **MCP 工具**暴露给任意支持 MCP 的 agent：DSH、Claude Code、Codex 都能接。

```
agent  ──MCP(stdio)──▶  bua-mcp  ──WebSocket──▶  BUA 桥  ◀──  BUA 扩展  ──▶  你的真实浏览器
```

`bua-mcp` 由 agent 自己拉起，它再作为**客户端**连本地桥（`127.0.0.1:17432`，与扩展硬编码的端口一致）。

---

## 快速开始

```sh
# 1. 构建
pnpm --filter @bua/mcp run build

# 2. 起桥（另一个终端）
bua-server

# 3. 自检：手动跑一次 MCP 服务器
node packages/mcp/dist/stdio.js
```

第 3 步会等 stdin 上的 MCP 消息 —— 看不到输出是正常的，它通过 stdin/stdout 讲协议。

### 在 DSH 里安装

用仓库里的组合包，见 [`packages/dsh-bundle`](../dsh-bundle/README.md)。装好后工具以
`mcp__bua__*` 出现。

### 手动配置（任何 MCP 客户端）

```json
{
  "mcpServers": {
    "bua": {
      "command": "node",
      "args": ["<仓库>/packages/mcp/dist/stdio.js"],
      "env": { "BUA_BRIDGE_PORT": "17432" }
    }
  }
}
```

---

## 工具清单

工具名在 DSH 侧会带上服务器前缀，形如 `mcp__bua__tab_click`。

| 工具 | 作用 | 类型 |
|---|---|---|
| `browser_info` | 后端可用性、浏览器版本、**实际具备的能力** | 读 |
| `tabs_list` | 列出用户打开的所有标签 | 读 |
| `tab_open` | 新建标签（可带 URL） | 变更 |
| `tab_info` | 某标签的 URL 与标题 | 读 |
| `tab_navigate` | 导航到 URL | 变更 |
| `tab_close` | 关闭标签 | 变更 |
| `tab_dom_snapshot` | **可交互元素清单**（带编号） | 读 |
| `tab_text` | 页面可见正文（可截断） | 读 |
| `tab_screenshot` | 截图（返回 MCP image 块） | 读 |
| `tab_evaluate` | 在页面执行 JS 表达式 | 读 |
| `tab_click` | 按 CSS 选择器点击 | 变更 |
| `tab_fill` | 按选择器填值 | 变更 |
| `tab_type` | 真实键盘输入（走输入管线） | 变更 |
| `tab_click_at` | 按坐标点击（兜底） | 变更 |

## 三个设计取舍

**一、读取优先。** 14 个工具里 6 个是只读的。`tab_text` 与 `tab_dom_snapshot` 比截图省
token 且可检索，因此工具描述里明确引导模型优先用它们。

**二、变更型操作一律要求 `targetDescription`。**

```
tab_click({ tabId, selector: "#checkout",
            targetDescription: "结算按钮（￥299，含运费）" })
```

理由：**坐标无法让人判断风险，描述可以**。它进用户在扩展弹窗里看到的操作流水。
桥会在转发前校验非空，缺失直接拒绝（`BUA_MISSING_TARGET_DESCRIPTION`）。

**三、按 `tabId` 显式寻址，不隐式操作「当前标签」。** 多 agent 并发时隐式寻址会让两个会话
互相抢页面，而症状极难排查。所有需要标签的工具都强制要求 `tabId`。

## 错误处理

工具的失败会作为 tool result 回到模型上下文，所以信息必须能**指导下一步动作**。
`describeError` 按 `buaCode` 分派，每种情况写清「为什么」与「怎么办」：

| `buaCode` | 给模型的说明 |
|---|---|
| `BUA_UNSUPPORTED` | 后端不可用 → 指引去 `chrome://extensions` 确认扩展与引导页授权 |
| `BUA_DEBUGGER_UNAVAILABLE` | 区分「DevTools 占用」（可换标签）与「企业策略拒绝」（改用读取类工具） |
| `BUA_MISSING_TARGET_DESCRIPTION` | 说明为什么必须写意图描述 |
| `BUA_TAB_NOT_FOUND` | 让模型重新 `tabs_list` |
| `BUA_NAVIGATION_TIMEOUT` | 让模型先 `tab_info` 确认状态，**不要盲目重试** |

> 注意这里用的是**结构判断**而非 `instanceof`。pnpm 工作区里同一个包可能被解析出多份
> 实例，那时 `instanceof` 会静默失败 —— 错误依然是 `BuaError`，却走不进按码分派的分支。

## stdout 是协议通道

`bua-mcp` **绝不向 stdout 写任何非 MCP 数据**。一行日志就会破坏协议帧，而且症状是
「工具时有时无」这种极难排查的形态。所有诊断信息走 stderr。

`test/stdio-e2e.test.mjs` 会真的 spawn 子进程验证这一点。

## 测试

```sh
pnpm --filter @bua/mcp run test
```

21 项，分两层：

- **`mcp.test.mjs`（15 项）** —— 用 `InMemoryTransport` 在进程内跑真协议：工具目录、
  参数 schema、每个工具的调用与渲染、错误分派、审计。
- **`stdio-e2e.test.mjs`（6 项）** —— **真的 spawn `node dist/stdio.js`**，用官方 stdio
  客户端连它，走真实管道与进程边界。这层覆盖进程边界上的失败：入口路径写错、
  stdout 被污染、环境变量没传进去。

两层都配「假扩展」回应桥的请求 —— 测试不该依赖真实 Chrome。
