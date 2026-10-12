/**
 * 桥的端到端集成测试。
 *
 * 用「假扩展」与「假 agent」两个 WebSocket 客户端验证真实行为：
 * - Host / Origin 拦截（恶意网页场景）
 * - 协议版本校验
 * - 握手与能力协商
 * - 方法路由与响应回传
 * - `targetDescription` 强制字段
 *
 * 这些是**行为契约**测试，不是单元测试 —— 它们跑真实的 HTTP 升级与 WebSocket 帧。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebSocket } from 'ws';

import { Bridge } from '../dist/index.js';

/* ─────────────────────── 测试脚手架 ─────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动一个桥，返回 { bridge, url, logs, audits, close }。 */
async function startBridge(options = {}) {
  const logs = [];
  const audits = [];
  const bridge = new Bridge({
    port: 0,
    heartbeatMs: 60_000,
    onLog: (level, message) => logs.push({ level, message }),
    onAudit: (entry) => audits.push(entry),
    ...options,
  });
  const address = await bridge.start();
  return {
    bridge,
    url: address.url,
    port: address.port,
    logs,
    audits,
    close: () => bridge.stop(),
  };
}

/** 打开一个 WebSocket，返回包装对象（带 request 辅助）。 */
function connect(url, extraHeaders) {
  const ws = new WebSocket(url, extraHeaders !== undefined ? { headers: extraHeaders } : undefined);
  const pending = new Map();
  const events = [];
  let seq = 0;

  const opened = new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`升级被拒：HTTP ${res.statusCode}`)),
    );
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const slot = pending.get(msg.id);
      pending.delete(msg.id);
      slot(msg);
    } else if (msg.method !== undefined) {
      events.push(msg);
    }
  });

  return {
    ws,
    opened,
    events,
    /** 发一个请求并等响应（带超时，避免测试挂死）。resolve 出 `{id, ...msg}`。 */
    request(method, params, timeoutMs = 3000) {
      seq += 1;
      const id = `t${seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`请求超时：${method}`));
        }, timeoutMs);
        pending.set(id, (msg) => {
          clearTimeout(timer);
          resolve({ ...msg, sentId: id });
        });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
    },
    notify(method, params) {
      ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    },
    send(raw) {
      ws.send(typeof raw === 'string' ? raw : JSON.stringify(raw));
    },
    close() {
      return new Promise((resolve) => {
        if (ws.readyState === ws.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      });
    },
  };
}

/** 连上并完成扩展握手。 */
async function connectExtension(url, overrides = {}) {
  const c = connect(url);
  await c.opened;
  const res = await c.request('bua.hello', {
    protocolVersion: 'v0',
    role: 'extension',
    client: {
      extensionId: 'test-extension-id',
      extensionVersion: '0.1.0',
      chromeVersion: '154.0.8037.99',
    },
    capabilities: ['cdp', 'management'],
    ...overrides,
  });
  return { ...c, hello: res };
}

/** 连上并完成 agent 握手。 */
async function connectAgent(url, name = 'test-agent') {
  const c = connect(url);
  await c.opened;
  const res = await c.request('bua.hello', {
    protocolVersion: 'v0',
    role: 'agent',
    client: { name, version: '1.0.0' },
  });
  return { ...c, hello: res };
}

/* ─────────────────────── 传输层拦截 ─────────────────────── */

test('恶意网页来源（http origin）被拒绝升级', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url, { origin: 'https://evil.test' });
    await assert.rejects(c.opened, /升级被拒：HTTP 403/);
  } finally {
    await b.close();
  }
});

test('扩展来源（chrome-extension://）放行', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url, { origin: 'chrome-extension://abcdefghijklmnop' });
    await c.opened; // 不抛错即通过
    await c.close();
  } finally {
    await b.close();
  }
});

test('无 Origin 的本机客户端放行', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url);
    await c.opened;
    await c.close();
  } finally {
    await b.close();
  }
});

test('普通 HTTP 请求得到 426（不暴露 REST 面）', async () => {
  const b = await startBridge();
  try {
    const res = await fetch(`http://127.0.0.1:${b.port}/`);
    assert.equal(res.status, 426);
  } finally {
    await b.close();
  }
});

/* ─────────────────────── 握手 ─────────────────────── */

test('协议版本不匹配时断开连接', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url);
    await c.opened;
    const closed = new Promise((resolve) => c.ws.once('close', (code) => resolve(code)));
    c.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'bua.hello',
      params: { protocolVersion: 'v99', role: 'agent', client: { name: 'x' } },
    });
    const code = await closed;
    assert.equal(code, 4002, '应为 PROTOCOL_VERSION 关闭码');
  } finally {
    await b.close();
  }
});

test('未握手就发方法调用被拒', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url);
    await c.opened;
    const res = await c.request('tabs.list', {});
    assert.ok(res.error, '应返回错误');
    assert.match(res.error.message, /bua\.hello/);
    await c.close();
  } finally {
    await b.close();
  }
});

