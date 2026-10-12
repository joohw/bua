/**
 * 会话存储。
 *
 * 桥同时持有两类会话：若干 `agent` 与**至多一个** `extension`。
 * 单后端约束是 v0 的刻意简化 —— 多扩展（多浏览器 profile）需要 `browserId`
 * 路由，留到 M3。见 `docs/routing.md` §1.1。
 */

import type { Capabilities } from '@bua/protocol';

import type {
  AgentSession,
  ExtensionSession,
  PeerRole,
  Session,
} from './types.js';

export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  #extension: ExtensionSession | null = null;
  #counter = 0;

  /** 生成会话 id。形如 `s_1a2b`，足够日志可读且不泄露信息。 */
  nextSessionId(role: PeerRole): string {
    this.#counter += 1;
    const rand = Math.random().toString(36).slice(2, 6);
    return `s_${role}_${this.#counter.toString(36)}${rand}`;
  }

  addAgent(session: AgentSession): void {
    this.#sessions.set(session.sessionId, session);
  }

  /**
   * 注册扩展会话。返回 `false` 表示已有扩展连接 —— 调用方应拒绝新连接。
   * 单后端约束见类文档。
   */
  addExtension(session: ExtensionSession): boolean {
    if (this.#extension !== null) return false;
    this.#extension = session;
    this.#sessions.set(session.sessionId, session);
    return true;
  }

  get(sessionId: string): Session | undefined {
    return this.#sessions.get(sessionId);
  }

  remove(sessionId: string): Session | undefined {
    const s = this.#sessions.get(sessionId);
    if (s === undefined) return undefined;
    this.#sessions.delete(sessionId);
    if (this.#extension?.sessionId === sessionId) this.#extension = null;
    return s;
  }

  /** 当前连接的扩展，`null` 表示没有后端。 */
  getExtension(): ExtensionSession | null {
    return this.#extension;
  }

  /** 更新扩展上报的能力。扩展重连或降级时调用。 */
  setExtensionCapabilities(capabilities: Capabilities): void {
    if (this.#extension !== null) this.#extension.capabilities = capabilities;
  }

  allAgents(): AgentSession[] {
    const out: AgentSession[] = [];
    for (const s of this.#sessions.values()) if (s.role === 'agent') out.push(s);
    return out;
  }

  size(): number {
    return this.#sessions.size;
  }

  /** 触达时间打点。心跳与任意消息都会刷新。 */
  touch(sessionId: string, now: number = Date.now()): void {
    const s = this.#sessions.get(sessionId);
    if (s !== undefined) s.lastSeenAt = now;
  }
}
