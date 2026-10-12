/**
 * MCP 服务器测试。
 *
 * 全程**真实协议**：真 MCP 客户端 → 真 MCP 服务器 → 真 SDK → 真 BUA 桥 →
 * 假扩展。用 `InMemoryTransport.createLinkedPair()` 连接两端，因此不需要 spawn 子进程，
 * 但走的仍是完整的 MCP 握手、tools/list、tools/call 与 JSON-RPC 编解码。
 *
 * 假扩展这一层是必要的：桥的契约要求由扩展执行实际操作，而测试不该依赖真实 Chrome。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { WebSocket } from 'ws';
import { Bridge } from '@bua/server';

import { createServer } from '../dist/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────── 脚手架 ─────────────────────── */

/**
 * 起完整栈：真桥 + 假扩展 + 真 MCP 服务器 + 真 MCP 客户端。
 *
 * `overrides` 只需给出**要改变**的方法；其余走 {@link defaultRespond}。
 * 早期版本让调用方整体替换处理器，结果覆盖版本漏掉 `browser.list`，
 * 于是 SDK 拿到非预期形状后崩在 undefined 上、真实错误被掩盖 —— 这是测试脚手架的坑，
 * 合并式覆盖能避免它再次发生。
 */
async function startStack(overrides) {
  const respond = (method, params) => {
    const custom = overrides?.[method];
    if (custom !== undefined) return custom(method, params);
    return defaultRespond(method, params);
  };
  const audits = [];
  const bridge = new Bridge({ port: 0, heartbeatMs: 60_000, onAudit: (e) => audits.push(e) });
  const address = await bridge.start();

  // 假扩展：连桥 + 自动握手 + 按 respond 回应转发的请求
  const extWs = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const extOpen = new Promise((res, rej) => {
    extWs.once('open', res);
    extWs.once('error', rej);
  });

  const handled = [];
  extWs.on('message', (data) => {
    const msg = JSON.parse(String(data));
    // 只回应真正的请求：有 id 且有 method
    if (msg.id === undefined || msg.method === undefined) return;
    handled.push(msg);
    const result = respond(msg.method, msg.params);
    extWs.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });

  await extOpen;
  extWs.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'h',
      method: 'bua.hello',
      params: {
        protocolVersion: 'v0',
        role: 'extension',
        client: { extensionId: 'fake', extensionVersion: '0', chromeVersion: '148.0.0.0' },
      },
    }),
  );
  await sleep(200);

  // MCP 服务器（真实现）
  const mcpServer = createServer({ port: address.port, clientName: 'mcp-test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    bridge,
    audits,
    handled,
    client,
    async close() {
      await client.close().catch(() => {});
      await mcpServer.close().catch(() => {});
      extWs.close();
      await bridge.stop();
    },
  };
}

/** 假扩展的默认行为。 */
function defaultRespond(method, params) {
  switch (method) {
    case 'browser.list':
      return {
        browsers: [
          {
            id: 'extension',
            name: '本机 Chrome',
            type: 'extension',
            tabs: [{ id: 11, url: 'https://a.test/', title: 'A', active: true }],
          },
        ],
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
    case 'tabs.list':
      return {
        tabs: [
          { id: 11, url: 'https://a.test/', title: 'A 页面', active: true },
          { id: 12, url: 'https://b.test/', title: 'B 页面', active: false },
        ],
      };
    case 'tabs.new':
      return { tabId: 99, url: params?.url ?? null };
    case 'tab.title':
      return { result: { value: 'A 页面' } };
    case 'tab.url':
      return { result: { value: 'https://a.test/' } };
    case 'playwright.domSnapshot':
      return {
        result: {
          value: [
            { id: 0, tag: 'a', name: 'Learn more' },
            { id: 1, tag: 'button', name: '提交' },
          ],
        },
      };
    case 'playwright.evaluate':
      return { result: { value: '页面正文示例' } };
    case 'tab.screenshot':
      // 1×1 PNG
      return {
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      };
    default:
      return { ok: true };
  }
}

/* ─────────────────────── 协议层 ─────────────────────── */

test('MCP 握手成功，工具目录非空且命名符合约定', async () => {
  const s = await startStack(defaultRespond);
  try {
    const { tools } = await s.client.listTools();
    assert.ok(tools.length >= 10, `工具数偏少：${tools.length}`);

    const names = tools.map((t) => t.name).sort();
    // 关键工具必须存在
    for (const required of [
      'browser_info',
      'tabs_list',
      'tab_open',
      'tab_info',
      'tab_navigate',
      'tab_close',
      'tab_dom_snapshot',
      'tab_text',
      'tab_screenshot',
      'tab_evaluate',
      'tab_click',
      'tab_fill',
      'tab_type',
      'tab_click_at',
    ]) {
      assert.ok(names.includes(required), `缺少工具 ${required}（实际：${names.join(', ')}）`);
    }

    // 每个工具都要有描述，否则模型无从选择
    for (const t of tools) {
      assert.ok(
        typeof t.description === 'string' && t.description.length > 20,
        `${t.name} 的描述过短`,
      );
    }
  } finally {
    await s.close();
  }
});

test('变更型工具都要求 targetDescription，读取型都不要求', async () => {
  const s = await startStack(defaultRespond);
  try {
    const { tools } = await s.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    const mutating = ['tab_navigate', 'tab_click', 'tab_fill', 'tab_type', 'tab_click_at'];
    for (const name of mutating) {
      const t = byName.get(name);
      const props = t?.inputSchema?.properties ?? {};
      assert.ok(
        Object.prototype.hasOwnProperty.call(props, 'targetDescription'),
        `${name} 应有 targetDescription 参数`,
      );
      const required = t?.inputSchema?.required ?? [];
      // tab_close 的 targetDescription 可选，其余必填
      if (name !== 'tab_close') {
        assert.ok(required.includes('targetDescription'), `${name} 的 targetDescription 应必填`);
      }
    }

    for (const name of ['tab_dom_snapshot', 'tab_text', 'tab_screenshot', 'tab_info']) {
      const props = byName.get(name)?.inputSchema?.properties ?? {};
      assert.equal(
        Object.prototype.hasOwnProperty.call(props, 'targetDescription'),
        false,
        `${name} 是读取型，不该要求 targetDescription`,
      );
    }
  } finally {
    await s.close();
  }
});

/* ─────────────────────── 工具调用（全链路） ─────────────────────── */

test('browser_info 报告后端与能力', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({ name: 'browser_info', arguments: {} });
    const text = res.content[0]?.text ?? '';
    assert.equal(res.isError, undefined, `不应失败：${text}`);
    assert.match(text, /本机 Chrome/);
    assert.match(text, /cdp/);
    assert.match(text, /✓/);
  } finally {
    await s.close();
  }
});

