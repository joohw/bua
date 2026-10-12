/**
 * 生成边缘泛光的视觉预览页。
 *
 * 关键：使用**生产代码里的 OVERLAY_SCRIPT**（从 test 里同样的源码 import），
 * 不重写一份 CSS —— 否则预览就失去意义了。
 *
 * 页面同时模拟 Chrome 的调试横幅（那条黄色通知），以便判断泛光与横幅
 * 叠在一起时的观感。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OVERLAY_SCRIPT } from '../src/overlay.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'dist-demo');
mkdirSync(out, { recursive: true });

/** 一个假装是真实网站的页面。 */
function pageBody(title, paragraphs) {
  return `
  <header class="site">
    <div class="brand">示例站点</div>
    <nav><a href="#">首页</a><a href="#">文档</a><a href="#">定价</a></nav>
  </header>
  <main>
    <h1>${title}</h1>
    ${paragraphs.map((p) => `<p>${p}</p>`).join('\n')}
    <form onsubmit="return false">
      <label>收货地址 <input type="text" value="北京市朝阳区示例路 1 号"></label>
      <label>联系电话 <input type="tel" value="138****0000"></label>
      <button type="submit">提交订单</button>
    </form>
    <p class="note">下方是模拟的 Chrome 调试横幅，用于判断泛光与它叠在一起时的观感。</p>
  </main>`;
}

const SITE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.7 ui-sans-serif, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         color: #0f172a; background: #fff; }
  .site { display: flex; justify-content: space-between; align-items: center;
          padding: 14px 32px; border-bottom: 1px solid #e2e8f0; }
  .brand { font-weight: 700; letter-spacing: .01em; }
  nav a { margin-left: 18px; color: #475569; text-decoration: none; font-size: 14px; }
  main { max-width: 720px; margin: 0 auto; padding: 36px 32px 80px; }
  h1 { font-size: 26px; margin: 0 0 18px; }
  p { color: #334155; }
  form { margin: 28px 0; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; }
  label { display: block; margin-bottom: 14px; font-size: 13px; color: #475569; }
  input { display: block; width: 100%; margin-top: 6px; padding: 9px 11px;
          border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
  button { padding: 10px 20px; border: 0; border-radius: 9px; background: #2563eb;
           color: #fff; font: 600 14px/1 inherit; cursor: pointer; }
  .note { margin-top: 34px; font-size: 13px; color: #94a3b8; }
`;

/** 模拟 Chrome 的调试横幅。 */
const BANNER = `
  <div class="fake-debug-banner">
    <span class="ico">ⓘ</span>
    <span>BUA — Browser Use Agent 已开始调试此浏览器</span>
    <span class="x">✕</span>
  </div>`;

const BANNER_CSS = `
  .fake-debug-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
    display: flex; align-items: center; gap: 10px;
    padding: 9px 16px;
    background: #fef3c7; border-bottom: 1px solid #fcd34d; color: #78350f;
    font: 500 13px/1.4 ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
    /* 注意：真实 Chrome 横幅会把页面往下推，这里仅作视觉模拟 */
    pointer-events: none;
  }
  .fake-debug-banner .ico { font-size: 15px; }
  .fake-debug-banner .x { margin-left: auto; opacity: .6; }
`;

function buildHtml({ title, overlayState, label, warnings, paragraphs }) {
  const overlayCall = `globalThis.__BUA_OVERLAY__.set(${JSON.stringify({
    state: overlayState,
    ...(label !== undefined ? { label } : {}),
    ...(warnings !== undefined ? { warnings } : {}),
  })});`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${SITE_CSS}${BANNER_CSS}</style>
</head>
<body>
<script>
// ?nobanner 时去掉模拟横幅，用于单独检查徽标与警示行的渲染
if (!location.search.includes('nobanner')) {
  document.write(${JSON.stringify(BANNER)});
}
</script>
${pageBody(title, paragraphs)}
<script>
${OVERLAY_SCRIPT}
${overlayCall}
</script>
</body>
</html>`;
}

const CASES = [
  {
    file: 'active.html',
    title: '泛光：active（蓝）',
    overlayState: 'active',
    paragraphs: [
      'Agent 正在操作这个标签页。边缘的蓝色泛光会持续脉动，底部居中显示状态胶囊。',
      '泛光用 closed Shadow DOM 注入，页面 CSS 影响不到它，它也影响不到页面。',
      '覆盖层是 pointer-events: none —— 视觉上存在，交互上完全透明，不挡任何点击。',
      '状态胶囊放在底部而不是顶部：顶部是页面导航、通知条与聊天组件的密集区，放那里会遮挡内容。',
    ],
  },
  {
    file: 'degraded.html',
    title: '泛光：degraded（琥珀 + 警示）',
    overlayState: 'degraded',
    warnings: [
      '⚠ 企业策略拒绝了 CDP，已降级到 chrome.scripting 模式',
      '真实输入事件、截图与跨 iframe 一致控制不可用',
    ],
    paragraphs: [
      '这个状态出现在 Chrome 155+ 的受管浏览器上：管理员配置了 runtime_blocked_hosts、',
      'DisableScreenshots 或 DLP 规则时，chrome.debugger.attach() 会在所有目标上失败，',
      '且无法用 runtime_allowed_hosts 绕过。此时扩展降级到 chrome.scripting 并在能力里如实声明。',
    ],
  },
  {
    file: 'paused.html',
    title: '泛光：paused（灰）',
    overlayState: 'paused',
    paragraphs: ['用户暂停了 agent，泛光转为中性灰色，不脉动。'],
  },
];

for (const c of CASES) {
  writeFileSync(join(out, c.file), buildHtml(c), 'utf8');
}

process.stdout.write(`bua: 预览页已生成 → ${out}\n`);
for (const c of CASES) process.stdout.write(`  ${c.file}\n`);
