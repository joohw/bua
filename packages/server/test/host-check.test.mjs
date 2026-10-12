/**
 * 传输层校验的测试。
 *
 * 这是桥**唯一保留的防线**（不鉴权模型下）。两类威胁：
 *
 * 1. **DNS rebinding / 恶意网页直连** —— 必须被 `Origin` 与 `Host` 挡掉
 * 2. **本机 agent** —— 必须**不被**挡住（否则就变成限制 agent 了）
 *
 * 第 2 点同样重要：校验过严会把正常的 SDK 挡在门外。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkUpgradeRequest, parseHostHeader } from '../dist/host-check.js';

/** 构造一个最小的 IncomingMessage 替身（只需要 headers）。 */
const req = (headers) => ({ headers });

const PORT = 17432;

/* ─────────────────── parseHostHeader ─────────────────── */

test('解析 host:port', () => {
  assert.deepEqual(parseHostHeader('127.0.0.1:17432'), { hostname: '127.0.0.1', port: '17432' });
  assert.deepEqual(parseHostHeader('localhost:80'), { hostname: 'localhost', port: '80' });
});

test('解析裸 host', () => {
  assert.deepEqual(parseHostHeader('localhost'), { hostname: 'localhost', port: null });
  assert.deepEqual(parseHostHeader('127.0.0.1'), { hostname: '127.0.0.1', port: null });
});

test('解析 IPv6 方括号形态', () => {
  assert.deepEqual(parseHostHeader('[::1]:17432'), { hostname: '[::1]', port: '17432' });
  assert.deepEqual(parseHostHeader('[::1]'), { hostname: '[::1]', port: null });
});

test('大小写归一化', () => {
  assert.equal(parseHostHeader('LOCALHOST:80').hostname, 'localhost');
});

test('异常输入不抛错', () => {
  for (const s of ['', ':', ':::', '[::1', 'a:b:c']) {
    assert.doesNotThrow(() => parseHostHeader(s), `不应抛错: ${JSON.stringify(s)}`);
  }
});

/* ─────────────────── 放行：本机 agent ─────────────────── */

test('无 Origin 的本机客户端放行（SDK / CLI）', () => {
  const r = checkUpgradeRequest(req({ host: `127.0.0.1:${PORT}` }), PORT);
  assert.equal(r.ok, true);
});

test('localhost 与 [::1] 均放行', () => {
  assert.equal(checkUpgradeRequest(req({ host: `localhost:${PORT}` }), PORT).ok, true);
  assert.equal(checkUpgradeRequest(req({ host: `[::1]:${PORT}` }), PORT).ok, true);
});

test('无端口或端口一致的 Host 放行', () => {
  assert.equal(checkUpgradeRequest(req({ host: '127.0.0.1' }), PORT).ok, true);
  assert.equal(checkUpgradeRequest(req({ host: `127.0.0.1:${PORT}` }), PORT).ok, true);
});

test('扩展来源放行', () => {
  const r = checkUpgradeRequest(
    req({ host: `127.0.0.1:${PORT}`, origin: 'chrome-extension://abcdefghijklmnop' }),
    PORT,
  );
  assert.equal(r.ok, true);
});

/* ─────────────────── 拦截：恶意网页 ─────────────────── */

test('http(s) origin 一律拒绝（DNS rebinding 主威胁）', () => {
  for (const origin of [
    'http://evil.test',
    'https://evil.test',
    'http://127.0.0.1',
    `http://127.0.0.1:${PORT}`,
    'https://attacker.example.com',
    'HTTP://UPPER.TEST',
  ]) {
    const r = checkUpgradeRequest(req({ host: `127.0.0.1:${PORT}`, origin }), PORT);
    assert.equal(r.ok, false, `应拒绝 origin: ${origin}`);
    assert.equal(r.reason, 'bad-origin');
  }
});

test('非扩展的非 http scheme 也拒绝', () => {
  for (const origin of ['file://', 'data:text/html,x', 'ftp://x']) {
    const r = checkUpgradeRequest(req({ host: `127.0.0.1:${PORT}`, origin }), PORT);
    assert.equal(r.ok, false, `应拒绝 origin: ${origin}`);
    assert.equal(r.reason, 'bad-origin');
  }
});

test('非回环 Host 拒绝', () => {
  for (const host of [
    'evil.test:17432',
    '192.168.1.5:17432',
    '10.0.0.1',
    '0.0.0.0:17432',
    'example.com',
  ]) {
    const r = checkUpgradeRequest(req({ host }), PORT);
    assert.equal(r.ok, false, `应拒绝 host: ${host}`);
    assert.equal(r.reason, 'bad-host');
  }
});

test('Host 端口与监听端口不一致时拒绝', () => {
  const r = checkUpgradeRequest(req({ host: '127.0.0.1:9999' }), PORT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-host');
});

test('缺少 Host 头拒绝', () => {
  const r = checkUpgradeRequest(req({}), PORT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-host');
});

test('Origin 校验先于 Host 校验（恶意网页带伪造 Host 也拦得住）', () => {
  const r = checkUpgradeRequest(
    req({ host: `127.0.0.1:${PORT}`, origin: 'https://evil.test' }),
    PORT,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-origin', '应优先报 origin 问题');
});

/* ─────────────────── 绕过尝试 ─────────────────── */

test('绕过尝试：Host 里塞路径/凭据不放过', () => {
  for (const host of ['127.0.0.1@evil.test', 'evil.test#127.0.0.1', '127.0.0.1.evil.test']) {
    const r = checkUpgradeRequest(req({ host }), PORT);
    assert.equal(r.ok, false, `应拒绝 host: ${host}`);
  }
});

test('绕过尝试：Origin 伪装成 chrome-extension 但带 http 前缀', () => {
  const r = checkUpgradeRequest(
    req({ host: `127.0.0.1:${PORT}`, origin: 'http://chrome-extension://x' }),
    PORT,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-origin');
});

test('Origin 为数组（重复头）时不崩溃', () => {
  // Node 对某些头会给数组
  const r = checkUpgradeRequest(
    req({ host: `127.0.0.1:${PORT}`, origin: ['https://evil.test', 'https://x.test'] }),
    PORT,
  );
  // 数组不是 string，按「缺失」处理 → 放行到 Host 校验，Host 合法则通过。
  // 这是已知的可接受行为：浏览器不会发重复 Origin；重复头需要伪造客户端，
  // 而伪造客户端本来就是「本机信任」模型下允许的。
  assert.equal(typeof r.ok, 'boolean');
});
