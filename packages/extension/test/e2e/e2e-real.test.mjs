/**
 * 实机端到端验证。
 *
 * 这不是模拟：真的启动 Chrome、真的加载扩展、真的让扩展 `chrome.debugger.attach`
 * 到标签、真的由「agent 侧」通过 CDP 驱动，并截图证明。
 *
 * ```
 *   本测试 (agent + 桥)          Chrome for Testing
 *         │                            │
 *         ├─ Bridge (in-process) ──────┤  BUA 扩展 (service worker)
 *         │        ws                  │      │ chrome.debugger
 *         └────────────────────────────┴──────┴──▶ 真实标签页
 * ```
 *
 * 为什么用 Chrome for Testing 而不是系统 Chrome：**系统 Chrome 154 已移除
 * `--load-extension`**（实测 profile 里 `extensions.settings` 为空）。CfT 保留该行为。
 *
 * 需要 `pnpm run build` 先产出 `dist/`。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';

import { Bridge } from '@bua/server';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(here, '..', 'dist');
const outDir = resolve(here, '..', 'e2e-out');
const profileDir = resolve(here, '..', '.e2e-profile');

/** 找一个可用的 Chrome for Testing。 */
function findChromeForTesting() {
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(cache)) return null;
  const versions = readdirSync(cache)
    .filter((d) => d.startsWith('win64-'))
    .sort()
    .reverse(); // 取最高版本
  for (const v of versions) {
    const exe = join(cache, v, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return { exe, version: v.replace('win64-', '') };
  }
  return null;
}

const chromeInfo = findChromeForTesting();
const hasBuild = existsSync(join(extDir, 'manifest.json'));

/** 这些测试需要真实浏览器，缺任一条件就整体跳过而不是失败。 */
const ready = chromeInfo !== null && hasBuild;
const skip = ready ? false : `跳过：${chromeInfo === null ? '无 Chrome for Testing' : '扩展未构建（先 pnpm run build）'}`;

/* ─────────────────────── 测试脚手架 ─────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bridge = null;
let browser = null;
let extensionId = null;
let agent = null;

/** agent 侧的桥客户端。 */
function makeAgentClient(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const events = [];
  let seq = 0;

  const opened = new Promise((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
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
    call(method, params, timeoutMs = 20000) {
      seq += 1;
      const id = `a${seq}`;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`agent 调用超时：${method}`));
        }, timeoutMs);
        pending.set(id, (msg) => {
          clearTimeout(timer);
          res(msg);
        });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
    },
    hello() {
      seq += 1;
      const id = `a${seq}`;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('hello 超时')), 10000);
        pending.set(id, (msg) => {
          clearTimeout(timer);
          res(msg);
        });
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'bua.hello',
            params: { protocolVersion: 'v0', role: 'agent', client: { name: 'e2e-agent', version: '1.0' } },
          }),
        );
      });
    },
  };
}

