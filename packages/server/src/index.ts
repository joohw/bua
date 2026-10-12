/**
 * `@bua/server` —— BUA 本地桥。
 *
 * 职责**只有四件事**（见 `docs/routing.md` §2）：
 *
 * 1. 协议版本校验
 * 2. `Host` / `Origin` 校验（挡恶意网页，**不限制 agent**）
 * 3. `targetDescription` 校验（`write` / `destructive` 方法必带）
 * 4. 审计记录 + 方法路由
 *
 * **不做**：鉴权、域名过滤、动作审批。这些由产品决策移除，见 `docs/design.md` §4.0。
 * 桥的定位是**路由器 + 审计点**，不是策略点。
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  BUA_ERROR_CODES,
  M,
  PROTOCOL_VERSION,
  RPC_ERROR_CODES,
  WS_CLOSE_CODES,
  classifyRisk,
  normalizeRpcId,
  requiresTargetDescription,
  type BuaErrorCode,
  type Capabilities,
  type RpcError,
  type RpcNotification,
  type RpcSuccess,
} from '@bua/protocol';
import { WebSocketServer, type WebSocket } from 'ws';

import { checkUpgradeRequest } from './host-check.js';
import { SessionStore } from './store.js';
import {
  NO_BACKEND_CAPABILITIES,
  type AgentHello,
  type AgentHelloResult,
  type AgentSession,
  type ExtensionHello,
  type ExtensionHelloResult,
  type ExtensionSession,
  type HelloParams,
} from './types.js';

/**
 * 转发请求 id 的前缀。
 *
 * 桥把 agent 的请求转发给扩展时会换一个新 id（`fwd_…`），以便：
 * - 同时服务多个 agent 时不串台
 * - 扩展的响应能被识别成「响应」而非「缺少 method 的非法请求」
 */
const FORWARD_ID_PREFIX = 'fwd_';

export interface BridgeOptions {
  /** 监听端口。默认 `0` —— 由系统分配空闲端口，避免与用户已有服务冲突。 */
  port?: number;
  /** 心跳间隔（ms）。 */
  heartbeatMs?: number;
  /** 审计回调。桥不做鉴权，审计是用户唯一的追溯手段。 */
  onAudit?: (entry: AuditRecord) => void;
  /** 诊断日志回调。 */
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface AuditRecord {
  ts: number;
  sessionId: string;
  method: string;
  risk: 'read' | 'write' | 'destructive';
  targetDescription?: string;
  ok: boolean;
  errorCode?: string;
}

export interface BridgeAddress {
  host: '127.0.0.1';
  port: number;
  /** 可直接交给客户端的 URL。 */
  url: string;
}

interface PendingForward {
  agentWs: WebSocket;
  agentId: number | string | null;
  sessionId: string;
  method: string;
  risk: 'read' | 'write' | 'destructive';
  params: unknown;
}

/**
 * 桥的运行时。
 *
 * 刻意**只绑 `127.0.0.1`**，且不提供改绑选项 —— 这是本设计中唯一真正的安全边界
 * （挡住远程访问）。见 `docs/design.md` §4.1 L1。
 */
export class Bridge {
  readonly #store = new SessionStore();
  readonly #sockets = new Map<string, WebSocket>();
  readonly #pendingForwards = new Map<string, PendingForward>();
  readonly #port: number;
  readonly #heartbeatMs: number;
  readonly #options: BridgeOptions;
  #http: Server | null = null;
  #wss: WebSocketServer | null = null;
  #address: BridgeAddress | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #forwardSeq = 0;

  constructor(options: BridgeOptions = {}) {
    this.#options = options;
    this.#port = options.port ?? 0;
    this.#heartbeatMs = options.heartbeatMs ?? 15_000;
  }

  get address(): BridgeAddress | null {
    return this.#address;
  }

  /** 当前是否有扩展作为后端连上。 */
  get hasBackend(): boolean {
    return this.#store.getExtension() !== null;
  }

