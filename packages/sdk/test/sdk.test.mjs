/**
 * SDK 测试。
 *
 * 两层：
 *
 * 1. **对假桥** —— 精确验证请求形状（方法名、参数名）、错误映射、事件分发、
 *    超时。这层能测到协议细节。
 * 2. **对真桥**（`@bua/server`）—— 验证 SDK 与桥的接线真的对得上，
 *    用假扩展回应。这层能抓到「两边各写一遍协议字段名」的漂移。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebSocket, WebSocketServer } from 'ws';

import { BuaError, connect } from '../dist/index.js';
import { Bridge } from '@bua/server';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────── 假桥脚手架 ─────────────────────── */

/**
 * 起一个最小 JSON-RPC 服务端，按 `handlers` 回应。
 * 每个请求都会被记进 `calls`，便于断言「SDK 到底发了什么」。
 */
async function startFakeBridge(handlers = {}) {
  const calls = [];
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((res) => wss.once('listening', res));
  const port = wss.address().port;

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      // 通知（无 id）不回应
      if (msg.id === undefined) {
        calls.push({ method: msg.method, params: msg.params, notification: true });
        return;
      }
      calls.push({ method: msg.method, params: msg.params, notification: false });

      const handler = handlers[msg.method];
      if (handler === undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        return;
      }
      const outcome = typeof handler === 'function' ? handler(msg.params) : handler;
      if (outcome !== null && typeof outcome === 'object' && 'error' in outcome) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: outcome.error }));
      } else {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: outcome }));
      }
    });
  });

  return {
    port,
    calls,
    /** 向所有连接广播一个事件。 */
    emit(event) {
      for (const ws of wss.clients) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bua.event', params: event }));
      }
    },
    close: () =>
      new Promise((res) => {
        for (const ws of wss.clients) ws.close();
        wss.close(() => res());
      }),
  };
}

const HELLO_OK = {
  sessionId: 's_agent_test',
  heartbeatMs: 60_000,
  backend: { connected: true, chromeVersion: '148.0.0.0' },
  capabilities: {
    cdp: true,
    screenshots: true,
    fileUploads: true,
    downloads: true,
    evaluate: true,
    management: true,
    notes: [],
  },
};