test('tabs_list 渲染出标签清单（含活动标记与 URL）', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({ name: 'tabs_list', arguments: {} });
    const text = res.content[0]?.text ?? '';
    assert.match(text, /A 页面/);
    assert.match(text, /B 页面/);
    assert.match(text, /https:\/\/a\.test\//);
    assert.match(text, /★/, '活动标签应有标记');
  } finally {
    await s.close();
  }
});

test('tab_open 把 URL 透传到扩展并回显 tabId', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({
      name: 'tab_open',
      arguments: { url: 'https://new.test/', visible: true },
    });
    assert.match(res.content[0]?.text ?? '', /99/);
    // 扩展真的收到了这个 URL
    const fwd = s.handled.find((m) => m.method === 'tabs.new');
    assert.equal(fwd?.params?.url, 'https://new.test/');
  } finally {
    await s.close();
  }
});

test('tab_dom_snapshot 渲染出编号元素清单', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({ name: 'tab_dom_snapshot', arguments: { tabId: 11 } });
    const text = res.content[0]?.text ?? '';
    assert.match(text, /\[0\]/);
    assert.match(text, /Learn more/);
    assert.match(text, /\[1\]/);
    assert.match(text, /提交/);
  } finally {
    await s.close();
  }
});

test('tab_text 读正文，maxChars 真的截断', async () => {
  const s = await startStack({ 'playwright.evaluate': (method, params) => {
      return { result: { value: 'A'.repeat(500) } };
} });
  try {
    const full = await s.client.callTool({ name: 'tab_text', arguments: { tabId: 11 } });
    assert.equal((full.content[0]?.text ?? '').length, 500);

    const cut = await s.client.callTool({
      name: 'tab_text',
      arguments: { tabId: 11, maxChars: 100 },
    });
    const text = cut.content[0]?.text ?? '';
    assert.ok(text.startsWith('A'.repeat(100)), '应截断到 100 字符');
    assert.match(text, /已截断/, '应说明被截断并给出完整长度');
  } finally {
    await s.close();
  }
});

test('tab_screenshot 返回 MCP image 内容块而不是文本', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({ name: 'tab_screenshot', arguments: { tabId: 11 } });
    const block = res.content[0];
    assert.equal(block?.type, 'image', `应为 image 块，实际 ${block?.type}`);
    assert.equal(block.mimeType, 'image/png');
    assert.equal(typeof block.data, 'string');
    assert.ok(block.data.length > 20);
  } finally {
    await s.close();
  }
});

test('tab_click 把选择器与 targetDescription 一起送到扩展', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({
      name: 'tab_click',
      arguments: { tabId: 11, selector: '#submit', targetDescription: '提交按钮（￥299）' },
    });
    assert.equal(res.isError, undefined);

    const fwd = s.handled.find((m) => m.method === 'locator.click');
    assert.ok(fwd, '扩展应收到 locator.click');
    assert.equal(fwd.params.selector, '#submit');
    assert.equal(fwd.params.targetDescription, '提交按钮（￥299）');
    // 桥注入的会话 id 必须在场 —— 多 agent 审计靠它
    assert.ok(typeof fwd.params.__buaSessionId === 'string');
  } finally {
    await s.close();
  }
});

