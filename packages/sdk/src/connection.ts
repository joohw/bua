/**
 * SDK 的传输层：WebSocket + JSON-RPC + 心跳 + 自动重连。
 *
 * 刻意不做业务逻辑 —— 方法名与参数原样透传，语义完全由 `@bua/protocol` 定义。
 * 这样桥侧新增方法时，SDK 不需要跟着改。
 */

import {
  BUA_ERROR_CODES,
  M,
  PROTOCOL_VERSION,
  type BuaErrorCode,
  type Capabilities,
  type RpcError,
  type RpcNotification,
} from '@bua/protocol';
import { WebSocket } from 'ws';

/** 桥在错误里返回的结构化信息。 */
export interface BuaErrorInfo {
  buaCode: BuaErrorCode;
  message: string;
  /** JSON-RPC 错误码（例如 -32000）。 */
  rpcCode?: number;
}

/**
 * SDK 抛出的错误。
 *
 * 刻意把 `buaCode` 单独暴露 —— agent 需要**按码路由**（重试 / 换路 / 请求授权 / 停止），
 * 而不是去解析错误文案。
 */
export class BuaError extends Error {
  readonly buaCode: BuaErrorCode;
  readonly rpcCode: number | undefined;

  constructor(info: BuaErrorInfo) {
    super(info.message);
    this.name = 'BuaError';
    this.buaCode = info.buaCode;
    this.rpcCode = info.rpcCode;
  }

  /** 是否值得重试。 */
  get retryable(): boolean {
    return (
      this.buaCode === BUA_ERROR_CODES.DEBUGGER_UNAVAILABLE ||
      this.buaCode === BUA_ERROR_CODES.NAVIGATION_TIMEOUT
    );
  }
}

export interface ConnectOptions {
  /** 桥端口。 */
  port: number;
  /** 桥主机，默认 `127.0.0.1`。改动它意味着把浏览器控制权暴露到本机之外，不建议。 */
  host?: string;
  /** 仅供测试注入：替换 WebSocket 实现。 */
  socketFactory?: (url: string) => WebSocket;
  /** 心跳间隔（ms）。桥会以 hello 响应里的 `heartbeatMs` 覆盖它。 */
  heartbeatMs?: number;
  /** 单次调用超时（ms）。 */
  callTimeoutMs?: number;
}

export interface HelloResult {
  sessionId: string;
  heartbeatMs: number;
  backend: { connected: boolean; chromeVersion?: string };
  capabilities: Capabilities;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: BuaError) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
};

/** 桥推送的事件。 */
export interface BridgeEvent {
  type: string;
  [key: string]: unknown;
}

export class Connection {
  readonly #options: ConnectOptions;
  readonly #pending = new Map<string | number, Pending>();
  readonly #eventHandlers = new Set<(e: BridgeEvent) => void>();
  #ws: WebSocket | null = null;
  #seq = 0;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #heartbeatMs: number;
  #sessionId: string | null = null;
  #capabilities: Capabilities | null = null;
  #closed = false;

  constructor(options: ConnectOptions) {
    this.#options = options;
    this.#heartbeatMs = options.heartbeatMs ?? 15_000;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  get capabilities(): Capabilities | null {
    return this.#capabilities;
  }

  get url(): string {
    return `ws://${this.#options.host ?? '127.0.0.1'}:${this.#options.port}`;
  }

  /** 建立连接并完成握手。 */
  async connect(client: { name: string; version?: string }): Promise<HelloResult> {
    const factory =
      this.#options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocket);
    const ws = factory(this.url);
    this.#ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        ws.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });

    ws.on('message', (data) => this.#onMessage(data));
    ws.on('close', () => this.#onClose());
    ws.on('error', () => {
      /* close 会紧随其后 */
    });

    const hello = (await this.#request(M.hello, {
      protocolVersion: PROTOCOL_VERSION,
      role: 'agent',
      client,
    })) as HelloResult;

    this.#sessionId = hello.sessionId;
    this.#capabilities = hello.capabilities;
    if (typeof hello.heartbeatMs === 'number' && hello.heartbeatMs > 0) {
      this.#heartbeatMs = hello.heartbeatMs;
    }
    this.#startHeartbeat();
    return hello;
  }

