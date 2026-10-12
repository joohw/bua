# BUA 桥的路由与角色

**版本**：v0 · 实现依据

本文档定义 `bua-server`（桥）**同时**服务两类连接时的路由规则。这是 `docs/protocol.md` 的补充 —— 那份定义「方法契约」，这份定义「谁连谁、消息怎么走」。

---

## 1. 三个角色

```
┌──────────────┐                          ┌──────────────┐                     ┌──────────────┐
│  Agent SDK   │  ws://127.0.0.1:PORT    │  bua-server  │  ws://127.0.0.1:PORT │  BUA 扩展     │
│  (任意 agent) │ ──────────────────────▶ │   (桥)       │ ◀────────────────── │  (MV3)       │
└──────────────┘   role=agent            └──────────────┘   role=extension    └──────────────┘
```

**桥**是唯一的 WebSocket **服务端**。SDK 与扩展都是**客户端**，都主动连桥。

这样设计的原因：扩展侧（MV3 service worker）会被 Chrome 随时回收又重启，让扩展做服务端会引入「谁是服务端」的复杂度；而桥是长驻进程，做服务端天然稳定。

### 1.1 角色声明

都在 `bua.hello` 里声明，用 `role` 字段区分：

```jsonc
// Agent SDK → 桥
{ "jsonrpc": "2.0", "id": 0, "method": "bua.hello",
  "params": { "protocolVersion": "v0", "role": "agent",
              "client": { "name": "dsh", "version": "1.0.0" } } }

// 扩展 → 桥
{ "jsonrpc": "2.0", "id": 0, "method": "bua.hello",
  "params": { "protocolVersion": "v0", "role": "extension",
              "client": { "extensionId": "…", "extensionVersion": "0.1.0",
                          "chromeVersion": "154.0.8037.99" },
              "capabilities": ["cdp", "management", "bua.audit"] } }
```

桥的响应也按角色不同：

```jsonc
// → agent：告诉它后端是否就绪、具备什么能力
{ "result": { "sessionId": "s_…", "heartbeatMs": 15000,
              "backend": { "connected": true, "chromeVersion": "154.0.8037.99" },
              "capabilities": { "cdp": true, "screenshots": true, "fileUploads": false,
                                "downloads": true, "evaluate": true, "management": true } } }

// → extension：告诉它自己是唯一后端（目前单后端）
{ "result": { "sessionId": "s_…", "heartbeatMs": 15000 } }
```

> **单后端约束（v0）**：桥同一时刻只接受**一个** `role=extension` 连接。第二个扩展连接会被拒绝（`BUA_TAB_CLAIMED` 语义上的同类：`409`）。
> 这一简化是刻意的 —— 多扩展（多浏览器 profile）留到 M3，届时需要 `browserId` 路由。

---

## 2. 方法路由

**Agent 发出的所有方法调用，桥一律转发给扩展**，并把扩展的响应原样回给 agent。

```
Agent                     桥                      扩展
  │                       │                       │
  ├─ tabs.list ──────────▶│                       │
  │                       ├─ tabs.list ──────────▶│
  │                       │◀───────── result ─────┤
  │◀──────── result ──────┤                       │
```

桥做四件事，**不做业务逻辑**：

1. **协议版本校验** —— 不匹配直接断开（`WS_CLOSE_CODES.PROTOCOL_VERSION`）
2. **`Host` 头校验** —— 只接受 `127.0.0.1:<port>` / `localhost:<port>`，否则 `WS_CLOSE_CODES.BAD_HOST`
3. **`targetDescription` 校验** —— 对 `write` / `destructive` 方法，缺失即拒绝（`BUA_MISSING_TARGET_DESCRIPTION`），**不发往扩展**
4. **审计记录** —— 按 `risk.ts` 分级记录 `{ts, sessionId, method, risk, targetDescription, result}`

> **桥不做**：鉴权、域名过滤、动作审批。这些已由产品决策移除（见 `design.md` §4.0）。
> 桥的定位是**路由器 + 审计点**，不是策略点。

