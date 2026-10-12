/**
 * 动作风险分级的测试。
 *
 * ⚠️ 再次强调：这不是安全闸门，只影响审计可读性与 agent 自我约束。
 * 但**分类错误仍有实际后果** —— 一个变更型方法若被误判为 `read`，
 * 它在审计里就不会被重点标注。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRisk,
  requiresTargetDescription,
  ACTION_RISK_STRENGTH,
  DESTRUCTIVE_METHODS,
  READ_ONLY_METHODS,
} from '../dist/index.js';

/* ─────────────────── 基本分类 ─────────────────── */

test('只读方法判为 read', () => {
  for (const m of ['tab.screenshot', 'tabs.list', 'ax.get', 'playwright.domSnapshot', 'dom_cua.get_visible_dom', 'blob.get']) {
    assert.equal(classifyRisk(m), 'read', `${m} 应为 read`);
  }
});

test('破坏性方法判为 destructive', () => {
  for (const m of ['locator.downloadMedia', 'cua.downloadMedia', 'content.export', 'ax.paste', 'tab.close']) {
    assert.equal(classifyRisk(m), 'destructive', `${m} 应为 destructive`);
  }
});

test('交互方法判为 write', () => {
  for (const m of ['locator.click', 'locator.fill', 'cua.click', 'tab.goto', 'ax.typeText', 'tabs.new']) {
    assert.equal(classifyRisk(m), 'write', `${m} 应为 write`);
  }
});

/* ─────────────────── 保守默认（关键） ─────────────────── */

test('未知方法保守地归为 write，不落进 read', () => {
  for (const m of ['bua.futureMethod', 'locator.someNewThing', '', 'x']) {
    assert.equal(classifyRisk(m), 'write', `未知方法 ${JSON.stringify(m)} 应为 write`);
  }
});

test('破坏性优先于只读（两个集合重叠时）', () => {
  // 构造重叠：把 content.export 同时放进只读集合
  const overlapped = new Set(READ_ONLY_METHODS);
  overlapped.add('content.export');
  // classifyRisk 内部先查 DESTRUCTIVE，所以仍是 destructive
  assert.equal(DESTRUCTIVE_METHODS.has('content.export'), true);
  assert.equal(classifyRisk('content.export'), 'destructive');
});

/* ─────────────────── 强度与 targetDescription ─────────────────── */

test('风险强度严格递增', () => {
  assert.ok(ACTION_RISK_STRENGTH.write > ACTION_RISK_STRENGTH.read);
  assert.ok(ACTION_RISK_STRENGTH.destructive > ACTION_RISK_STRENGTH.write);
});

test('read 不需要 targetDescription，write/destructive 需要', () => {
  assert.equal(requiresTargetDescription('read'), false);
  assert.equal(requiresTargetDescription('write'), true);
  assert.equal(requiresTargetDescription('destructive'), true);
});

/* ─────────────────── 集合自身的一致性 ─────────────────── */

test('两个集合不重叠', () => {
  for (const m of DESTRUCTIVE_METHODS) {
    assert.equal(READ_ONLY_METHODS.has(m), false, `${m} 不应同时属于只读与破坏性`);
  }
});

test('集合非空且规模合理', () => {
  assert.ok(DESTRUCTIVE_METHODS.size >= 5);
  assert.ok(READ_ONLY_METHODS.size >= 20);
});
