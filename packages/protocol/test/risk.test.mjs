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
  looksDestructive,
  ACTION_RISK_STRENGTH,
  DESTRUCTIVE_METHODS,
  READ_ONLY_METHODS,
} from '../dist/index.js';

/* ─────────────────── 基本分类 ─────────────────── */

test('只读方法判为 read', () => {
  for (const m of [
    'tab.screenshot',
    'tabs.list',
    'ax.get',
    'playwright.domSnapshot',
    'dom_cua.get_visible_dom',
    'blob.get',
    // 这两条是实机测试暴露的误判：evaluate 是首选读取机制，导航没有页面副作用
    'playwright.evaluate',
    'locator.evaluate',
    'tabs.new',
    'tab.back',
    'tab.forward',
    'tab.reload',
  ]) {
    assert.equal(classifyRisk(m), 'read', `${m} 应为 read`);
  }
});

test('交互方法判为 write', () => {
  for (const m of [
    'locator.click',
    'locator.fill',
    'cua.click',
    'tab.goto',
    'ax.typeText',
    'locator.downloadMedia',
    'content.export',
    'ax.paste',
    'tab.close',
  ]) {
    assert.equal(classifyRisk(m), 'write', `${m} 应为 write`);
  }
});

test('DESTRUCTIVE_METHODS 当前为空（方法名无法可靠判定破坏性）', () => {
  assert.equal(DESTRUCTIVE_METHODS.size, 0);
  // 空集合是**刻意的**：曾经的候选要么只是触发下载、要么只是导航、
  // 要么是向页面输入文本 —— 都不构成「不可逆」。真正的破坏性靠
  // looksDestructive 从描述里做启发式识别。
});

/* ─────────────────── 保守默认（关键） ─────────────────── */

test('未知方法保守地归为 write，不落进 read', () => {
  for (const m of ['bua.futureMethod', 'locator.someNewThing', '', 'x']) {
    assert.equal(classifyRisk(m), 'write', `未知方法 ${JSON.stringify(m)} 应为 write`);
  }
});

/* ─────────────────── 破坏性意图的启发式识别 ─────────────────── */

test('识别中文破坏性意图', () => {
  const cases = [
    '确认支付 ¥299',
    '结算按钮（￥299，含运费）',
    '提交订单',
    '删除这条记录',
    '发送消息',
    '上传附件',
    '立即购买',
  ];
  for (const c of cases) {
    assert.equal(looksDestructive(c).destructive, true, `应命中：${c}`);
  }
});

test('识别英文破坏性意图', () => {
  for (const c of ['Checkout', 'Delete account', 'Submit payment', 'Place order']) {
    assert.equal(looksDestructive(c).destructive, true, `应命中：${c}`);
  }
});

test('金额本身是强信号', () => {
  assert.equal(looksDestructive('按钮（$1,299.00）').destructive, true);
  assert.equal(looksDestructive('金额 500 usd').destructive, true);
});

test('中性描述不误报', () => {
  for (const c of ['下一页', '搜索框', '登录按钮', '导航栏「文档」链接', '展开详情', '排序：价格从低到高']) {
    assert.equal(looksDestructive(c).destructive, false, `不应命中：${c}`);
  }
});

test('返回命中的模式，便于审计解释', () => {
  const s = looksDestructive('确认支付 ¥299');
  assert.equal(s.destructive, true);
  assert.ok(s.matches.length >= 1);
  assert.ok(s.matches.some((m) => /支付|¥/.test(m)), `命中项应可读：${JSON.stringify(s.matches)}`);
});

test('空/未定义描述不算破坏性', () => {
  assert.equal(looksDestructive(undefined).destructive, false);
  assert.equal(looksDestructive('').destructive, false);
  assert.equal(looksDestructive('   ').destructive, false);
});

test('已知局限：这是启发式，会被绕过（记录而非假装能防）', () => {
  // agent 只要不写敏感词就绕过了。这里把局限固化成用例，
  // 防止有人误以为它是安全边界。
  assert.equal(looksDestructive('点一下那个按钮').destructive, false);
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

test('只读集合规模合理', () => {
  assert.ok(READ_ONLY_METHODS.size >= 30, `只读方法偏少：${READ_ONLY_METHODS.size}`);
});
