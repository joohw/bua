import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Bridge } from '@bua/server';
import { BrowserRuntime } from '../src/runtime.js';
import { createTools } from '../src/tools.js';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('auto starts, diagnoses absent extension, and stops its own bridge', async () => {
  const runtime = new BrowserRuntime({ port: await freePort() });
  try {
    await runtime.ensureBridge();
    assert.ok(runtime.owned.address);
    const tools = createTools(runtime, (x) => x);
    const info = await tools[0].execute({}, { signal: new AbortController().signal });
    assert.equal(info.connected, false);
    await assert.rejects(tools[1].execute({}), /扩展/);
    assert.equal(runtime.connections.size, 0);
  } finally { await runtime.close(); }
  const other = new Bridge({ port: runtime.port });
  await other.start();
  await other.stop();
});

test('reuses a real BUA bridge without closing it on unload', async () => {
  const bridge = new Bridge();
  const address = await bridge.start();
  const runtime = new BrowserRuntime({ port: address.port });
  try {
    await runtime.ensureBridge();
    assert.equal(runtime.owned, null);
    await runtime.close();
    assert.ok(bridge.address);
    const next = new BrowserRuntime({ port: address.port });
    await next.ensureBridge();
    await next.close();
  } finally { await runtime.close(); await bridge.stop(); }
});

test('concurrent startup shares bridge; follower can take over after owner stops', async () => {
  const port = await freePort();
  const runtimes = [new BrowserRuntime({ port }), new BrowserRuntime({ port })];
  try {
    await Promise.all(runtimes.map((r) => r.ensureBridge()));
    assert.equal(runtimes.filter((r) => r.owned).length, 1);
    const owner = runtimes.find((r) => r.owned);
    const follower = runtimes.find((r) => !r.owned);
    await owner.close();
    await follower.ensureBridge();
    assert.ok(follower.owned);
  } finally { await Promise.all(runtimes.map((r) => r.close())); }
});

test('rejects unrelated port service and does not stop it', async () => {
  const server = createServer((_req, res) => { res.writeHead(400); res.end('unrelated'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const runtime = new BrowserRuntime({ port: server.address().port });
  try {
    await assert.rejects(runtime.ensureBridge(), /未提供兼容/);
    assert.equal(runtime.owned, null);
    await runtime.close();
    assert.equal(server.listening, true);
  } finally { await runtime.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('registers native tools, requires intent and explicit tab, renders screenshot', async () => {
  let calls = 0;
  const runtime = { async run(fn) { calls++; return fn({ tabs: { async get(id) {
    assert.equal(id, 22);
    return { id, async screenshot() { return Buffer.from('png'); } };
  } } }); } };
  const attachment = { attachmentId: 'test-image', mediaType: 'image/png', bytes: 3, width: 1, height: 1 };
  const tools = createTools(runtime, (x) => x, async (data) => {
    assert.equal(data.toString(), 'png'); return attachment;
  });
  assert.equal(tools.length, 14);
  for (const tool of tools) {
    assert.match(tool.name, /^bua_/);
    if ('tabId' in tool.parameters) assert.equal(tool.parameters.tabId.required, true);
  }
  const click = tools.find((t) => t.name === 'bua_tab_click');
  await assert.rejects(click.execute({ tabId: 22, targetDescription: '   ' }), /targetDescription/);
  assert.equal(calls, 0);
  const screenshot = tools.find((t) => t.name === 'bua_tab_screenshot');
  const value = await screenshot.execute({ tabId: 22 });
  assert.deepEqual(screenshot.output.render({}, value), [{ type: 'image', attachment }]);
});

test('pre-aborted tool does not start a bridge', async () => {
  const runtime = new BrowserRuntime({ port: await freePort() });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runtime.run(() => {}, controller.signal), { name: 'AbortError' });
  assert.equal(runtime.owned, null);
  await runtime.close();
});