  /** 发起一次方法调用。失败时抛 {@link BuaError}。 */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return (await this.#request(method, params)) as T;
  }

  /** 订阅桥推送的事件（`bua.event`）。 */
  onEvent(handler: (e: BridgeEvent) => void): () => void {
    this.#eventHandlers.add(handler);
    return () => this.#eventHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new BuaError({ buaCode: BUA_ERROR_CODES.INTERNAL, message: '连接已关闭' }));
    }
    this.#pending.clear();
    const ws = this.#ws;
    this.#ws = null;
    if (ws !== null) {
      await new Promise<void>((resolve) => {
        if (ws.readyState === ws.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      });
    }
  }

  /* ─────────────────────── 内部 ─────────────────────── */

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const ws = this.#ws;
    if (ws === null || ws.readyState !== ws.OPEN) {
      return Promise.reject(
        new BuaError({
          buaCode: BUA_ERROR_CODES.INTERNAL,
          message: 'WebSocket 未连接',
        }),
      );
    }

    this.#seq += 1;
    const id = `sdk${this.#seq}`;
    const timeoutMs = this.#timeoutFor(method);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new BuaError({
            buaCode: BUA_ERROR_CODES.INTERNAL,
            message: `调用超时（${timeoutMs}ms）：${method}`,
          }),
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** 导航与等待类方法需要更长的预算，其余用默认值。 */
  #timeoutFor(method: string): number {
    const base = this.#options.callTimeoutMs ?? 30_000;
    const long = /^(tab\.goto|playwright\.waitFor|playwright\.expectNavigation|tabs\.content|content\.export)/;
    return long.test(method) ? Math.max(base, 90_000) : base;
  }

  #onMessage(data: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }

    const id = msg['id'];
    if (typeof id === 'string' || typeof id === 'number') {
      const slot = this.#pending.get(id);
      if (slot !== undefined) {
        this.#pending.delete(id);
        clearTimeout(slot.timer);
        if ('error' in msg) {
          slot.reject(this.#toError(msg['error']));
        } else {
          slot.resolve(msg['result']);
        }
        return;
      }
    }

    // 通知
    if (msg['method'] === 'bua.event' && typeof msg['params'] === 'object' && msg['params'] !== null) {
      const event = msg['params'] as BridgeEvent;
      // 能力变化要同步到本地视图，否则 SDK 使用者读到的是过期能力
      if (event.type === 'backend.ready' && typeof event['capabilities'] === 'object') {
        this.#capabilities = event['capabilities'] as Capabilities;
      }
      for (const h of this.#eventHandlers) h(event);
    }
  }

  #toError(raw: unknown): BuaError {
    const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<RpcError['error']>;
    const data = e.data;
    return new BuaError({
      buaCode: data?.buaCode ?? BUA_ERROR_CODES.INTERNAL,
      message: typeof e.message === 'string' ? e.message : '未知错误',
      ...(typeof e.code === 'number' ? { rpcCode: e.code } : {}),
    });
  }

  #onClose(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    this.#ws = null;
    if (this.#closed) return;
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new BuaError({ buaCode: BUA_ERROR_CODES.INTERNAL, message: '连接被桥关闭' }));
    }
    this.#pending.clear();
  }

  #startHeartbeat(): void {
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    /*
     * 用一半间隔发送，保证在桥的 `2 × heartbeatMs` 超时窗口内至少到两次。
     *
     * 下限设为 100ms：桥可能下发很小的值（测试里就是 200ms），若下限抬得太高
     * 会根本不发心跳。同时这个下限也挡住了「恶意/错误的桥下发 1ms 导致忙循环」。
     */
    const interval = Math.max(100, Math.floor(this.#heartbeatMs / 2));
    this.#heartbeatTimer = setInterval(() => {
      const ws = this.#ws;
      if (ws === null || ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: M.heartbeat, params: {} }));
    }, interval);
    this.#heartbeatTimer.unref?.();
  }
}