test('未知 role 被拒', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url);
    await c.opened;
    const res = await c.request('bua.hello', { protocolVersion: 'v0', role: 'nobody' });
    assert.ok(res.error);
    assert.match(res.error.message, /role/);
    await c.close();
  } finally {
    await b.close();
  }
});

/* ─────────────────────── 能力协商 ─────────────────────── */

test('无后端时 agent 握手报告 connected:false 且能力全 false', async () => {
  const b = await startBridge();
  try {
    const a = await connectAgent(b.url);
    assert.equal(a.hello.result.backend.connected, false);
    assert.equal(a.hello.result.capabilities.cdp, false);
    assert.equal(a.hello.result.capabilities.screenshots, false);
    await a.close();
  } finally {
    await b.close();
  }
});

test('有后端时 agent 握手报告已连接', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    assert.equal(a.hello.result.backend.connected, true);
    assert.equal(a.hello.result.backend.chromeVersion, '154.0.8037.99');
    await a.close();
    await ext.close();
  } finally {
    await b.close();
  }
});

test('扩展上报能力后 agent 收到 backend.ready 事件（能力已注入）', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    ext.notify('bua.event', {
      type: 'backend.ready',
      chromeVersion: '154.0.8037.99',
      capabilities: {
        cdp: false,
        screenshots: true,
        fileUploads: false,
        downloads: true,
        evaluate: true,
        management: false,
        notes: ['已降级到 chrome.scripting 模式'],
      },
    });
    await sleep(120);
    const ready = a.events.find(
      (e) => e.method === 'bua.event' && e.params?.type === 'backend.ready' && e.params?.capabilities,
    );
    assert.ok(ready, '应收到带 capabilities 的 backend.ready');
    assert.equal(ready.params.capabilities.cdp, false, '降级标志应透传');
    assert.deepEqual(ready.params.capabilities.notes, ['已降级到 chrome.scripting 模式']);
    await a.close();
    await ext.close();
  } finally {
    await b.close();
  }
});

test('第二个扩展连接被拒绝（v0 单后端）', async () => {
  const b = await startBridge();
  try {
    const ext1 = await connectExtension(b.url);
    const c2 = connect(b.url);
    await c2.opened;
    const closed = new Promise((resolve) => c2.ws.once('close', (code) => resolve(code)));
    c2.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'bua.hello',
      params: {
        protocolVersion: 'v0',
        role: 'extension',
        client: { extensionId: 'second', extensionVersion: '1.0.0' },
      },
    });
    assert.equal(await closed, 4004);
    await ext1.close();
  } finally {
    await b.close();
  }
});

/* ─────────────────────── 方法路由 ─────────────────────── */

test('agent 的方法调用被转发到扩展，响应原样回传', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);

    // 假扩展：收到任何带 fwd_ 前缀 id 的请求就回固定结果
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { tabs: [{ id: 't_1' }], echoed: msg.method } });
      }
    });

    const res = await a.request('tabs.list', {});
    assert.equal(res.id, res.sentId, '响应 id 应与 agent 请求的 id 一致');
    assert.deepEqual(res.result.tabs, [{ id: 't_1' }]);
    assert.equal(res.result.echoed, 'tabs.list');
  } finally {
    await b.close();
  }
});

test('扩展注入 __buaSessionId，且不污染 agent 看到的响应', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    let seen = null;
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        seen = msg.params;
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { ok: true } });
      }
    });
    await a.request('tabs.list', { foo: 'bar' });
    assert.equal(seen.__buaSessionId, a.hello.result.sessionId);
    assert.equal(seen.foo, 'bar', '原有参数必须保留');
  } finally {
    await b.close();
  }
});

test('扩展返回错误时 agent 收到同一错误', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: '标签不存在', data: { buaCode: 'BUA_TAB_NOT_FOUND' } },
        });
      }
    });
    const res = await a.request('tab.url', { tabId: 'nope' });
    assert.ok(res.error);
    assert.equal(res.error.data.buaCode, 'BUA_TAB_NOT_FOUND');
  } finally {
    await b.close();
  }
});

test('无后端时方法调用返回 BUA_UNSUPPORTED 而不是静默失败', async () => {
  const b = await startBridge();
  try {
    const a = await connectAgent(b.url);
    const res = await a.request('tabs.list', {});
    assert.ok(res.error);
    assert.equal(res.error.data.buaCode, 'BUA_UNSUPPORTED');
    assert.match(res.error.message, /没有扩展连接/);
  } finally {
    await b.close();
  }
});

test('扩展角色不能发起方法调用', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const res = await ext.request('tabs.list', {});
    assert.ok(res.error);
    assert.match(res.error.message, /只有 agent/);
  } finally {
    await b.close();
  }
});

/* ─────────────────────── targetDescription 契约 ─────────────────────── */

