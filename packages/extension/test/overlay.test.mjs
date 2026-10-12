/**
 * 边缘泛光覆盖层的行为测试。
 *
 * 覆盖层代码是**注入到用户页面里执行的**，所以不能只做静态检查 ——
 * 必须在隔离的 JS 上下文里真正跑一遍，验证：
 * - 注入脚本是合法 JS 且自包含（不引用外部作用域）
 * - 幂等（重复注入不叠加两层光晕）
 * - `set()` 真的写入了 box-shadow（泛光存在）与标签文案
 * - 警示行的显隐逻辑正确
 * - `destroy()` 真的移除宿主元素
 *
 * 用 Node 内置 `node:vm` 跑注入脚本，配一个最小 DOM 桩。不引入 jsdom。
 *
 * 注意：本测试直接 import TypeScript 源码（靠 Node 22+ 的类型擦除），
 * 因此不需要先构建扩展。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { OVERLAY_GLOBAL, OVERLAY_SCRIPT } from '../src/overlay.ts';

/* ─────────────────────── 最小 DOM 桩 ─────────────────────── */

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    children: [],
    attributes: {},
    style: {},
    parent: null,
    removed: false,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    },
    remove() {
      this.removed = true;
      if (this.parent !== null) {
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children.splice(i, 1);
        this.parent = null;
      }
    },
    attachShadow() {
      const sr = makeElement('shadow-root');
      sr.host = this;
      this.shadowRoot = sr;
      return sr;
    },
  };
  // textContent = '' 应清空子节点（真实 DOM 语义）
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get() {
      return text;
    },
    set(v) {
      text = String(v);
      if (text === '') el.children.length = 0;
    },
    enumerable: true,
  });
  return el;
}

function makeSandbox({ readyState = 'complete' } = {}) {
  const body = makeElement('body');
  const documentElement = makeElement('html');
  documentElement.appendChild(body);
  const listeners = [];

  const document = {
    readyState,
    body,
    documentElement,
    createElement: makeElement,
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
  };

  const sandbox = { document, __listeners: listeners, __body: body };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function inject(sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(OVERLAY_SCRIPT, sandbox);
  return sandbox[OVERLAY_GLOBAL];
}

function findHost(body) {
  return body.children.find((c) => c.id === 'bua-edge-glow-host');
}

function findByClass(root, cls) {
  if (root === undefined || root === null) return null;
  for (const c of root.children) {
    if (typeof c.className === 'string' && c.className.split(/\s+/).includes(cls)) return c;
    const deeper = findByClass(c, cls);
    if (deeper !== null) return deeper;
  }
  return null;
}

/** badge 里的文案 span（排除小圆点）。 */
function badgeLabel(host) {
  const badge = findByClass(host.shadowRoot, 'badge');
  return badge.children.find((c) => c.tagName === 'SPAN' && c.className !== 'dot');
}

/* ─────────────────────── 注入与自包含 ─────────────────────── */

test('注入脚本是合法 JS，执行后挂上全局 API', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  assert.equal(typeof api, 'object');
  assert.equal(typeof api.set, 'function');
  assert.equal(typeof api.destroy, 'function');
});

test('document 已就绪时立即建立宿主元素', () => {
  const sandbox = makeSandbox({ readyState: 'complete' });
  inject(sandbox);
  const host = findHost(sandbox.__body);
  assert.ok(host, '应插入宿主元素');
  assert.equal(host.attributes.style, 'all:initial;pointer-events:none');
  assert.ok(host.shadowRoot, '应挂载 shadow root');
});

test('document 仍在加载时推迟到 DOMContentLoaded', () => {
  const sandbox = makeSandbox({ readyState: 'loading' });
  inject(sandbox);
  assert.equal(findHost(sandbox.__body), undefined, '就绪前不应插入');
  assert.equal(sandbox.__listeners.length, 1);
  assert.equal(sandbox.__listeners[0].type, 'DOMContentLoaded');
  sandbox.__listeners[0].fn();
  assert.ok(findHost(sandbox.__body), '就绪后应插入');
});

test('幂等：重复注入不产生第二个宿主元素', () => {
  const sandbox = makeSandbox();
  const api1 = inject(sandbox);
  const api2 = inject(sandbox);
  assert.equal(api1, api2, '第二次注入应返回同一个 API 对象');
  const hosts = sandbox.__body.children.filter((c) => c.id === 'bua-edge-glow-host');
  assert.equal(hosts.length, 1, '只应有一个宿主元素');
});

