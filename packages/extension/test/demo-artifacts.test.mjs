/**
 * 演示产物的端到端校验。
 *
 * 与 `overlay.test.mjs` 的区别：那份测的是模块导出的 `OVERLAY_SCRIPT`；
 * 这份从**实际生成的演示 HTML** 里把 `<script>` 抠出来，在隔离上下文里按
 * 浏览器顺序执行，验证**最终**呈现的状态。
 *
 * 为什么要多这一层：真实页面里是「脚本先以 idle 自初始化，随后业务代码调
 * `set(active)`」。如果后半步没生效，静态测试发现不了 —— 只有按顺序执行
 * 整段脚本才看得出。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, '..', 'dist-demo');

/* ─────────────────────── DOM 桩（与 overlay.test.mjs 同构） ─────────────────────── */

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    children: [],
    attributes: {},
    style: {},
    parent: null,
    setAttribute(n, v) {
      this.attributes[n] = v;
    },
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      return c;
    },
    append(...ns) {
      for (const n of ns) this.appendChild(n);
    },
    remove() {
      if (this.parent !== null) {
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children.splice(i, 1);
        this.parent = null;
      }
    },
    attachShadow() {
      const sr = makeElement('shadow-root');
      this.shadowRoot = sr;
      return sr;
    },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get: () => text,
    set: (v) => {
      text = String(v);
      if (text === '') el.children.length = 0;
    },
    enumerable: true,
  });
  /*
   * isConnected 必须实现 —— 覆盖层用它判断宿主是否仍在文档里，以便在页面
   * 执行 `body.innerHTML = ...` 之后自愈重建。桩里漏掉它会让 overlay 认为
   * 宿主已脱离，从而反复重建、永远读不到光晕。
   */
  Object.defineProperty(el, 'isConnected', {
    get() {
      let n = el;
      while (n.parent !== null && n.parent !== undefined) n = n.parent;
      return n.__isDocumentRoot === true;
    },
    enumerable: true,
  });
  return el;
}

function makeSandbox() {
  const body = makeElement('body');
  const documentElement = makeElement('html');
  documentElement.appendChild(body);
  documentElement.__isDocumentRoot = true; // 连接性的终点
  const sandbox = {
    document: {
      readyState: 'complete',
      body,
      documentElement,
      createElement: makeElement,
      addEventListener: () => {},
      write: (html) => {
        // 演示页用 document.write 注入模拟横幅；桩里忽略即可
        void html;
      },
    },
    location: { search: '' },
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** 从 HTML 里抠出所有 <script> 的内容，拼成一个块。 */
function extractScripts(html) {
  const out = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out.join('\n');
}

function findByClass(root, cls) {
  if (root === undefined || root === null) return null;
  for (const c of root.children ?? []) {
    if (typeof c.className === 'string' && c.className.split(/\s+/).includes(cls)) return c;
    const deeper = findByClass(c, cls);
    if (deeper !== null) return deeper;
  }
  return null;
}

function runDemo(name) {
  const file = join(demoDir, `${name}.html`);
  if (!existsSync(file)) return null;
  const html = readFileSync(file, 'utf8');
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(extractScripts(html), sandbox);
  const host = sandbox.document.body.children.find((c) => c.id === 'bua-edge-glow-host');
  return { sandbox, host, html };
}

/* ─────────────────────── 测试 ─────────────────────── */

const haveDemos = existsSync(join(demoDir, 'active.html'));

test('演示产物存在（需先运行 scripts/demo-overlay.mjs）', { skip: !haveDemos }, () => {
  for (const n of ['active', 'degraded', 'paused']) {
    assert.ok(existsSync(join(demoDir, `${n}.html`)), `缺少 ${n}.html`);
  }
});

test('active 页最终状态是 active，而不是自初始化的 idle', { skip: !haveDemos }, () => {
  const r = runDemo('active');
  assert.ok(r?.host, '应有宿主元素');
  const glow = findByClass(r.host.shadowRoot, 'glow');
  assert.match(glow.style.boxShadow, /59,130,246/, '应为 active 的蓝色');
  assert.doesNotMatch(glow.style.boxShadow, /148,163,184,0\.45/, '不应停留在 idle 的灰');
});

test('active 页徽标文案是「BUA 正在操作」', { skip: !haveDemos }, () => {
  const r = runDemo('active');
  const badge = findByClass(r.host.shadowRoot, 'badge');
  const label = badge.children.find((c) => c.tagName === 'SPAN' && c.className !== 'dot');
  assert.equal(label.textContent, 'BUA 正在操作');
});

test('degraded 页最终状态是 degraded 且带警示行', { skip: !haveDemos }, () => {
  const r = runDemo('degraded');
  const glow = findByClass(r.host.shadowRoot, 'glow');
  assert.match(glow.style.boxShadow, /245,158,11/, '应为琥珀色');

  const warn = findByClass(r.host.shadowRoot, 'warn');
  assert.equal(warn.style.display, 'flex');
  assert.equal(warn.children.length, 2, '应有两条警示');
  const badge = findByClass(r.host.shadowRoot, 'badge');
  const label = badge.children.find((c) => c.tagName === 'SPAN' && c.className !== 'dot');
  assert.equal(label.textContent, 'BUA 降级模式');
});

test('paused 页最终状态是 paused（灰色）', { skip: !haveDemos }, () => {
  const r = runDemo('paused');
  const glow = findByClass(r.host.shadowRoot, 'glow');
  assert.match(glow.style.boxShadow, /148,163,184,0\.78/, '应为 paused 的灰');
});

test('演示页不污染页面其他全局', { skip: !haveDemos }, () => {
  const r = runDemo('active');
  const keys = Object.keys(r.sandbox);
  const overlayKeys = keys.filter((k) => k.startsWith('__BUA'));
  assert.deepEqual(overlayKeys, ['__BUA_OVERLAY__']);
});