  /** 启动监听。解析后返回实际地址（`port: 0` 时是系统分配的值）。 */
  async start(): Promise<BridgeAddress> {
    if (this.#http !== null) throw new Error('桥已在运行');

    const http = createServer((_req, res) => {
      // 只服务 WebSocket 升级；普通 HTTP 请求给一句说明，避免被误当 REST 面探测
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('BUA 桥只接受 WebSocket 升级请求。\n');
    });
    this.#http = http;

    const wss = new WebSocketServer({ noServer: true });
    this.#wss = wss;

    http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const port = this.#address?.port ?? this.#port;
      const check = checkUpgradeRequest(req, port);
      if (!check.ok) {
        const body = check.detail;
        socket.write(
          'HTTP/1.1 403 Forbidden\r\n' +
            'Connection: close\r\n' +
            'Content-Type: text/plain; charset=utf-8\r\n' +
            `Content-Length: ${Buffer.byteLength(body)}\r\n` +
            '\r\n' +
            body,
        );
        socket.destroy();
        this.#log('warn', `拒绝升级：${check.reason} —— ${check.detail}`);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.#onConnection(ws);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      http.once('error', onError);
      http.listen(this.#port, '127.0.0.1', () => {
        http.off('error', onError);
        resolve();
      });
    });

    const addr = http.address();
    if (addr === null || typeof addr === 'string') throw new Error('无法确定监听地址');
    this.#address = {
      host: '127.0.0.1',
      port: addr.port,
      url: `ws://127.0.0.1:${addr.port}`,
    };

    this.#heartbeatTimer = setInterval(() => this.#sweepStaleSessions(), this.#heartbeatMs);
    // 不要因为这个定时器让进程无法退出
    this.#heartbeatTimer.unref();

