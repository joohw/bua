#!/usr/bin/env node
/**
 * BUA 扩展构建脚本。
 *
 * 产物结构（可直接 `chrome://extensions` → 加载已解压的扩展程序）：
 *
 * ```
 * dist/
 * ├── manifest.json
 * ├── background.js        打包后的 service worker
 * ├── onboarding.html      引导页（权限说明 + 风险告知 + 主动同意）
 * ├── onboarding.js
 * └── icons/icon-*.png
 * ```
 *
 * 图标用 Node 内置 `zlib` 现场生成 PNG —— 不引入图像库，也不往仓库里塞二进制。
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIcon } from './icon.mjs';
import { watch } from 'node:fs';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outdir = join(root, 'dist');
const watching = process.argv.includes('--watch');

/* ─────────────────────── 构建 ─────────────────────── */

async function main() {
  // Watch 时保持已加载的目录完整，避免 Chrome 读到被删除的 manifest。
  if (!watching) await rm(outdir, { recursive: true, force: true });
  await mkdir(join(outdir, 'icons'), { recursive: true });

  // ① 打包 service worker 与设置页
  await build({
    entryPoints: {
      background: join(root, 'src/background.ts'),
      onboarding: join(root, 'src/onboarding.ts'),
      logs: join(root, 'src/logs.ts'),
    },
    outdir,
    bundle: true,
    format: 'esm',
    target: 'chrome125',
    platform: 'browser',
    sourcemap: watching ? 'inline' : false,
    minify: false, // 保持可读：上架审核要能读懂代码，也是 MV3 政策要求
    legalComments: 'none',
    logLevel: 'info',
  });

  // ② 静态资源
  await writeFile(join(outdir, 'manifest.json'), await readFile(join(root, 'manifest.json')));
  for (const page of ['onboarding', 'logs']) {
    await writeFile(
      join(outdir, `${page}.html`),
      await readFile(join(root, `src/${page}.html`)),
    );
  }

  // 与官网共用排版、色板和本地字体；扩展页面不依赖远端资源。
  const website = resolve(root, '../../docs');
  await mkdir(join(outdir, 'assets/fonts'), { recursive: true });
  await writeFile(join(outdir, 'website.css'), await readFile(join(website, 'styles.css')));
  for (const file of ['outfit-latin.woff2', 'OFL.txt']) {
    await writeFile(join(outdir, 'assets/fonts', file), await readFile(join(website, 'assets/fonts', file)));
  }
  for (const file of ['settings.svg', 'LUCIDE-LICENSE']) {
    await writeFile(join(outdir, 'icons', file), await readFile(join(root, 'src/icons', file)));
  }

  // ③ 图标
  for (const size of [16, 32, 48, 128]) {
    await writeFile(join(outdir, `icons/icon-${size}.png`), makeIcon(size));
  }

  process.stdout.write(`bua: 扩展已构建 → ${outdir}\n`);
  process.stdout.write('bua: 在 chrome://extensions 打开开发者模式，加载已解压的扩展程序\n');
}

await main();

if (watching) {
  let timer;
  let building = false;
  let pending = false;
  async function rebuild() {
    if (building) { pending = true; return; }
    building = true;
    try {
      await main();
      process.stdout.write('bua: 更新完成。选项页请刷新；后台或 manifest 改动请重新加载扩展。\n');
    } catch (error) {
      console.error('bua: 构建失败，修正源码后会自动重试。', error);
    } finally {
      building = false;
      if (pending) { pending = false; void rebuild(); }
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { void rebuild(); }, 150);
  }
  const watchers = [
    watch(join(root, 'src'), { recursive: true }, schedule),
    watch(join(root, 'manifest.json'), schedule),
    watch(resolve(root, '../../docs/styles.css'), schedule),
    watch(resolve(root, '../../docs/assets/fonts'), schedule),
    watch(resolve(root, '../protocol/src'), { recursive: true }, schedule),
  ];
  for (const watcher of watchers) watcher.on('error', (error) => {
    console.error('bua: 文件监听失败，请重新启动 dev。', error);
    process.exitCode = 1;
    for (const item of watchers) item.close();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  });
  process.stdout.write(`bua: 开发监听已启动 → ${outdir}\n`);
}
