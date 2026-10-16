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
import { deflateSync } from 'node:zlib';
import { watch } from 'node:fs';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outdir = join(root, 'dist');
const watching = process.argv.includes('--watch');

/* ─────────────────────── 图标生成 ─────────────────────── */

/** PNG 的 CRC32。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * 共用品牌图标：蓝色圆角底、浏览器窗口与操作指针。
 * 在同一归一化画布上生成各尺寸，4× 超采样保证工具栏边缘清晰。
 *
 * @param {number} size - 边长（像素）
 */
function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  function roundedRect(x, y, left, top, right, bottom, radius) {
    const dx = Math.max(left + radius - x, 0, x - (right - radius));
    const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
    return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius;
  }
  function polygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const cursor = [[52, 47], [81, 67], [69, 70], [63, 83]];
  function sample(x, y) {
    if (!roundedRect(x, y, 3, 3, 97, 97, 23)) return [0, 0, 0, 0];
    let color = [38 - y * .12, 126 - y * .35, 247 - y * .24, 255];
    if (roundedRect(x, y, 20, 24, 80, 73, 9)) color = [239, 247, 255, 255];
    if (roundedRect(x, y, 26, 39, 74, 67, 3)) color = [20, 65, 131, 255];
    if (y >= 30 && y <= 34 && x >= 28 && x <= 40) color = [93, 155, 235, 255];
    if (polygon(x, y, cursor)) color = [255, 255, 255, 255];
    return color;
  }

  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0; // filter type: none
    p += 1;
    for (let x = 0; x < size; x += 1) {
      const channels = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const color = sample((x + (sx + .5) / 4) * 100 / size, (y + (sy + .5) / 4) * 100 / size);
        for (let c = 0; c < 3; c++) channels[c] += color[c] * color[3] / 255;
        channels[3] += color[3];
      }
      for (let c = 0; c < 3; c++) raw[p + c] = channels[3] ? Math.round(channels[c] * 255 / channels[3]) : 0;
      raw[p + 3] = Math.round(channels[3] / 16);
      p += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