test('tab 子命名空间和嵌套 locator 始终寻址自己的标签', async () => {
  const methods = ['playwright.evaluate', 'playwright.domSnapshot', 'playwright.waitForTimeout',
    'playwright.waitForLoadState', 'ax.get', 'ax.click', 'cua.click', 'cua.doubleClick',
    'cua.move', 'cua.scroll', 'cua.type', 'cua.keypress', 'dom_cua.click',
    'content.export', 'locator.click', 'locator.fill', 'locator.innerText',
    'locator.textContent', 'locator.isVisible', 'locator.isEnabled', 'locator.count'];
  const { bridge, agent } = await withAgent(Object.fromEntries(methods.map((method) =>
    [method, (params) => ({ result: { value: params.tabId }, path: 'export.txt' })])));
  try {
    const browser = await agent.browsers.getDefault();
    const first = await browser.tabs.get(11);
    const second = await browser.tabs.get(22);
    const intent = { targetDescription: 'Test target' };
    assert.equal(await first.text(), 11);
    assert.equal(await second.text(), 22);
    const start = bridge.calls.length;
    await first.playwright.domSnapshot();
    await first.playwright.waitForTimeout(1);
    await first.playwright.waitForLoadState();
    await first.ax.get();
    await first.ax.click(1, 2, intent);
    await first.cua.click(1, 2, intent);
    await first.cua.doubleClick(1, 2, intent);
    await first.cua.move(1, 2);
    await first.cua.scroll(1, 2, 0, 10);
    await first.cua.type('hello', intent);
    await first.cua.keypress('Enter', intent);
    await first.domCua.getVisibleDom();
    await first.domCua.click(1, intent);
    await first.content.export();
    const locator = first.playwright.locator('#parent').locator('button');
    await locator.click(intent);
    await locator.fill('hello', intent);
    await locator.innerText();
    await locator.textContent();
    await locator.isVisible();
    await locator.isEnabled();
    await locator.count();
    assert.equal(bridge.calls.length - start, 21);
    for (const call of bridge.calls.slice(start)) assert.equal(call.params.tabId, 11, call.method);
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/** 起假桥 + 接上 SDK。
 *
 * 默认 handler 覆盖 `browser.list`（`getDefault()` 依赖它）；其余方法各自按需覆盖。
 * 没给 handler 的方法会回 `{}`，这会让「期望结构化返回」的断言以 undefined 失败 ——
 * 那是测试自身配置缺失，不是 SDK 缺陷。
 */
async function withAgent(handlers = {}) {
  const bridge = await startFakeBridge({
    'bua.hello': HELLO_OK,
    'browser.list': { browsers: [{ id: 'extension', name: '本机 Chrome', type: 'extension' }] },
    ...handlers,
  });
  const agent = await connect({ port: bridge.port, client: { name: 'test', version: '1' } });
  return { bridge, agent, port: bridge.port };
}

/* ─────────────────────── 握手与连接 ─────────────────────── */

test('connect() 完成握手并暴露 sessionId 与能力', async () => {
  const { bridge, agent } = await withAgent();
  try {
    assert.equal(agent.sessionId, 's_agent_test');
    assert.equal(agent.capabilities?.cdp, true);
    // 握手必须声明 role=agent，桥据此路由
    const hello = bridge.calls.find((c) => c.method === 'bua.hello');
    assert.equal(hello.params.role, 'agent');
    assert.equal(hello.params.protocolVersion, 'v0');
    assert.equal(hello.params.client.name, 'test');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('连接失败时 connect() 拒绝而不是静默成功', async () => {
  // 用一个极短超时 + 不可达端口。注意 WebSocket 连接失败通常表现为
  // ECONNREFUSED 或握手超时，两种都算「拒绝」。
  await assert.rejects(
    connect({ port: 9, client: { name: 'x' }, callTimeoutMs: 1500 }),
    (err) => err instanceof Error,
  );
});

test('没有后端时 getDefault() 抛明确错误而不是崩在 undefined 上', async () => {
  const { bridge, agent } = await withAgent({
    'browser.list': { browsers: [] }, // 扩展没连上
  });
  try {
    await assert.rejects(agent.browsers.getDefault(), (err) => {
      assert.ok(err instanceof BuaError);
      assert.equal(err.buaCode, 'BUA_UNSUPPORTED');
      assert.match(err.message, /扩展|后端/);
      return true;
    });
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── 请求形状 ─────────────────────── */

test('browsers.getDefault 走 browser.list 并取第一个', async () => {
  const { bridge, agent } = await withAgent({
    'browser.list': { browsers: [{ id: 'extension', name: '本机 Chrome', type: 'extension' }] },
  });
  try {
    const browser = await agent.browsers.getDefault();
    assert.equal(browser.id, 'extension');
    assert.ok(bridge.calls.some((c) => c.method === 'browser.list'));
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('tabs.list 返回标签数组', async () => {
  const { bridge, agent } = await withAgent({
    'tabs.list': { tabs: [{ id: 7, url: 'https://a.test/', title: 'A', active: true }] },
  });
  try {
    const browser = await agent.browsers.getDefault();
    const tabs = await browser.tabs.list();
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].id, 7);
    assert.equal(tabs[0].url, 'https://a.test/');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('tabs.new 返回的 tabId 被包成 Tab', async () => {
  const { bridge, agent } = await withAgent({ 'tabs.new': { tabId: 42 } });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.new({ url: 'https://x.test/' });
    assert.equal(tab.id, 42);
    const call = bridge.calls.find((c) => c.method === 'tabs.new');
    assert.equal(call.params.url, 'https://x.test/');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── 变更型方法的 targetDescription ─────────────────────── */

test('locator.click 必定携带 targetDescription', async () => {
  const { bridge, agent } = await withAgent({ 'locator.click': { ok: true } });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    await tab.playwright.locator('#submit').click({ targetDescription: '提交按钮（￥299）' });
    const call = bridge.calls.find((c) => c.method === 'locator.click');
    assert.equal(call.params.selector, '#submit');
    assert.equal(call.params.targetDescription, '提交按钮（￥299）');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('Tab.click / Tab.fill 是 locator 的糖，参数形状一致', async () => {
  const { bridge, agent } = await withAgent({
    'locator.click': { ok: true },
    'locator.fill': { ok: true },
  });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(3);
    await tab.click('#a', { targetDescription: 'A' });
    await tab.fill('#b', 'hello', { targetDescription: 'B' });
    const click = bridge.calls.find((c) => c.method === 'locator.click');
    const fill = bridge.calls.find((c) => c.method === 'locator.fill');
    assert.equal(click.params.selector, '#a');
    assert.equal(fill.params.selector, '#b');
    assert.equal(fill.params.value, 'hello');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('cua.click 携带坐标与描述', async () => {
  const { bridge, agent } = await withAgent({ 'cua.click': { ok: true } });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    await tab.cua.click(320, 480, { targetDescription: '画布中心' });
    const call = bridge.calls.find((c) => c.method === 'cua.click');
    assert.equal(call.params.x, 320);
    assert.equal(call.params.y, 480);
    assert.equal(call.params.targetDescription, '画布中心');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── CDP 返回值的解包 ─────────────────────── */

test('tab.title / tab.url 解开 Runtime.evaluate 的 {result:{value}} 包装', async () => {
  const { bridge, agent } = await withAgent({
    'tab.title': { result: { value: 'Example Domain' } },
    'tab.url': { result: { value: 'https://example.com/' } },
  });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    // 这是最容易搞错的地方：CDP 包了两层，SDK 必须解透
    assert.equal(await tab.title(), 'Example Domain');
    assert.equal(await tab.url(), 'https://example.com/');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('playwright.evaluate 解开两层并保留类型', async () => {
  const { bridge, agent } = await withAgent({
    'playwright.evaluate': { result: { value: { n: 42, ok: true } } },
  });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    const v = await tab.playwright.evaluate('({ n: 42, ok: true })');
    assert.deepEqual(v, { n: 42, ok: true });
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('locator.isVisible 返回布尔而不是包装对象', async () => {
  const { bridge, agent } = await withAgent({ 'locator.isVisible': { result: { value: true } } });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    assert.equal(await tab.playwright.locator('#x').isVisible(), true);
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('tab.screenshot 解 base64 为 Buffer', async () => {
  // 1×1 PNG
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const { bridge, agent } = await withAgent({ 'tab.screenshot': { data: png } });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    const buf = await tab.screenshot({ format: 'png' });
    assert.ok(Buffer.isBuffer(buf));
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── 错误映射 ─────────────────────── */

test('桥的错误映射为带 buaCode 的 BuaError', async () => {
  const { bridge, agent } = await withAgent({
    'locator.click': { error: { code: -32000, message: '缺少描述', data: { buaCode: 'BUA_MISSING_TARGET_DESCRIPTION' } } },
  });
  try {
    const browser = await agent.browsers.getDefault();
    const tab = await browser.tabs.get(1);
    await assert.rejects(
      tab.playwright.locator('#x').click({ targetDescription: '' }),
      (err) => {
        assert.ok(err instanceof BuaError);
        assert.equal(err.buaCode, 'BUA_MISSING_TARGET_DESCRIPTION');
        assert.equal(err.rpcCode, -32000);
        return true;
      },
    );
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('BuaError.retryable 按码判定，而不是看文案', async () => {
  const { bridge, agent } = await withAgent({
    'tabs.list': { error: { code: -32000, message: 'x', data: { buaCode: 'BUA_DEBUGGER_UNAVAILABLE' } } },
  });
  try {
    const browser = await agent.browsers.getDefault();
    await assert.rejects(browser.tabs.list(), (err) => {
      assert.equal(err.retryable, true, 'DEBUGGER_UNAVAILABLE 应可重试');
      return true;
    });
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('缺少 buaCode 的错误回退为 INTERNAL，不崩', async () => {
  const { bridge, agent } = await withAgent({
    'tabs.list': { error: { code: -32603, message: 'boom' } },
  });
  try {
    const browser = await agent.browsers.getDefault();
    await assert.rejects(browser.tabs.list(), (err) => {
      assert.equal(err.buaCode, 'BUA_INTERNAL');
      return true;
    });
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── 事件 ─────────────────────── */

test('onEvent 收到桥推送的事件', async () => {
  const { bridge, agent } = await withAgent();
  try {
    const seen = [];
    const off = agent.onEvent((e) => seen.push(e));
    bridge.emit({ type: 'tab.updated', tabId: 5, url: 'https://a.test/' });
    await sleep(120);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'tab.updated');
    assert.equal(seen[0].tabId, 5);
    off();
    bridge.emit({ type: 'tab.updated', tabId: 6 });
    await sleep(80);
    assert.equal(seen.length, 1, '退订后不应再收到');
  } finally {
    await agent.close();
    await bridge.close();
  }
});

test('backend.ready 事件会刷新本地能力视图（降级可被感知）', async () => {
  const { bridge, agent } = await withAgent();
  try {
    assert.equal(agent.capabilities?.cdp, true);
    bridge.emit({
      type: 'backend.ready',
      capabilities: {
        cdp: false,
        screenshots: false,
        fileUploads: false,
        downloads: false,
        evaluate: true,
        management: true,
        notes: ['⚠ 企业策略拒绝了 CDP'],
      },
    });
    await sleep(120);
    assert.equal(agent.capabilities?.cdp, false, '能力视图应更新为降级');
    assert.match(agent.capabilities.notes.join(''), /企业策略/);
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── 心跳 ─────────────────────── */

test('按 hello 返回的 heartbeatMs 发送心跳', async () => {
  const bridge = await startFakeBridge({
    'bua.hello': { ...HELLO_OK, heartbeatMs: 200 }, // 把间隔压到 200ms 便于观测
  });
  const agent = await connect({ port: bridge.port, client: { name: 'hb' } });
  try {
    await sleep(700);
    const beats = bridge.calls.filter((c) => c.method === 'bua.heartbeat' && c.notification);
    assert.ok(beats.length >= 2, `应发了至少 2 次心跳，实际 ${beats.length}`);
  } finally {
    await agent.close();
    await bridge.close();
  }
});

/* ─────────────────────── 对真桥（接线验证） ─────────────────────── */

test('对真桥接线：SDK → 桥 → 假扩展 → 回到 SDK', async () => {
  const audits = [];
  const realBridge = new Bridge({ port: 0, heartbeatMs: 60_000, onAudit: (e) => audits.push(e) });
  const address = await realBridge.start();

  /*
   * ⚠️ 必须**创建后立刻**挂 open 监听，不能先 `await` 别的东西再挂。
   *
   * 早期写法是：创建 extWs → `await connect(...)` → 再 `new Promise(res =>
   * extWs.once('open', res))`。中间那段 await 足够让 TCP+TLS 完成，open 事件在
   * 监听器挂上之前就派发掉了 —— 于是这个 Promise 永远不 resolve，整个测试挂死。
   * 这类「事件早于监听器」的竞态在异步测试里很常见，值得单独标出来。
   */
  const extWs = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const extOpen = new Promise((res, rej) => {
    extWs.once('open', res);
    extWs.once('error', rej);
  });

  const agent = await connect({ port: address.port, client: { name: 'e2e-sdk' } });

  try {
    await extOpen;
    const extRequests = [];
    extWs.on('message', (data) => {
      const msg = JSON.parse(String(data));
      // 只回应真正的请求：有 id 且有 method。缺 method 的帧不是请求，
      // 回它会被桥当成未知响应 —— 早期调试时正是这样制造了一个回声循环。
      if (msg.id === undefined || msg.method === undefined) return;
      extRequests.push(msg);
      // 模拟扩展：实现 SDK 用到的三类方法
      let result;
      if (msg.method === 'browser.list') {
        result = { browsers: [{ id: 'extension', name: '假扩展', type: 'extension' }] };
      } else if (msg.method === 'tabs.list') {
        result = { tabs: [{ id: 11, url: 'https://real.test/', title: 'Real', active: true }] };
      } else {
        result = { ok: true };
      }
      extWs.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
    await new Promise((res) => {
      extWs.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'h',
          method: 'bua.hello',
          params: {
            protocolVersion: 'v0',
            role: 'extension',
            client: { extensionId: 'fake', extensionVersion: '0' },
          },
        }),
      );
      setTimeout(res, 200);
    });

    // ① SDK → 桥 → 扩展
    const browser = await agent.browsers.getDefault();
    const tabs = await browser.tabs.list();
    assert.equal(tabs[0].id, 11, 'SDK 应拿到假扩展回的标签');

    // ② 变更型方法的 targetDescription 真的被桥校验通过并转发
    const tab = await browser.tabs.get(11);
    await tab.playwright.locator('#go').click({ targetDescription: '开始按钮' });
    const forwarded = extRequests.find((r) => r.method === 'locator.click');
    assert.ok(forwarded, '扩展应收到 locator.click');
    assert.equal(forwarded.params.targetDescription, '开始按钮');
    // 桥注入的会话 id 必须存在 —— 多 agent 审计靠它
    assert.equal(forwarded.params.__buaSessionId, agent.sessionId);

    // ③ 桥的审计记录了这次操作
    const entry = audits.find((a) => a.method === 'locator.click' && a.ok);
    assert.ok(entry, '桥应记录审计');
    assert.equal(entry.targetDescription, '开始按钮');
    assert.equal(entry.sessionId, agent.sessionId);
  } finally {
    await agent.close();
    extWs.close();
    await realBridge.stop();
  }
});
