/**
 * L3 动作层辅助逻辑的测试。
 *
 * 关注点：敏感字段占位符的解析必须**精确** —— 误判会导致真实凭据
 * 被当成字面量输入到页面，或占位符未被替换而泄露给页面。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSecretPlaceholder,
  containsSecretPlaceholder,
  SECRET_PLACEHOLDER_PATTERN,
} from '../dist/index.js';

/* ─────────────────── parseSecretPlaceholder ─────────────────── */

test('整值占位符被正确解析', () => {
  assert.equal(parseSecretPlaceholder('{{secret:github_password}}'), 'github_password');
  assert.equal(parseSecretPlaceholder('{{secret:a}}'), 'a');
  assert.equal(parseSecretPlaceholder('{{secret:MY_KEY_1}}'), 'MY_KEY_1');
  assert.equal(parseSecretPlaceholder('{{secret:ns.sub-name}}'), 'ns.sub-name');
});

test('整值要求：前后有内容就不算整值占位符', () => {
  assert.equal(parseSecretPlaceholder('x{{secret:a}}'), null);
  assert.equal(parseSecretPlaceholder('{{secret:a}}x'), null);
  assert.equal(parseSecretPlaceholder(' {{secret:a}}'), null);
  assert.equal(parseSecretPlaceholder('{{secret:a}} '), null);
});

test('普通文本返回 null', () => {
  for (const s of ['', 'password', '{{secret}}', '{{secret:}}', 'secret:a', '{{ secret:a }}']) {
    assert.equal(parseSecretPlaceholder(s), null, `应返回 null: ${JSON.stringify(s)}`);
  }
});

test('非法字符的密钥名被拒绝', () => {
  assert.equal(parseSecretPlaceholder('{{secret:a b}}'), null);
  assert.equal(parseSecretPlaceholder('{{secret:a/b}}'), null);
  assert.equal(parseSecretPlaceholder('{{secret:a$b}}'), null);
  assert.equal(parseSecretPlaceholder('{{secret:中文}}'), null);
});

test('不抛异常（异常输入）', () => {
  for (const s of ['{{', '}}', '{{secret:', '{{secret:a}}}', '{{{secret:a}}}']) {
    assert.doesNotThrow(() => parseSecretPlaceholder(s));
  }
});

/* ─────────────────── containsSecretPlaceholder ─────────────────── */

test('自由文本中混入的占位符能被检出', () => {
  assert.equal(containsSecretPlaceholder('Bearer {{secret:token}}'), true);
  assert.equal(containsSecretPlaceholder('{{secret:a}} 和 {{secret:b}}'), true);
  assert.equal(containsSecretPlaceholder('{{secret:a}}'), true);
});

test('无占位符的文本返回 false', () => {
  assert.equal(containsSecretPlaceholder(''), false);
  assert.equal(containsSecretPlaceholder('普通文本'), false);
  assert.equal(containsSecretPlaceholder('{{secret}}'), false);
  assert.equal(containsSecretPlaceholder('{{ secret:a }}'), false);
});

test('containsSecretPlaceholder 比整值匹配更宽松（这是设计意图）', () => {
  const s = '前缀{{secret:k}}后缀';
  assert.equal(parseSecretPlaceholder(s), null, '整值匹配应失败');
  assert.equal(containsSecretPlaceholder(s), true, '包含检测应成功');
});

/* ─────────────────── 正则本身 ─────────────────── */

test('导出的是正则对象且带锚点', () => {
  assert.ok(SECRET_PLACEHOLDER_PATTERN instanceof RegExp);
  assert.equal(SECRET_PLACEHOLDER_PATTERN.source.startsWith('^'), true);
  assert.equal(SECRET_PLACEHOLDER_PATTERN.source.endsWith('$'), true);
});
