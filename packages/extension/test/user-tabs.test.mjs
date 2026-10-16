import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';

async function background(options = {}) {
  const source = await readFile(new URL('../src/background.ts', import.meta.url), 'utf8');
  const built = await build({
    stdin: { contents: source + '\nexport { handleBridgeMessage }; export function testSocket(socket) { ws = socket; }',
      resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const frames = [];
  const commands = [];
  const event = { addListener() {} };
  const tabs = [{ id: 11, title: 'First', url: 'https://example.com/', active: false },
    { id: 22, title: 'Second', url: 'https://example.org/', active: true }];
  const context = vm.createContext({ exports: {}, module: { exports: {} }, console, crypto: webcrypto,
    setInterval() {}, setTimeout() {}, WebSocket: { OPEN: 1 },
    chrome: {
      alarms: { onAlarm: { addListener(fn) { options.onAlarm?.(fn); } },
        async create(...args) { options.created?.push(args); }, async clear() {} },
      action: { onClicked: { addListener(fn) { options.onAction?.(fn); } }, async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
      runtime: { async openOptionsPage() { options.opened?.push(true); }, onInstalled: event, onStartup: event, onMessage: { addListener(fn) { options.onMessage?.(fn); } } },
      storage: { local: { async get() { return { ...(options.consent ? { onboardingAcceptedAt: 1 } : {}), activityLog: options.log ?? [] }; }, async set(value) { options.onStore?.(value); } }, onChanged: event },
      debugger: { onDetach: event, async attach() {}, async detach() {},
        async sendCommand(target, method, params) {
          commands.push({ target, method, params });
          return { result: { value: 'Example' } };
        } },
      tabs: { async query(query = {}) { return query.active ? tabs.filter((tab) => tab.active) : tabs; }, async get(id) {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error('Not found');
        return tab;
      }, onUpdated: event, onRemoved: event },
    },
  });
  vm.runInContext(built.outputFiles[0].text, context);
  const api = context.module.exports;
  api.testSocket({ readyState: 1, send(frame) { frames.push(JSON.parse(frame)); } });
  const request = async (method, params = {}) => {
    await api.handleBridgeMessage({ id: frames.length + 1, method, params });
    return frames.at(-1);
  };
  request.commands = commands;
  return request;
}

test('页面操作直接执行 CDP，不注入或刷新覆盖层', async () => {
  const request = await background();
  const response = await request('tab.title', { tabId: 11 });
  assert.equal(response.result.result.value, 'Example');
  assert.deepEqual(request.commands.map((call) => call.method), [
    'Page.enable', 'Runtime.enable', 'Runtime.evaluate',
  ]);
  assert.equal(request.commands.at(-1).params.expression, 'document.title');
  request.commands.length = 0;
  await request('tab.title', { tabId: 11 });
  assert.deepEqual(request.commands.map((call) => call.method), ['Runtime.evaluate']);
});

test('user 标签发现、只读元数据、接管和跨会话冲突', async () => {
  const request = await background();
  const listed = await request('user.openTabs');
  assert.equal(listed.result.tabs.length, 2);
  assert.equal(listed.result.tabs[0].claimed, false);
  const context = await request('user.getTabContext', { tabId: 11 });
  assert.equal(context.result.context.title, 'First');
  const claim = await request('user.claimTab', { tabId: 11, __buaSessionId: 'a' });
  assert.equal(claim.result.tabId, 11);
  assert.equal((await request('user.openTabs')).result.tabs[0].claimedBy, 'a');
  assert.equal((await request('user.claimTab', { tabId: 11, __buaSessionId: 'a' })).result.tabId, 11);
  assert.equal((await request('user.claimTab', { tabId: 11, __buaSessionId: 'b' })).error.data.buaCode, 'BUA_TAB_CLAIMED');
  assert.equal((await request('user.getTabContext', { tabId: 999 })).error.data.buaCode, 'BUA_TAB_NOT_FOUND');
  assert.equal((await request('user.claimTab')).error.data.buaCode, 'BUA_TAB_NOT_FOUND');
  await request('bua.event', { type: 'session.closed', sessionId: 'a' });
  assert.equal((await request('user.openTabs')).result.tabs[0].claimed, false);
  assert.equal((await request('user.claimTab', { tabId: 11, __buaSessionId: 'b' })).result.tabId, 11);
});


test('注册后台唤醒监听，未授权时不创建待命任务', async () => {
  let alarmHandler;
  const created = [];
  // 默认未授权时不创建待命任务。
  await background({ created, onAlarm(fn) { alarmHandler = fn; } });
  assert.equal(created.length, 0);
  assert.equal(typeof alarmHandler, 'function');
});


test('日志按游标分页，新增记录不影响后续页，状态不携带全量日志', async () => {
  let handler;
  const log = Array.from({ length: 45 }, (_, i) => ({ id: String(i), ts: i, tabId: 11, url: 'https://example.com/', method: 'tab.title', ok: true }));
  await background({ log, onMessage(fn) { handler = fn; } });
  const message = (msg) => new Promise((resolve) => handler({ tabId: 11, url: 'https://example.com/', ...msg }, {}, resolve));
  const first = await message({ type: 'bua:logPage' });
  assert.equal(first.entries.length, 20);
  assert.equal(first.nextCursor, '19');
  log.unshift({ id: 'new', ts: 100, method: 'tab.title', ok: true });
  const second = await message({ type: 'bua:logPage', cursor: first.nextCursor });
  assert.equal(second.entries[0].id, '20');
  assert.equal(second.entries.length, 20);
  const last = await message({ type: 'bua:logPage', cursor: second.nextCursor });
  assert.equal(last.entries.length, 5);
  assert.equal(last.nextCursor, null);
  const expired = await message({ type: 'bua:logPage', cursor: 'expired' });
  assert.equal(expired.entries.length, 0);
  assert.equal('log' in await message({ type: 'bua:status' }), false);
});


test('日志隔离标签和地址，排除全局及无页面归属的历史记录', async () => {
  let handler;
  let stored;
  const log = [
    { id: 'current', tabId: 11, url: 'https://example.com/' },
    { id: 'other-tab', tabId: 22, url: 'https://example.com/' },
    { id: 'other-url', tabId: 11, url: 'https://example.com/old' },
    { id: 'legacy' },
  ];
  const request = await background({ log, onMessage(fn) { handler = fn; }, onStore(value) { stored = value; } });
  const page = (scope) => new Promise((resolve) => handler({ type: 'bua:logPage', ...scope }, {}, resolve));
  const current = await page({ tabId: 11, url: 'https://example.com/' });
  assert.deepEqual(Array.from(current.entries, (entry) => entry.id), ['current']);
  assert.equal((await page({})).entries.length, 0);
  await request('tab.title', { tabId: 11 });
  assert.equal(stored.activityLog[0].tabId, 11);
  assert.equal(stored.activityLog[0].url, 'https://example.com/');
  await request('tab.title');
  assert.equal(stored.activityLog[0].tabId, 22);
  assert.equal(stored.activityLog[0].url, 'https://example.org/');
  await request('tabs.list');
  assert.equal(stored.activityLog[0].tabId, undefined);
});


test('点击扩展图标直接打开设置页', async () => {
  let click;
  const opened = [];
  await background({ opened, onAction(fn) { click = fn; } });
  click();
  assert.equal(opened.length, 1);
});