### 2.1 为什么 `targetDescription` 校验放在桥

因为它是**协议契约**，不是安全策略。放在桥有三点好处：

- agent 忘记带时**立刻**收到明确错误，而不是等扩展超时
- 校验逻辑只写一遍（`protocol` 包的 `classifyRisk`）
- 扩展侧可以信任「到达的消息已带描述」，简化其实现

即使执行层（扩展）也要校验一次（纵深防御），桥这一层仍减少无谓往返。

---

## 3. 事件推送（扩展 → 桥 → agent）

扩展可以主动发**通知**（无 `id`），桥转发给**所有** agent 会话：

```jsonc
// 扩展 → 桥（通知）
{ "jsonrpc": "2.0", "method": "bua.event",
  "params": { "type": "tab.updated", "tabId": "t_1",
              "url": "https://example.com/", "title": "Example" } }
```

已知事件类型：

| type | 载荷 | 用途 |
|---|---|---|
| `backend.ready` | `{ chromeVersion, capabilities }` | 扩展连上或重连 |
| `backend.gone` | `{ reason }` | 扩展断开（用户关浏览器 / 扩展被禁用） |
| `tab.updated` | `{ tabId, url?, title? }` | 标签导航或标题变化 |
| `tab.claimed` | `{ tabId, sessionId }` | 标签被接管 |
| `tab.released` | `{ tabId }` | 标签被释放 |
| `debugger.detached` | `{ tabId, reason }` | ⚠️ **用户关闭了调试横幅** —— 会话终止 |
| `audit.appended` | `{ entry }` | 有新审计条目 |

> `debugger.detached` 值得特别注意：Chrome 的调试横幅**用户一关就终止 attach**（官方明文）。agent 必须能感知这件事，否则会对着一个已死的会话继续发指令。

---

## 4. 会话隔离

| 项 | 规则 |
|---|---|
| **一个标签同一时刻属于一个 agent 会话** | `user.claimTab` / `tabs.new` 建立所有权 |
| **跨会话操作他人标签** | 拒绝（`BUA_TAB_CLAIMED`） |
| **会话结束** | 释放其全部标签所有权；agent 断开 / 心跳超时触发 |
| **扩展重连** | 保留标签所有权（会话 id 由桥复用），但 `debugger` 需重新 attach |
| **审计带 `sessionId`** | 无鉴权之下，这是用户唯一能分辨「谁干的」的手段 |

---

## 5. 消息尺寸

大对象（截图、DOM 快照、无障碍树）**不内联**。扩展先落盘，返回 `BlobRef`，agent 按需 `blob.get`。

理由：截图动辄数百 KB 到数 MB，内联会撞 WebSocket 帧上限并浪费内存。

```
扩展 → 桥：  { "ref": "blob_9c2e…", "mime": "image/png", "bytes": 184320,
               "width": 1264, "height": 805 }
agent → 桥： { "method": "blob.get", "params": { "ref": "blob_9c2e…", "asFile": true } }
桥 → agent： { "path": "~/.bua/blobs/9c2e.png" }
```

`blob.get` 由**桥**处理（它持有落盘目录），不转发给扩展。

---

## 6. 待定

| # | 问题 | 影响 |
|---|---|---|
| 1 | 默认端口（需避开 19387 / 3080 / 9222 等已占用） | 安装体验 |
| 2 | blob 落盘目录（`~/.bua/blobs`？系统临时目录？）与清理策略 | 磁盘 |
| 3 | agent 会话是否有 TTL（长时间空闲的会话是否自动释放标签） | 标签泄漏 |
| 4 | 扩展重连时是否自动重新 attach 已接管的标签 | 恢复体验 |
| 5 | 多扩展（多 profile）支持时 `browserId` 如何路由 | M3 设计 |
| 6 | 事件是否需要按会话过滤（当前设计是所有 agent 都收到） | 隐私与噪声 |