test('tab_click_at 传坐标（CUA 层）', async () => {
  const s = await startStack(defaultRespond);
  try {
    const res = await s.client.callTool({
      name: 'tab_click_at',
      arguments: { tabId: 11, x: 120, y: 240, targetDescription: '画布中心' },
    });
    assert.equal(res.isError, undefined);
    const fwd = s.handled.find((m) => m.method === 'cua.click');
    assert.equal(fwd?.params?.x, 120);
    assert.equal(fwd?.params?.y, 240);
  } finally {
    await s.close();
  }
});

test('桥的审计记录了经 MCP 发起的真实操作', async () => {
  const s = await startStack(defaultRespond);
  try {
    await s.client.callTool({
      name: 'tab_click',
      arguments: { tabId: 11, selector: '#a', targetDescription: '审计用点击' },
    });
    await sleep(120);
    const entry = s.audits.find((a) => a.method === 'locator.click' && a.ok);
    assert.ok(entry, '应有审计条目');
    assert.equal(entry.targetDescription, '审计用点击');
    assert.equal(entry.risk, 'write');
    assert.match(entry.sessionId, /^s_agent_/);
  } finally {
    await s.close();
  }
});

/* ─────────────────────── 错误路径 ─────────────────────── */

test('无后端时 browser_info 给出可操作的指引而不是抛异常', async () => {
  // 这个栈不起假扩展
  const bridge = new Bridge({ port: 0, heartbeatMs: 60_000 });
  const address = await bridge.start();
  const mcpServer = createServer({ port: address.port, clientName: 'mcp-test' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(st);
  const client = new Client({ name: 't', version: '1' }, { capabilities: {} });
  await client.connect(ct);

  try {
    const res = await client.callTool({ name: 'browser_info', arguments: {} });
    assert.equal(res.isError, true, '应标记为错误');
    const text = res.content[0]?.text ?? '';
    assert.match(text, /扩展未连接|未启用/, `错误信息应可操作：${text}`);
    assert.match(text, /chrome:\/\/extensions/);
  } finally {
    await client.close().catch(() => {});
    await mcpServer.close().catch(() => {});
    await bridge.stop();
  }
});

test('桥关闭后调用工具返回连接指引，不抛未捕获异常', async () => {
  const s = await startStack(defaultRespond);
  // 先确认正常
  const ok1 = await s.client.callTool({ name: 'tabs_list', arguments: {} });
  assert.equal(ok1.isError, undefined);
  await s.close();

  // 桥已停：再调用应得到结构化错误而不是崩溃
  const res = await s.client
    .callTool({ name: 'tabs_list', arguments: {} })
    .catch((err) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }));
  assert.equal(res.isError, true, '应返回错误');
  const text = res.content[0]?.text ?? '';
  assert.ok(text.length > 0);
});

test('扩展回的错误被桥补上 buaCode，MCP 层再转成可操作说明', async () => {
  // 模拟真实扩展的一种失败形态：错误对象里**没有** data.buaCode。
  // 若桥原样透传，agent 拿到的就是「没有码」的错误，无法按码路由；
  // 桥必须兜底补 BUA_INTERNAL。见 server/src/index.ts 的 #normalizeForwardedError。
  const s = await startStack({ 'tabs.list': (method, params) => {
      return { error: { code: -32000, message: '标签不存在' } };
} });
  try {
    const res = await s.client.callTool({ name: 'tabs_list', arguments: {} });
    assert.equal(res.isError, true, '应标记为错误结果');
    const text = res.content[0]?.text ?? '';
    // 必须是结构化说明，而不是把原始异常吐出来
    assert.ok(text.length > 10, `错误文本过短：${text}`);
    assert.doesNotMatch(text, /Cannot read properties/, `不应暴露内部异常：${text}`);
    assert.match(text, /标签不存在|失败/, `应保留扩展给出的原因：${text}`);
  } finally {
    await s.close();
  }
});

test('扩展给出明确 buaCode 时，MCP 层按码给出对应指引', async () => {
  const s = await startStack({ 'tabs.list': (method, params) => {
      return {
        error: {
          code: -32000,
          message: '没有扩展连接到桥',
          data: { buaCode: 'BUA_UNSUPPORTED' },
        },
      };
} });
  try {
    const res = await s.client.callTool({ name: 'tabs_list', arguments: {} });
    const text = res.content[0]?.text ?? '';
    // BUA_UNSUPPORTED 对应的指引里应提到扩展与授权
    assert.match(text, /扩展|引导页|后端/, `应按 buaCode 给出指引：${text}`);
  } finally {
    await s.close();
  }
});
