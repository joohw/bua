/**
 * DSH 组合包的自检。
 *
 * 组合包本身**不含代码**，所以能出错的地方都是配置与资源。这个测试逐项验证
 * DSH 的 `install_bundle` 会读的东西 —— 尤其是那条**绝对路径**：它在换机器或
 * 移动仓库后会失效，而症状是「插件装上了但工具一个都不出现」，极难排查。
 * 让它在测试里直接失败，比让用户去猜要好。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundleDir = resolve(here, '..');
const repoRoot = resolve(bundleDir, '..', '..');

const read = (p) => readFileSync(join(bundleDir, p), 'utf8');

/* ─────────────────────── manifest ─────────────────────── */

test('package.json 声明了 dsh.bundle.patch 且指向存在的文件', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(typeof pkg.name, 'string');
  assert.ok(pkg.name.length > 0);
  assert.equal(typeof pkg.version, 'string');

  const patch = pkg.dsh?.bundle?.patch;
  assert.equal(typeof patch, 'string', '必须声明 dsh.bundle.patch，否则 DSH 不认它是组合包');
  assert.ok(existsSync(join(bundleDir, patch)), `patch 文件不存在：${patch}`);
});

test('manifest 导出了 locale 与 icon（DSH 读展示元信息靠这两个出口）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.exports?.['./locale/*.json'], './locale/*.json');
  assert.equal(pkg.exports?.['./icon'], './icon.svg');
});

test('files 覆盖 patch、locale 与 icon', () => {
  const pkg = JSON.parse(read('package.json'));
  const files = pkg.files ?? [];
  assert.ok(files.includes('cordis.patch.yml'), 'files 应包含 cordis.patch.yml');
  assert.ok(files.includes('icon.svg'), 'files 应包含 icon.svg');
  assert.ok(
    files.some((f) => f.startsWith('locale/')),
    'files 应包含 locale/',
  );
});

/* ─────────────────────── cordis patch ─────────────────────── */

test('patch 插入的是已随 DSH 交付的 mcp-client 行', () => {
  const patch = read('cordis.patch.yml');
  assert.match(patch, /@deepseek-ai\/dsh-mcp-client/, '应插入已交付的 MCP 客户端');
  assert.match(patch, /serverName:\s*bua/, 'serverName 决定工具前缀 mcp__bua__*');
  assert.match(patch, /transport:\s*stdio/);
  assert.match(patch, /command:\s*node/);
});

test('patch 里的 args 指向真实存在的 stdio.js —— 这条路径最容易因移动仓库而失效', () => {
  const patch = read('cordis.patch.yml');
  const m = /args:\s*\n\s*-\s*(.+)/.exec(patch);
  assert.ok(m !== null, 'patch 应声明 args');

  const declared = m[1].trim();
  assert.ok(
    declared.endsWith('stdio.js'),
    `args 应指向 stdio.js，实际：${declared}`,
  );

  // 换成当前正斜杠路径再判断，兼容两种分隔符
  const normalized = declared.replace(/\\/g, '/');
  assert.ok(
    existsSync(normalized),
    [
      `patch 里声明的路径不存在：${declared}`,
      '',
      '这会导致插件安装成功但一个工具都不出现。请先构建 MCP 包，再把路径更新为：',
      `  ${join(repoRoot, 'packages', 'mcp', 'dist', 'stdio.js')}`,
    ].join('\n'),
  );

  const size = statSync(normalized).size;
  assert.ok(size > 500, `stdio.js 过小（${size} 字节），可能未正确构建`);
});

test('failOnStartupError 为 false —— 桥没起时不该阻断启动', () => {
  const patch = read('cordis.patch.yml');
  // 桥需要用户单独启动；若这里为 true，用户没起桥时整个插件激活会被拒
  assert.match(patch, /failOnStartupError:\s*false/);
});

test('patch 里不含未加引号的 !!js（该字段在 command/args 上不生效）', () => {
  const patch = read('cordis.patch.yml');
  const lines = patch.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const l of lines) {
    if (l.includes('!!js')) {
      assert.ok(
        /^\s*(env|headers):/.test(l) || !/command|args/.test(l),
        `!!js 只在 env / headers 上受支持，不应出现在 command/args 行：${l}`,
      );
    }
  }
});

/* ─────────────────────── 展示元信息 ─────────────────────── */

test('en 与 zh 两个 locale 都提供了 meta.title 与 meta.description', () => {
  for (const lang of ['en', 'zh']) {
    const file = join(bundleDir, 'locale', `${lang}.json`);
    assert.ok(existsSync(file), `缺少 locale/${lang}.json`);
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(typeof meta.meta?.title, 'string', `${lang}: 缺少 meta.title`);
    assert.ok(meta.meta.title.length > 0, `${lang}: meta.title 为空`);
    assert.equal(typeof meta.meta?.description, 'string', `${lang}: 缺少 meta.description`);
    assert.ok(
      meta.meta.description.length >= 20,
      `${lang}: 描述过短，插件列表里说明不了能力`,
    );
    // 不要留模板里的示例文案
    assert.doesNotMatch(meta.meta.title, /demo|example|示例/i);
  }
});

test('两种语言的 title 不同（确实做了本地化，而不是复制同一份）', () => {
  const en = JSON.parse(readFileSync(join(bundleDir, 'locale', 'en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(join(bundleDir, 'locale', 'zh.json'), 'utf8'));
  assert.notEqual(en.meta.title, zh.meta.title, '中英文标题不该完全相同');
});

/* ─────────────────────── 图标 ─────────────────────── */

test('icon.svg 存在、是合法 SVG、且体积在 DSH 的上限内', () => {
  const p = join(bundleDir, 'icon.svg');
  assert.ok(existsSync(p), '缺少 icon.svg');
  const svg = readFileSync(p, 'utf8');

  assert.match(svg, /<svg[\s>]/, '应是 SVG');
  assert.match(svg, /viewBox=/, '应有 viewBox，否则缩放行为不可控');
  assert.match(svg, /<\/svg>\s*$/, 'SVG 应闭合');

  // DSH 文档：图标最大 256 KiB
  const bytes = Buffer.byteLength(svg, 'utf8');
  assert.ok(bytes < 256 * 1024, `图标过大：${bytes} 字节`);

  // 必须自包含：不得引用外部资源（绝对路径、URL、符号链接都被拒）
  assert.doesNotMatch(svg, /xlink:href\s*=\s*["']https?:/i, '不应引用外部资源');
  assert.doesNotMatch(svg, /<image[\s>]/i, '不应内嵌外部图片');
});

/* ─────────────────────── 与仓库其他部分的一致性 ─────────────────────── */

test('patch 里声明的端口与扩展硬编码的端口一致', () => {
  const patch = read('cordis.patch.yml');
  const portMatch = /BUA_BRIDGE_PORT:\s*'?(\d+)'?/.exec(patch);
  assert.ok(portMatch !== null, 'patch 应声明 BUA_BRIDGE_PORT');
  const port = portMatch[1];

  const bg = readFileSync(
    join(repoRoot, 'packages', 'extension', 'src', 'background.ts'),
    'utf8',
  );
  const extPort = /const BRIDGE_PORT = (\d+)/.exec(bg);
  assert.ok(extPort !== null, '扩展应硬编码 BRIDGE_PORT');
  assert.equal(
    port,
    extPort[1],
    `端口不一致：组合包 ${port} vs 扩展 ${extPort[1]}。两边必须相同，否则永远连不上。`,
  );
});