    this.#log('info', `桥已就绪 ${this.#address.url}`);
    return this.#address;
  }

  /** 停止监听并断开所有会话。 */
  async stop(): Promise<void> {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    /*
     * 先 `terminate()` 再关服务器。
     *
     * 用 terminate（立即销毁底层 socket）而不是 close（走优雅挥手），原因有二：
     *
     * 1. **保证进程能退出** —— 优雅关闭依赖客户端回 FIN；在测试等场景里对端可能
     *    已经不正常，握手会一直挂着，导致 `wss.close()` 的回调永不触发。
     * 2. **语义正确** —— 服务器关停时它就是要把所有连接断掉，没有「等对方先说完」
     *    的义务。桥本身不做鉴权，也不需要靠优雅关闭保护什么。
     */
    for (const ws of this.#sockets.values()) {
      try {
        ws.terminate();
      } catch {
        /* 已经断开 */
      }
    }
    this.#sockets.clear();
    this.#pendingForwards.clear();

    const wss = this.#wss;
    const http = this.#http;
    this.#wss = null;
    this.#http = null;
    this.#address = null;

    await new Promise<void>((resolve) => {
      if (wss !== null) wss.close(() => resolve());
      else resolve();
    });
    await new Promise<void>((resolve) => {
      if (http !== null) http.close(() => resolve());
      else resolve();
    });
  }

  /* ─────────────────────── 连接处理 ─────────────────────── */

  #onConnection(ws: WebSocket): void {
    let sessionId: string | null = null;

    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        this.#sendError(ws, null, RPC_ERROR_CODES.PARSE_ERROR, 'JSON 解析失败');
        return;
      }
      this.#dispatch(ws, parsed, sessionId, (id) => {
        sessionId = id;
      });
    });

    ws.on('close', () => {
      if (sessionId === null) return;
      const removed = this.#store.remove(sessionId);
      this.#sockets.delete(sessionId);
      // 该会话的未完成转发一并清理，避免悬挂
      for (const [fwdId, pending] of [...this.#pendingForwards]) {
        if (pending.sessionId === sessionId) this.#pendingForwards.delete(fwdId);
      }
      if (removed?.role === 'extension') {
        this.#log('warn', '扩展已断开 —— 后端不再可用');
        this.#broadcastToAgents({
          jsonrpc: '2.0',
          method: 'bua.event',
          params: { type: 'backend.gone', reason: 'extension disconnected' },
        });
      }
    });

    ws.on('error', (err) => {
      this.#log('warn', `WebSocket 错误：${err.message}`);
    });
  }

  #dispatch(
    ws: WebSocket,
    raw: unknown,
    boundSessionId: string | null,
    setSessionId: (id: string) => void,
  ): void {
    if (typeof raw !== 'object' || raw === null) {
      this.#sendError(ws, null, RPC_ERROR_CODES.INVALID_REQUEST, '不是 JSON 对象');
      return;
    }
    const msg = raw as Record<string, unknown>;
    const method = msg['method'];
    const rpcId = normalizeRpcId(msg['id']);

    /* ── 扩展回来的**响应**（不是请求）── */
    // 转发的请求带 `fwd_` 前缀的 id，扩展的响应带同一个 id 回来。
    // 必须在这里拦截，否则会被误判为「缺少 method 的非法请求」。
    if (typeof method !== 'string') {
      if (typeof rpcId === 'string' && rpcId.startsWith(FORWARD_ID_PREFIX)) {
        this.#settleForward(ws, rpcId, msg);
        return;
      }
      this.#sendError(ws, rpcId, RPC_ERROR_CODES.INVALID_REQUEST, '缺少 method');
      return;
    }

    /* ── 握手 ── */
    if (method === M.hello) {
      if (boundSessionId !== null) {
        this.#sendError(ws, rpcId, RPC_ERROR_CODES.INVALID_REQUEST, '重复握手');
        return;
      }
      const handled = this.#handleHello(ws, rpcId, msg['params']);
      if (handled === null) return; // 已发送错误或关闭连接
      setSessionId(handled.sessionId);
      this.#sockets.set(handled.sessionId, ws);
      this.#send(ws, {
        jsonrpc: '2.0',
        id: rpcId ?? 0,
        result: handled.response,
      });
      return;
    }

    /* ── 未握手 ── */
    if (boundSessionId === null) {
      this.#sendError(ws, rpcId, RPC_ERROR_CODES.INVALID_REQUEST, '必须先发送 bua.hello');
      return;
    }
    const session = this.#store.get(boundSessionId);
    if (session === undefined) {
      this.#sendError(ws, rpcId, RPC_ERROR_CODES.INTERNAL_ERROR, '会话不存在');
      return;
    }
    this.#store.touch(boundSessionId);

    /* ── 心跳 ── */
    if (method === M.heartbeat) {
      if (rpcId !== null) this.#send(ws, { jsonrpc: '2.0', id: rpcId, result: { ok: true } });
      return;
    }

    /* ── 扩展主动上报事件 ── */
    if (method === 'bua.event') {
      this.#handleExtensionEvent(session.role, msg['params']);
      return;
    }

    /* ── 桥自己处理的方法（不转发）── */
    if (method === M.blobGet) {
      this.#sendError(
        ws,
        rpcId,
        RPC_ERROR_CODES.BUA_ERROR,
        'blob 存储尚未实现',
        BUA_ERROR_CODES.UNSUPPORTED,
      );
      return;
    }

    /* ── 其余方法：agent → 扩展 ── */
    if (session.role !== 'agent') {
      this.#sendError(ws, rpcId, RPC_ERROR_CODES.INVALID_REQUEST, '只有 agent 会话可以发起方法调用');
      return;
    }
    this.#routeToExtension(ws, rpcId, boundSessionId, method, msg['params']);
  }

  #handleHello(
    ws: WebSocket,
    rpcId: number | string | null,
    params: unknown,
  ): { sessionId: string; response: AgentHelloResult | ExtensionHelloResult } | null {
    if (typeof params !== 'object' || params === null) {
      this.#sendError(ws, rpcId, RPC_ERROR_CODES.INVALID_PARAMS, 'hello 缺少 params');
      return null;
    }
    const p = params as Partial<HelloParams>;
    if (p.protocolVersion !== PROTOCOL_VERSION) {
      this.#log('warn', `协议版本不匹配：客户端 ${String(p.protocolVersion)} / 桥 ${PROTOCOL_VERSION}`);
      ws.close(WS_CLOSE_CODES.PROTOCOL_VERSION, 'protocol version mismatch');
      return null;
    }

    if (p.role === 'extension') {
      const ext = p as ExtensionHello;
      const sessionId = this.#store.nextSessionId('extension');
      const session: ExtensionSession = {
        sessionId,
        role: 'extension',
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        client: ext.client,
        capabilities: NO_BACKEND_CAPABILITIES,
        declaredCapabilities: ext.capabilities ?? [],
      };
      if (!this.#store.addExtension(session)) {
        this.#log('warn', '拒绝第二个扩展连接（v0 单后端）');
        ws.close(WS_CLOSE_CODES.BAD_HOST, 'another extension is already connected');
        return null;
      }
      this.#log('info', `扩展已连接：${ext.client.extensionId} v${ext.client.extensionVersion}`);
      this.#broadcastToAgents({
        jsonrpc: '2.0',
        method: 'bua.event',
        params: {
          type: 'backend.ready',
          chromeVersion: ext.client.chromeVersion ?? null,
          capabilities: NO_BACKEND_CAPABILITIES,
        },
      });
      const response: ExtensionHelloResult = {
        sessionId,
        heartbeatMs: this.#heartbeatMs,
      };
      return { sessionId, response };
    }

    if (p.role === 'agent') {
      const a = p as AgentHello;
      const sessionId = this.#store.nextSessionId('agent');
      const session: AgentSession = {
        sessionId,
        role: 'agent',
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        client: a.client,
      };
      this.#store.addAgent(session);
      const ext = this.#store.getExtension();
      this.#log(
        'info',
        `agent 已连接：${a.client.name}${a.client.version !== undefined ? ` v${a.client.version}` : ''}`,
      );
      const response: AgentHelloResult = {
        sessionId,
        heartbeatMs: this.#heartbeatMs,
        backend: {
          connected: ext !== null,
          ...(ext?.client.chromeVersion !== undefined
            ? { chromeVersion: ext.client.chromeVersion }
            : {}),
        },
        capabilities: ext?.capabilities ?? NO_BACKEND_CAPABILITIES,
      };
      return { sessionId, response };
    }

    this.#sendError(ws, rpcId, RPC_ERROR_CODES.INVALID_PARAMS, `未知 role：${String(p.role)}`);
    return null;
  }

  /**
   * 把 agent 的方法调用转发给扩展。
   *
   * 这里做 `targetDescription` 校验 —— 它是**协议契约**而非安全策略，
   * 放在桥可以让 agent 立刻收到明确错误，而不是等扩展超时。见 `docs/routing.md` §2.1。
   */
  #routeToExtension(
    agentWs: WebSocket,
    rpcId: number | string | null,
    sessionId: string,
    method: string,
    params: unknown,
  ): void {
    const risk = classifyRisk(method);
    const targetDescription = this.#readTargetDescription(params);

    if (requiresTargetDescription(risk) && targetDescription === undefined) {
      this.#audit({
        ts: Date.now(),
        sessionId,
        method,
        risk,
        ok: false,
        errorCode: BUA_ERROR_CODES.MISSING_TARGET_DESCRIPTION,
      });
      this.#sendError(
        agentWs,
        rpcId,
        RPC_ERROR_CODES.BUA_ERROR,
        `方法 ${method}（risk=${risk}）必须携带人类可读的 targetDescription —— 坐标无法让人判断风险，描述可以。`,
        BUA_ERROR_CODES.MISSING_TARGET_DESCRIPTION,
      );
      return;
    }

    const ext = this.#store.getExtension();
    const extWs = ext !== null ? this.#sockets.get(ext.sessionId) : undefined;
    if (ext === null || extWs === undefined) {
      this.#audit({
        ts: Date.now(),
        sessionId,
        method,
        risk,
        ok: false,
        errorCode: BUA_ERROR_CODES.UNSUPPORTED,
      });
      this.#sendError(
        agentWs,
        rpcId,
        RPC_ERROR_CODES.BUA_ERROR,
        '没有扩展连接到桥 —— 无法执行。请确认 BUA 扩展已安装并启用。',
        BUA_ERROR_CODES.UNSUPPORTED,
      );
      return;
    }

    this.#forwardSeq += 1;
    const forwardId = `${FORWARD_ID_PREFIX}${this.#forwardSeq.toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    this.#pendingForwards.set(forwardId, {
      agentWs,
      agentId: rpcId,
      sessionId,
      method,
      risk,
      params,
    });

    this.#send(extWs, {
      jsonrpc: '2.0',
      id: forwardId,
      method,
      params: {
        ...(typeof params === 'object' && params !== null ? params : {}),
        /** 桥注入：扩展据此知道是哪个 agent 会话发起的（审计与标签归属）。 */
        __buaSessionId: sessionId,
      },
    });
  }

  /**
   * 扩展的响应回到桥 —— 转给对应的 agent，并记审计。
   *
   * 找不到对应的 pending 转发说明扩展回了一个未知 id（协议错误或重放），
   * 记日志后丢弃，不向扩展回错（避免错误风暴）。
   */
  #settleForward(_extWs: WebSocket, forwardId: string, msg: Record<string, unknown>): void {
    const pending = this.#pendingForwards.get(forwardId);
    if (pending === undefined) {
      this.#log('warn', `收到未知的转发响应 id：${forwardId}`);
      return;
    }
    this.#pendingForwards.delete(forwardId);

    const ok = 'result' in msg;
    const errorCode = ok
      ? undefined
      : ((msg['error'] as { data?: { buaCode?: string } } | undefined)?.data?.buaCode ??
        BUA_ERROR_CODES.INTERNAL);
    const targetDescription = this.#readTargetDescription(pending.params);

    this.#audit({
      ts: Date.now(),
      sessionId: pending.sessionId,
      method: pending.method,
      risk: pending.risk,
      ok,
      ...(errorCode !== undefined ? { errorCode } : {}),
      ...(targetDescription !== undefined ? { targetDescription } : {}),
    });

    // JSON-RPC 规定：错误响应的 id 可以是 null，但**成功响应不行**。
    // 转发时 id 理论上不会是 null（已经过 normalizeRpcId），用 0 兜底。
    const responseId = pending.agentId ?? 0;
    this.#send(
      pending.agentWs,
      ok
        ? { jsonrpc: '2.0', id: responseId, result: msg['result'] }
        : { jsonrpc: '2.0', id: pending.agentId, error: msg['error'] as RpcError['error'] },
    );
  }

  /** 从参数里取 `targetDescription`；空串或非字符串一律视为缺失。 */
  #readTargetDescription(params: unknown): string | undefined {
    if (typeof params !== 'object' || params === null) return undefined;
    const value = (params as Record<string, unknown>)['targetDescription'];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * 扩展主动上报的事件（`bua.event`）。
   *
   * `backend.ready` 特殊处理：它是扩展声明能力的唯一入口，桥要把能力存下来
   * 并**重新构造**广播给 agent（直接转发原始 params 会让 agent 收到的能力结构
   * 与 hello 响应不一致）。
   */
  #handleExtensionEvent(role: string, params: unknown): void {
    if (role !== 'extension') return;
    if (typeof params !== 'object' || params === null) return;
    const p = params as Record<string, unknown>;

    if (
      p['type'] === 'backend.ready' &&
      typeof p['capabilities'] === 'object' &&
      p['capabilities'] !== null
    ) {
      const caps = p['capabilities'] as Capabilities;
      this.#store.setExtensionCapabilities(caps);
      this.#broadcastToAgents({
        jsonrpc: '2.0',
        method: 'bua.event',
        params: {
          type: 'backend.ready',
          capabilities: caps,
          chromeVersion: p['chromeVersion'] ?? null,
        },
      });
      this.#log('info', '扩展上报能力，已向所有 agent 广播');
      return;
    }

    // 其余事件原样转发给所有 agent
    this.#broadcastToAgents({ jsonrpc: '2.0', method: 'bua.event', params });
  }

  #broadcastToAgents(msg: RpcNotification): void {
    for (const agent of this.#store.allAgents()) {
      const ws = this.#sockets.get(agent.sessionId);
      if (ws !== undefined) this.#send(ws, msg);
    }
  }

  #sweepStaleSessions(): void {
    const now = Date.now();
    const limit = this.#heartbeatMs * 2;
    for (const session of this.#store.allAgents()) {
      if (now - session.lastSeenAt > limit) {
        this.#log('warn', `agent 会话心跳超时：${session.sessionId}`);
        this.#sockets.get(session.sessionId)?.close(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
      }
    }
  }

  #send(ws: WebSocket, msg: RpcSuccess | RpcError | RpcNotification): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  #sendError(
    ws: WebSocket,
    id: number | string | null,
    code: number,
    message: string,
    buaCode?: BuaErrorCode,
  ): void {
    this.#send(ws, {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(buaCode !== undefined ? { data: { buaCode } } : {}) },
    });
  }

  #audit(entry: AuditRecord): void {
    this.#options.onAudit?.(entry);
  }

  #log(level: 'info' | 'warn' | 'error', message: string): void {
    this.#options.onLog?.(level, message);
  }
}

export { SessionStore } from './store.js';
export * from './types.js';
