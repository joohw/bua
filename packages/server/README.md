# BUA 本地桥（`@bua/server`）

**职责只有四件事** —— 桥是**路由器 + 审计点**，不是策略点。

1. 协议版本校验
2. `Host` / `Origin` 校验（挡恶意网页，**不限制 agent**）
3. `targetDescription` 校验（`write` / `destructive` 方法必带）
4. 审计记录 + 方法路由

**不做**：鉴权、域名过滤、动作审批。这些由产品决策移除 —— 见 [设计文档 §4.0](../../docs/design.md)。

完整协议见 [docs/routing.md](../../docs/routing.md)。本文件只讲这一层的实现。

---

## 快速运行

```sh
pnpm --filter @bua/server run build
node packages/server/dist/cli.js          # 用默认端口 17432（与扩展硬编码的一致）
node packages/server/dist/cli.js --port 18000
```

启动后打印一行，形如：

```
bua: 桥已就绪  ws://127.0.0.1:17432
bua: 等待扩展连接…（无鉴权，本机任意进程均可连）
```

### 端口是固定的

默认端口 **17432** 与扩展里硬编码的 `BRIDGE_PORT` 对齐 —— 直接敲 `bua-server` 就能连上，不需要两边对端口。

**为什么固定**：端口可配引入了一个纯粹自找的失败模式 —— 用户在扩展里填一个端口、桥起在另一个端口，两边都「看起来正常」但连不上，而错误信息只有一句「请确认 bua-server 已启动」，完全指不到真正原因。

**若 17432 被占用**：桥会明确报端口冲突并给出排查命令（`netstat -ano | findstr :17432`）。换端口启动后**必须重新加载扩展**（`chrome://extensions` → 刷新图标）：

## 角色模型

桥是唯一的 WebSocket **服务端**。agent SDK 与扩展都是**客户端**，都在 `bua.hello` 里用
`role: "agent" | "extension"` 声明身份。

```
Agent SDK ──┐                        ┌── BUA 扩展
            ├──▶ 桥 (127.0.0.1:PORT) ─┤
   其他 agent ─┘                        └── (v0 只允许一个)
```

**为什么让桥做服务端**：MV3 service worker 会被 Chrome 随时回收重启，让扩展做服务端
会引入「谁是服务端」的复杂度；桥是长驻进程，做服务端天然稳定。

**v0 单后端**：同一时刻只接受**一个** `role=extension` 连接，第二个被拒（关闭码 `4004`）。
多扩展（多浏览器 profile）需要 `browserId` 路由，留到 M3。

## 传输层防线

两道校验，**都只针对「网页发起」这一威胁**，不限制任何本地 agent：

| 校验 | 规则 | 拦什么 |
|---|---|---|
| **`Origin`** | 允许缺失（SDK/CLI）或 `chrome-extension://`；**拒绝一切 `http(s)://`** | 恶意网页直连 / DNS rebinding |
| **`Host`** | 只接受 `127.0.0.1` / `localhost` / `::1`，端口需一致 | DNS rebinding 经典场景 |

`Origin` 比 `Host` 更硬 —— 浏览器**总是**带 `Origin`，而 `Host` 只反映连接目标。

`Origin` 校验**先于** `Host`，所以恶意网页即使伪造 `Host` 也拦得住（有回归用例覆盖）。

## 审计

桥不做鉴权，**审计是用户唯一的追溯手段**，因此每次调用都记录：

```ts
{ ts, sessionId, method, risk, targetDescription?, ok, errorCode? }
```

被拒绝的调用也进审计（便于发现 agent 在反复尝试危险动作）。

## 测试

```sh
pnpm --filter @bua/server test
```

62 项测试，全部为**行为契约测试**（真实 HTTP 升级 + 真实 WebSocket 帧）：

- `host-check.test.mjs` —— 18 项，含 4 类绕过尝试
- `bridge.test.mjs` —— 26 项端到端，用「假扩展 + 假 agent」验证完整链路

测试脚本刻意带 `--test-concurrency=1 --test-timeout=20000` —— 这些测试各自起真实
监听端口，并发跑会互相干扰，且需要超时兜底（早期版本曾因一个响应 id 的 bug 挂死）。