test('write 类方法缺少 targetDescription 时被桥拒绝，且不转发给扩展', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    let forwarded = false;
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) forwarded = true;
    });

    const res = await a.request('locator.click', { locatorId: 'l_1' });
    assert.ok(res.error);
    assert.equal(res.error.data.buaCode, 'BUA_MISSING_TARGET_DESCRIPTION');
    assert.match(res.error.message, /坐标无法让人判断风险/);
    assert.equal(forwarded, false, '不应转发给扩展');
  } finally {
    await b.close();
  }
});

test('write 类方法带 targetDescription 时正常转发', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { ok: true } });
      }
    });
    const res = await a.request('locator.click', {
      locatorId: 'l_1',
      targetDescription: '提交按钮',
    });
    assert.equal(res.result.ok, true);
  } finally {
    await b.close();
  }
});

test('read 类方法不需要 targetDescription', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { url: 'https://example.com/' } });
      }
    });
    const res = await a.request('tab.url', { tabId: 't_1' });
    assert.equal(res.result.url, 'https://example.com/');
  } finally {
    await b.close();
  }
});

test('destructive 类方法空白的 targetDescription 等同缺失', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    for (const bad of ['', '   ', null, 123]) {
      const res = await a.request('cua.downloadMedia', {
        tabId: 't_1',
        targetDescription: bad,
      });
      assert.ok(res.error, `应拒绝 targetDescription=${JSON.stringify(bad)}`);
      assert.equal(res.error.data.buaCode, 'BUA_MISSING_TARGET_DESCRIPTION');
    }
  } finally {
    await b.close();
  }
});

/* ─────────────────────── 审计 ─────────────────────── */

test('审计记录含方法、风险级别与 targetDescription', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { ok: true } });
      }
    });
    await a.request('locator.click', { locatorId: 'l_1', targetDescription: '结算按钮（￥299）' });
    await sleep(80);

    const entry = b.audits.find((e) => e.method === 'locator.click');
    assert.ok(entry, '应有审计条目');
    assert.equal(entry.risk, 'write');
    assert.equal(entry.targetDescription, '结算按钮（￥299）');
    assert.equal(entry.ok, true);
    assert.equal(entry.sessionId, a.hello.result.sessionId);
  } finally {
    await b.close();
  }
});

test('被拒的调用也进审计（含错误码）', async () => {
  const b = await startBridge();
  try {
    const a = await connectAgent(b.url);
    await a.request('locator.click', { locatorId: 'l_1' });
    await sleep(50);
    const entry = b.audits.find((e) => e.method === 'locator.click');
    assert.ok(entry);
    assert.equal(entry.ok, false);
    assert.equal(entry.errorCode, 'BUA_MISSING_TARGET_DESCRIPTION');
  } finally {
    await b.close();
  }
});

test('destructive 方法被标为 destructive 风险', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { ok: true } });
      }
    });
    await a.request('cua.downloadMedia', { tabId: 't_1', targetDescription: '发票 PDF' });
    await sleep(80);
    const entry = b.audits.find((e) => e.method === 'cua.downloadMedia');
    assert.equal(entry.risk, 'destructive');
  } finally {
    await b.close();
  }
});

/* ─────────────────────── 后端断开 ─────────────────────── */

test('扩展断开后 agent 收到 backend.gone，后续调用失败', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a = await connectAgent(b.url);
    await ext.close();
    await sleep(150);
    const gone = a.events.find((e) => e.method === 'bua.event' && e.params?.type === 'backend.gone');
    assert.ok(gone, '应收到 backend.gone');

    const res = await a.request('tabs.list', {});
    assert.equal(res.error.data.buaCode, 'BUA_UNSUPPORTED');
  } finally {
    await b.close();
  }
});

/* ─────────────────────── 多 agent ─────────────────────── */

test('多个 agent 可并存，各自独立会话', async () => {
  const b = await startBridge();
  try {
    const ext = await connectExtension(b.url);
    const a1 = await connectAgent(b.url, 'agent-1');
    const a2 = await connectAgent(b.url, 'agent-2');
    assert.notEqual(a1.hello.result.sessionId, a2.hello.result.sessionId);

    ext.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id === 'string' && msg.id.startsWith('fwd_')) {
        ext.send({ jsonrpc: '2.0', id: msg.id, result: { seen: msg.params.__buaSessionId } });
      }
    });

    const r1 = await a1.request('tabs.list', {});
    const r2 = await a2.request('tabs.list', {});
    assert.equal(r1.result.seen, a1.hello.result.sessionId);
    assert.equal(r2.result.seen, a2.hello.result.sessionId);
    assert.notEqual(r1.result.seen, r2.result.seen);
  } finally {
    await b.close();
  }
});

test('畸形 JSON 不导致桥崩溃', async () => {
  const b = await startBridge();
  try {
    const c = connect(b.url);
    await c.opened;
    c.send('{ this is not json');
    await sleep(60);
    const res = await c.request('bua.hello', {
      protocolVersion: 'v0',
      role: 'agent',
      client: { name: 'after-garbage' },
    });
    assert.ok(res.result, '桥应仍在工作');
  } finally {
    await b.close();
  }
});