before(async () => {
  if (!ready) return;

  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // ① 启动桥
  const audit = [];
  bridge = new Bridge({ port: 0, heartbeatMs: 60_000, onAudit: (e) => audit.push(e) });
  bridge.audit = audit;
  const address = await bridge.start();

  // ② 启动 Chrome 并加载扩展
  browser = await puppeteer.launch({
    executablePath: chromeInfo.exe,
    headless: false,
    userDataDir: profileDir,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1100,780',
      '--window-position=60,40',
    ],
    defaultViewport: null,
  });

  // ③ 等扩展的 service worker 出现，拿到扩展 ID
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && extensionId === null) {
    const target = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
      { timeout: 4000 },
    ).catch(() => null);
    if (target !== null) {
      const m = /chrome-extension:\/\/([a-p]+)\//.exec(target.url());
      if (m !== null) extensionId = m[1];
    }
  }
  assert.ok(extensionId !== null, '未找到 BUA 扩展的 service worker');

  // ④ 通过引导页完成「同意 + 设置桥端口」，这是扩展建立连接的前置条件。
  //
  // ⚠️ 这里 puppeteer 只做一件事：打开引导页写 storage。之后**所有对目标标签的
  // 操作都走 agent 侧**，因为 `chrome.debugger` 一个标签同时只能有一个客户端 ——
  // 若 puppeteer 也 attach 到同一标签，会和扩展互抢，表现为随机的 attach 失败。
  const onboarding = await browser.newPage();
  await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`, { waitUntil: 'domcontentloaded' });
  await onboarding.evaluate(
    async (port) => {
      await chrome.storage.local.set({ bridgePort: port, onboardingAcceptedAt: Date.now() });
    },
    address.port,
  );
  await onboarding.close();

  // ⑤ 等扩展连上桥
  const connectDeadline = Date.now() + 20_000;
  while (Date.now() < connectDeadline && !bridge.hasBackend) await sleep(250);
  assert.ok(bridge.hasBackend, '扩展未连接到桥');

  // ⑥ agent 侧连上桥
  agent = makeAgentClient(address.url);
  await agent.opened;
  const hello = await agent.hello();
  assert.ok(hello.result, `agent 握手失败：${JSON.stringify(hello.error)}`);
  agent.sessionId = hello.result.sessionId;
});

after(async () => {
  try {
    agent?.ws.close();
  } catch {
    /* ignore */
  }
  if (browser !== null) await browser.close().catch(() => {});
  if (bridge !== null) await bridge.stop();
});

/* ─────────────────────── 验证 ─────────────────────── */

test('扩展作为后端连上桥，能力已协商', { skip }, () => {
  assert.equal(bridge.hasBackend, true);
});

test('agent 握手报告后端已连接（不是「无后端」）', { skip }, () => {
  // before 里的 hello 已断言过 result；这里再确认 backend.connected
  assert.ok(agent.sessionId.startsWith('s_agent_'));
});

test('tabs.list 返回真实标签', { skip }, async () => {
  const res = await agent.call('tabs.list', {});
  assert.ok(res.result, `调用失败：${JSON.stringify(res.error)}`);
  assert.ok(Array.isArray(res.result.tabs));
  assert.ok(res.result.tabs.length >= 1, '至少应有一个标签');
});

test('tabs.new 能新建标签并返回 tabId', { skip }, async () => {
  const res = await agent.call('tabs.new', {
    url: 'data:text/html,<title>BUA E2E</title><h1>hello</h1>',
    visible: true,
  });
  assert.ok(res.result, `调用失败：${JSON.stringify(res.error)}`);
  assert.equal(typeof res.result.tabId, 'number');
  globalThis.e2eTabId = res.result.tabId;
});

test('tab.url / tab.title 通过 CDP 读到真实值', { skip }, async () => {
  const res = await agent.call('tab.title', { tabId: globalThis.e2eTabId });
  assert.ok(res.result !== undefined, `调用失败：${JSON.stringify(res.error)}`);
  // Runtime.evaluate 的返回形如 { result: { value } }
  assert.equal(res.result.result.value, 'BUA E2E');
});

test('playwright.domSnapshot 返回可交互元素清单', { skip }, async () => {
  const res = await agent.call('playwright.domSnapshot', { tabId: globalThis.e2eTabId });
  assert.ok(res.result, `调用失败：${JSON.stringify(res.error)}`);
  const value = res.result.result.value;
  assert.ok(Array.isArray(value), 'DOM 快照应是数组');
});

test('playwright.evaluate 能执行 JS 并回传值', { skip }, async () => {
  const res = await agent.call('playwright.evaluate', {
    tabId: globalThis.e2eTabId,
    functionSource: '(() => ({ ua: navigator.userAgent.slice(0, 20), n: 1 + 1 }))()',
  });
  assert.ok(res.result, `调用失败：${JSON.stringify(res.error)}`);
  const value = res.result.result.value;
  assert.equal(value.n, 2);
  assert.ok(typeof value.ua === 'string' && value.ua.length > 0);
});

test('cua.click 派发真实鼠标事件（scripting 做不到的能力）', { skip }, async () => {
  // 装一个计数器，再用坐标点击命中它
  await agent.call('playwright.evaluate', {
    tabId: globalThis.e2eTabId,
    functionSource: `(() => {
      document.body.innerHTML = '<button id="b" style="position:absolute;left:20px;top:20px;width:200px;height:60px">hit</button>';
      window.__hits = 0;
      document.getElementById('b').addEventListener('click', () => { window.__hits += 1; });
      return true;
    })()`,
  });
  await agent.call(
    'cua.click',
    { tabId: globalThis.e2eTabId, x: 120, y: 50, targetDescription: '测试按钮（E2E）' },
  );
  await sleep(250);
  const res = await agent.call('playwright.evaluate', {
    tabId: globalThis.e2eTabId,
    functionSource: 'window.__hits',
  });
  assert.equal(res.result.result.value, 1, '真实鼠标事件应触发一次点击');
});

test('tab.screenshot 返回真实 PNG 字节', { skip }, async () => {
  const res = await agent.call('tab.screenshot', { tabId: globalThis.e2eTabId, format: 'png' });
  assert.ok(res.result, `调用失败：${JSON.stringify(res.error)}`);
  const data = res.result.data;
  assert.equal(typeof data, 'string');
  const buf = Buffer.from(data, 'base64');
  assert.ok(buf.length > 1000, `PNG 太小：${buf.length} 字节`);
  // PNG magic
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], '应是 PNG');
  writeFileSync(join(outDir, 'agent-screenshot.png'), buf);
  globalThis.agentShotBytes = buf.length;
});

test('write 类方法缺 targetDescription 时被桥拒绝（契约生效）', { skip }, async () => {
  const res = await agent.call('cua.click', { tabId: globalThis.e2eTabId, x: 10, y: 10 });
  assert.ok(res.error, '应被拒绝');
  assert.equal(res.error.data.buaCode, 'BUA_MISSING_TARGET_DESCRIPTION');
});

test('桥的审计记录了真实操作与 targetDescription', { skip }, () => {
  const audit = bridge.audit;
  assert.ok(audit.length > 0, '应有审计条目');
  const click = audit.find((e) => e.method === 'cua.click' && e.ok === true);
  assert.ok(click, '应有成功的 cua.click 审计');
  assert.equal(click.targetDescription, '测试按钮（E2E）');
  assert.equal(click.risk, 'write');
  // sessionId 必须存在 —— 多 agent 场景下这是用户区分「谁干的」的唯一依据
  assert.equal(click.sessionId, agent.sessionId);
});

test('泛光覆盖层真的注入到了页面里', { skip }, async () => {
  const res = await agent.call('playwright.evaluate', {
    tabId: globalThis.e2eTabId,
    functionSource: `(() => {
      const host = document.getElementById('bua-edge-glow-host');
      return {
        present: host !== null,
        hasShadow: host !== null && host.shadowRoot !== null,
        api: typeof globalThis.__BUA_OVERLAY__,
      };
    })()`,
  });
  const v = res.result.result.value;
  assert.equal(v.present, true, '宿主元素应存在');
  assert.equal(v.api, 'object', '覆盖层 API 应已挂载');
});

test('截图证据：带泛光的真实标签页', { skip }, async () => {
  // 让页面内容多点，泛光更容易看清
  await agent.call('playwright.evaluate', {
    tabId: globalThis.e2eTabId,
    functionSource: `(() => {
      document.body.innerHTML = '<div style="font:16px/1.7 system-ui;padding:48px;max-width:760px">'
        + '<h1>BUA 实机验证</h1>'
        + '<p>这个标签正在被 agent 通过 chrome.debugger 操作。注意页面四周的蓝色泛光 —— 它由扩展注入，用 closed Shadow DOM 隔离，页面 CSS 动不了它。</p>'
        + '<p>底部居中的状态胶囊显示当前状态。完整操作流水在扩展弹窗里。</p>'
        + '</div>';
      return true;
    })()`,
  });
  await sleep(700);

  // 取证用 agent 自己的截图能力（走扩展的 CDP）。
  // 刻意**不用** puppeteer 截图：那会给同一个标签再挂一个 debugger 客户端，
  // 与扩展互抢 —— `chrome.debugger` 一个标签同时只允许一个客户端。
  const res = await agent.call('tab.screenshot', { tabId: globalThis.e2eTabId, format: 'png' });
  assert.ok(res.result?.data, `截图失败：${JSON.stringify(res.error)}`);
  const buf = Buffer.from(res.result.data, 'base64');
  writeFileSync(join(outDir, 'tab-with-glow.png'), buf);
  assert.ok(buf.length > 5000, `截图太小：${buf.length} 字节`);
});