/* ─────────────────────── set() 行为 ─────────────────────── */

test('set(active) 写入泛光 box-shadow 与标签', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.set({ state: 'active' });

  const host = findHost(sandbox.__body);
  const glow = findByClass(host.shadowRoot, 'glow');
  assert.ok(glow, '应有泛光层');
  assert.ok(glow.style.boxShadow, '必须写入 box-shadow');
  assert.match(glow.style.boxShadow, /inset/);
  assert.equal(glow.style.boxShadow.split('inset').length - 1, 3, '应有 3 层 inset 光晕');
  assert.equal(badgeLabel(host).textContent, 'BUA 正在操作');
});

test('degraded 与 active 的泛光不同（状态可区分）', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.set({ state: 'active' });
  const glow = findByClass(findHost(sandbox.__body).shadowRoot, 'glow');
  const activeShadow = glow.style.boxShadow;

  api.set({ state: 'degraded' });
  assert.notEqual(glow.style.boxShadow, activeShadow, '两种状态应有不同泛光');
  assert.match(glow.style.boxShadow, /245,158,11/, '降级应用琥珀色');
});

test('未知状态回退到 idle 而不是崩溃', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  assert.doesNotThrow(() => api.set({ state: 'nonsense' }));
  assert.equal(badgeLabel(findHost(sandbox.__body)).textContent, 'BUA 待机');
});

test('自定义 label 覆盖默认文案', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.set({ state: 'active', label: '正在填写表单' });
  assert.equal(badgeLabel(findHost(sandbox.__body)).textContent, '正在填写表单');
});

/* ─────────────────────── 警示行 ─────────────────────── */

test('无警示时警示框隐藏', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.set({ state: 'active' });
  const warn = findByClass(findHost(sandbox.__body).shadowRoot, 'warn');
  assert.equal(warn.style.display, 'none');
  assert.equal(warn.children.length, 0);
});

test('有警示时显示并逐行渲染', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.set({
    state: 'degraded',
    warnings: ['⚠ 企业策略拒绝了 CDP，已降级到 chrome.scripting', '截图与真实输入事件不可用'],
  });
  const warn = findByClass(findHost(sandbox.__body).shadowRoot, 'warn');
  assert.equal(warn.style.display, 'flex');
  assert.equal(warn.children.length, 2);
  assert.match(warn.children[0].textContent, /企业策略/);
  assert.match(warn.children[1].textContent, /不可用/);
});

test('警示从有到无会清空并隐藏（不残留旧行）', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.set({ state: 'degraded', warnings: ['⚠ 一', '二'] });
  api.set({ state: 'active' });
  const warn = findByClass(findHost(sandbox.__body).shadowRoot, 'warn');
  assert.equal(warn.style.display, 'none');
  assert.equal(warn.children.length, 0, '不应残留旧警示行');
});

/* ─────────────────────── destroy ─────────────────────── */

test('destroy 移除宿主元素', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  const host = findHost(sandbox.__body);
  api.destroy();
  assert.equal(host.removed, true);
  assert.equal(findHost(sandbox.__body), undefined);
});

test('destroy 后 set 会重新建立（不抛错）', () => {
  const sandbox = makeSandbox();
  const api = inject(sandbox);
  api.destroy();
  assert.doesNotThrow(() => api.set({ state: 'active' }));
  assert.ok(findHost(sandbox.__body), '应重新挂载');
});

/* ─────────────────────── 页面安全契约 ─────────────────────── */

test('宿主元素 pointer-events:none，不拦截页面点击', () => {
  const sandbox = makeSandbox();
  inject(sandbox);
  assert.match(findHost(sandbox.__body).attributes.style, /pointer-events:none/);
});

test('注入脚本自包含：不引用外部作用域变量', () => {
  // 沙箱刻意不提供 console / setTimeout 等 —— 只要脚本引用了任何外部东西就会抛错
  const sandbox = makeSandbox();
  assert.equal(sandbox.console, undefined);
  assert.equal(sandbox.setTimeout, undefined);
  assert.doesNotThrow(() => inject(sandbox));
});

test('注入脚本只挂一个全局键，不污染页面其他全局', () => {
  const sandbox = makeSandbox();
  const before = new Set(Object.keys(sandbox));
  inject(sandbox);
  const added = Object.keys(sandbox).filter((k) => !before.has(k));
  assert.deepEqual(added, [OVERLAY_GLOBAL], `只应新增 ${OVERLAY_GLOBAL}`);
});
