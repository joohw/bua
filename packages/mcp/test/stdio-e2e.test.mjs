/**
 * stdio 传输的端到端测试。
 *
 * 与 `mcp.test.mjs` 的区别：那份用 `InMemoryTransport` 在同一进程里测，**不覆盖**真实
 * 子进程路径。这份**真的 spawn `node dist/stdio.js`**，用官方 stdio 客户端连它，
 * 走真实的管道与进程边界 —— 也就是 DSH 实际使用的方式。
 *
 * 这层必须单独测，因为最容易出错的恰恰是进程边界上的东西：
 *   - 进程启动失败 / 入口路径写错
 *   - **往 stdout 写了非 MCP 数据**（一行日志就会破坏协议帧，而且症状是
 *     「工具时有时无」这种极难排查的形态）
 *   - 环境变量没传进去
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { WebSocket } from 'ws';
import { Bridge } from '@bua/server';

const here = dirname(fileURLToPath(import.meta.url));
const stdioEntry = resolve(here, '..', 'dist', 'stdio.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起真桥 + 假扩展，返回端口与清理函数。 */
async function startBridgeWithFakeExtension() {
  const bridge = new Bridge({ port: 0, heartbeatMs: 60_000 });
  const address = await bridge.start();

  const extWs = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await new Promise((res, rej) => {
    extWs.once('open', res);
    extWs.once('error', rej);
  });
  extWs.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.id === undefined || m.method === undefined) return;
    let result;
    if (m.method === 'browser.list') {
      result = {
        browsers: [{ id: 'extension', name: '本机 Chrome', type: 'extension', tabs: [] }],
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
    } else if (m.method === 'tabs.list') {
      result = { tabs: [{ id: 7, url: 'https://pipe.test/', title: '管道测试页', active: true }] };
    } else {
      result = { ok: true };
    }
    extWs.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
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
  await sleep(200);

  return {
    port: address.port,
    async close() {
      extWs.close();
      await bridge.stop();
    },
  };
}

/** spawn 真实的 stdio 服务器并连上。 */
async function spawnServer(port, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [stdioEntry],
    env: { ...process.env, BUA_BRIDGE_PORT: String(port), ...extraEnv },
    stderr: 'pipe',
  });

  const stderrChunks = [];
  // stderr 是诊断通道：必须容忍有内容，且不允许它污染协议
  transport.stderr?.on('data', (c) => stderrChunks.push(String(c)));

  const client = new Client({ name: 'stdio-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, stderrChunks, transport };
}

/* ─────────────────────── 前置检查 ─────────────────────── */

test('stdio 入口已构建', () => {
  assert.ok(
    existsSync(stdioEntry),
    `找不到 ${stdioEntry} —— 请先运行 pnpm --filter @bua/mcp run build`,
  );
});

/* ─────────────────────── 真实子进程 ─────────────────────── */

test('spawn 真实子进程后 MCP 握手成功且工具可用', async (t) => {
  if (!existsSync(stdioEntry)) return t.skip('stdio 入口未构建');
  const b = await startBridgeWithFakeExtension();
  const { client, stderrChunks } = await spawnServer(b.port);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 10, `工具数偏少：${tools.length}`);
    assert.ok(
      tools.some((x) => x.name === 'tabs_list'),
      '应包含 tabs_list',
    );

    // stderr 应当有启动提示（那是**允许**的通道）
    assert.ok(
      stderrChunks.join('').includes('桥端口'),
      'stderr 应有启动诊断信息',
    );
  } finally {
    await client.close().catch(() => {});
    await b.close();
  }
});

test('经真实管道调用工具并把结果带回', async (t) => {
  if (!existsSync(stdioEntry)) return t.skip('stdio 入口未构建');
  const b = await startBridgeWithFakeExtension();
  const { client } = await spawnServer(b.port);
  try {
    const res = await client.callTool({ name: 'tabs_list', arguments: {} });
    const text = res.content[0]?.text ?? '';
    assert.equal(res.isError, undefined, `不应失败：${text}`);
    assert.match(text, /管道测试页/, '结果应穿过管道回到客户端');
    assert.match(text, /https:\/\/pipe\.test\//);
  } finally {
    await client.close().catch(() => {});
    await b.close();
  }
});

test('BUA_BRIDGE_PORT 环境变量被真正读取', async (t) => {
  if (!existsSync(stdioEntry)) return t.skip('stdio 入口未构建');
  const b = await startBridgeWithFakeExtension();
  // 端口由 env 传入（spawnServer 已用 BUA_BRIDGE_PORT 传实际端口）
  const { client, stderrChunks } = await spawnServer(b.port);
  try {
    assert.match(
      stderrChunks.join(''),
      new RegExp(`桥端口 ${b.port}`),
      'stderr 应回显实际使用的端口，证明环境变量生效',
    );
    const res = await client.callTool({ name: 'browser_info', arguments: {} });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0]?.text ?? '', /本机 Chrome/);
  } finally {
    await client.close().catch(() => {});
    await b.close();
  }
});

test('桥不在时工具返回可操作的错误，而不是让子进程崩溃', async (t) => {
  if (!existsSync(stdioEntry)) return t.skip('stdio 入口未构建');
  // 指向一个没有桥的端口
  const { client } = await spawnServer(1);
  try {
    // 服务器本身应能启动（MCP 握手不依赖桥）
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, '桥不在时工具目录仍应可用');

    const res = await client.callTool({ name: 'tabs_list', arguments: {} });
    assert.equal(res.isError, true, '应返回错误结果');
    const text = res.content[0]?.text ?? '';
    assert.match(text, /bua-server|无法连接|扩展/, `错误应可操作：${text}`);
  } finally {
    await client.close().catch(() => {});
  }
});

test('子进程退出后客户端能感知（管道关闭被正确处理）', async (t) => {
  if (!existsSync(stdioEntry)) return t.skip('stdio 入口未构建');
  const b = await startBridgeWithFakeExtension();
  const { client } = await spawnServer(b.port);
  try {
    await client.listTools();
  } finally {
    await b.close();
  }
  // 关闭应当干脆完成，不挂起
  await assert.doesNotReject(client.close(), '关闭不应抛错或挂起');
});
