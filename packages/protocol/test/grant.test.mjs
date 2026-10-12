/**
 * 授权模型的一致性测试。
 *
 * 这是安全关键路径。重点覆盖 origin 匹配的**绕过尝试** ——
 * 朴素的前缀/后缀匹配是这类代码最常见的漏洞来源。
 *
 * 纯 ESM，无 TS 语法（Node 直接执行，不经过编译）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkGrant,
  hasGrantLevel,
  isGrantExpired,
  isOriginAllowed,
  GRANT_LEVELS,
  GRANT_LEVEL_STRENGTH,
} from '../dist/index.js';

const grant = (over = {}) => ({ level: 'read', origins: [], expiresAt: null, ...over });

/* ─────────────────────── 层级比较 ─────────────────────── */

test('层级强度严格递增', () => {
  for (let i = 1; i < GRANT_LEVELS.length; i += 1) {
    const prev = GRANT_LEVEL_STRENGTH[GRANT_LEVELS[i - 1]];
    const cur = GRANT_LEVEL_STRENGTH[GRANT_LEVELS[i]];
    assert.ok(cur > prev, `${GRANT_LEVELS[i]} 应强于 ${GRANT_LEVELS[i - 1]}`);
  }
});

test('hasGrantLevel 按强度而非字面量比较', () => {
  assert.equal(hasGrantLevel(grant({ level: 'full' }), 'read'), true);
  assert.equal(hasGrantLevel(grant({ level: 'interact' }), 'read'), true);
  assert.equal(hasGrantLevel(grant({ level: 'read' }), 'interact'), false);
  assert.equal(hasGrantLevel(grant({ level: 'none' }), 'read'), false);
  assert.equal(hasGrantLevel(grant({ level: 'read' }), 'read'), true);
});

/* ─────────────────────── 过期 ─────────────────────── */

test('null 永不过期', () => {
  assert.equal(isGrantExpired(grant({ expiresAt: null }), 1e15), false);
});

test('过期边界是闭区间', () => {
  assert.equal(isGrantExpired(grant({ expiresAt: 1000 }), 999), false);
  assert.equal(isGrantExpired(grant({ expiresAt: 1000 }), 1000), true);
  assert.equal(isGrantExpired(grant({ expiresAt: 1000 }), 1001), true);
});

test('过期的授权导致 GRANT_INSUFFICIENT，即使层级足够', () => {
  const g = grant({ level: 'full', expiresAt: 1000 });
  assert.equal(checkGrant(g, 'read', undefined, 2000), 'BUA_GRANT_INSUFFICIENT');
});

/* ─────────────────────── origin 匹配 ─────────────────────── */

test('精确匹配', () => {
  const g = grant({ origins: ['https://example.com'] });
  assert.equal(isOriginAllowed(g, 'https://example.com'), true);
  assert.equal(isOriginAllowed(g, 'https://example.com/'), true);
  assert.equal(isOriginAllowed(g, 'https://example.com/a/b?c=d#e'), true);
});

test('通配符 * 放行一切', () => {
  const g = grant({ origins: ['*'] });
  assert.equal(isOriginAllowed(g, 'https://anything.test'), true);
  assert.equal(isOriginAllowed(g, 'http://127.0.0.1:3000'), true);
});

test('空白名单拒绝一切（默认拒绝）', () => {
  assert.equal(isOriginAllowed(grant({ origins: [] }), 'https://example.com'), false);
});

test('不同端口视为不同 origin', () => {
  const g = grant({ origins: ['http://localhost:3000'] });
  assert.equal(isOriginAllowed(g, 'http://localhost:3000'), true);
  assert.equal(isOriginAllowed(g, 'http://localhost:3001'), false);
  assert.equal(isOriginAllowed(g, 'http://localhost'), false);
});

test('不同 scheme 视为不同 origin', () => {
  const g = grant({ origins: ['https://example.com'] });
  assert.equal(isOriginAllowed(g, 'http://example.com'), false);
});

test('子域名不被父域白名单放行', () => {
  const g = grant({ origins: ['https://example.com'] });
  assert.equal(isOriginAllowed(g, 'https://evil.example.com'), false);
  assert.equal(isOriginAllowed(g, 'https://a.b.example.com'), false);
});

test('绕过尝试：后缀伪装域名必须被拒', () => {
  const g = grant({ origins: ['https://example.com'] });
  assert.equal(isOriginAllowed(g, 'https://example.com.evil.test'), false);
  assert.equal(isOriginAllowed(g, 'https://notexample.com'), false);
  assert.equal(isOriginAllowed(g, 'https://example.community'), false);
});

test('绕过尝试：前缀伪装域名必须被拒', () => {
  const g = grant({ origins: ['https://example.com'] });
  assert.equal(isOriginAllowed(g, 'https://evil.test/?x=https://example.com'), false);
  assert.equal(isOriginAllowed(g, 'https://xexample.com'), false);
});

test('绕过尝试：URL 里嵌凭据必须被拒', () => {
  const g = grant({ origins: ['https://example.com'] });
  // https://example.com@evil.test 的真实 origin 是 evil.test
  assert.equal(isOriginAllowed(g, 'https://example.com@evil.test'), false);
});

test('非法 URL 一律拒绝，不抛异常', () => {
  const g = grant({ origins: ['https://example.com'] });
  for (const bad of ['', 'not a url', 'javascript:alert(1)', 'example.com', '://x']) {
    assert.equal(isOriginAllowed(g, bad), false, `应拒绝: ${bad}`);
  }
});

test('白名单里的非法条目不影响其他条目的匹配', () => {
  const g = grant({ origins: ['garbage', 'https://ok.test'] });
  assert.equal(isOriginAllowed(g, 'https://ok.test'), true);
  assert.equal(isOriginAllowed(g, 'https://garbage'), false);
});

/* ─────────────────────── checkGrant 组合 ─────────────────────── */

test('层级不足优先返回 GRANT_INSUFFICIENT（先判权限再判域名）', () => {
  const g = grant({ level: 'none', origins: ['https://example.com'] });
  assert.equal(checkGrant(g, 'read', 'https://example.com'), 'BUA_GRANT_INSUFFICIENT');
});

test('层级足够但域名未授权返回 ORIGIN_DENIED', () => {
  const g = grant({ level: 'interact', origins: ['https://other.test'] });
  assert.equal(checkGrant(g, 'read', 'https://example.com'), 'BUA_ORIGIN_DENIED');
});

test('层级足够且域名授权，或未指定域名时通过', () => {
  const g = grant({ level: 'interact', origins: ['https://example.com'] });
  assert.equal(checkGrant(g, 'read', 'https://example.com'), null);
  assert.equal(checkGrant(g, 'read', undefined), null);
});
