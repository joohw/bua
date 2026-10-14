import { Bridge } from '@bua/server';
import { Browser, Connection } from '@bua/sdk';
import { WebSocket } from 'ws';

/** Own only the bridge we create; never stop an existing bridge or retry a mutation. */
export class BrowserRuntime {
  constructor({ port = 17432 } = {}) {
    this.port = port;
    this.owned = null;
    this.pending = null;
    this.closed = false;
    this.connections = new Set();
  }

  async connection() {
    const conn = new Connection({ port: this.port, callTimeoutMs: 10000,
      socketFactory: (url) => new WebSocket(url, { handshakeTimeout: 3000 }) });
    this.connections.add(conn);
    try {
      const hello = await conn.connect({ name: 'dsh-plugin-bua', version: '0.0.2' });
      if (typeof hello.sessionId !== 'string' || typeof hello.backend?.connected !== 'boolean' || !hello.capabilities) {
        throw new Error('服务未返回有效的 BUA 握手。');
      }
      conn.buaBackend = hello.backend;
      if (this.closed) throw new Error('BUA 插件已停用。');
      return conn;
    } catch (error) {
      await conn.close();
      this.connections.delete(conn);
      throw error;
    }
  }

  async ensureBridge() {
    if (this.closed) throw new Error('BUA 插件已停用。');
    if (this.pending) return this.pending;
    this.pending = this.prepare();
    try { await this.pending; } finally { this.pending = null; }
  }

  async prepare() {
    try {
      const conn = await this.connection();
      await conn.close();
      this.connections.delete(conn);
      return;
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') {
        throw new Error(`端口 ${this.port} 未提供兼容的 BUA 桥：${error.message}`);
      }
    }
    if (this.closed) throw new Error('BUA 插件已停用。');
    const bridge = new Bridge({ port: this.port });
    try {
      await bridge.start();
      this.owned = bridge;
      if (this.closed) { await bridge.stop(); this.owned = null; }
    } catch (error) {
      await bridge.stop();
      if (error.code !== 'EADDRINUSE') throw error;
      // Another plugin won the bind race: verify its BUA handshake before reuse.
      const conn = await this.connection();
      await conn.close();
      this.connections.delete(conn);
    }
  }

  async run(fn, signal) {
    signal?.throwIfAborted();
    await this.ensureBridge();
    signal?.throwIfAborted();
    const conn = await this.connection();
    const cancel = () => { void conn.close(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      return await fn(new Browser(conn, 'extension'), conn);
    } catch (error) {
      if (error.buaCode === 'BUA_UNSUPPORTED') {
        throw new Error(`${error.message}\n请检查本机 Chrome 的 BUA 扩展是否已启用并完成同意。`);
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      await conn.close();
      this.connections.delete(conn);
    }
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.connections].map((conn) => conn.close()));
    await this.pending?.catch(() => {});
    await this.owned?.stop();
    this.owned = null;
  }
}
