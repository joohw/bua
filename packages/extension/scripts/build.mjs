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
 * ├── popup.html           工具栏弹窗（连接状态 + 操作流水）
 * ├── popup.js
 * └── icons/icon-*.png
 * ```
 *
 * 图标用 Node 内置 `zlib` 现场生成 PNG —— 不引入图像库，也不往仓库里塞二进制。
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outdir = join(root, 'dist');

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
 * 生成一个图标：深色圆角底 + 蓝色边缘泛光，呼应扩展的核心视觉。
 *
 * @param {number} size - 边长（像素）
 */
function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2;
  const ringWidth = Math.max(1, size * 0.13);

  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0; // filter type: none
    p += 1;
    for (let x = 0; x < size; x += 1) {
      const dist = Math.hypot(x - cx, y - cy);
      let r = 15;
      let g = 23;
      let b = 42;
      let a = 255;

      if (dist > radius) {
        a = 0; // 圆形裁切
      } else {
        // 边缘泛光：越靠外越亮、越偏蓝
        const edge = Math.max(0, dist - (radius - ringWidth * 2)) / (ringWidth * 2);
        if (edge > 0) {
          const t = Math.min(1, edge);
          r = Math.round(15 + (59 - 15) * t);
          g = Math.round(23 + (130 - 23) * t);
          b = Math.round(42 + (246 - 42) * t);
        }
        // 中心一个亮点，让图标在小尺寸下也认得出
        if (dist < size * 0.16) {
          r = 96;
          g = 165;
          b = 250;
        }
      }

      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
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
  await rm(outdir, { recursive: true, force: true });
  await mkdir(join(outdir, 'icons'), { recursive: true });

  // ① 打包 service worker 与两个页面脚本
  await build({
    entryPoints: {
      background: join(root, 'src/background.ts'),
      onboarding: join(root, 'src/onboarding.ts'),
      popup: join(root, 'src/popup.ts'),
    },
    outdir,
    bundle: true,
    format: 'esm',
    target: 'chrome125',
    platform: 'browser',
    sourcemap: false,
    minify: false, // 保持可读：上架审核要能读懂代码，也是 MV3 政策要求
    legalComments: 'none',
    logLevel: 'info',
  });

  // ② 静态资源
  await writeFile(join(outdir, 'manifest.json'), await readFile(join(root, 'manifest.json')));
  for (const page of ['onboarding', 'popup']) {
    await writeFile(
      join(outdir, `${page}.html`),
      await readFile(join(root, `src/${page}.html`)),
    );
  }

  // ③ 图标
  for (const size of [16, 32, 48, 128]) {
    await writeFile(join(outdir, `icons/icon-${size}.png`), makeIcon(size));
  }

  process.stdout.write(`bua: 扩展已构建 → ${outdir}\n`);
  process.stdout.write('bua: 在 chrome://extensions 打开开发者模式，加载已解压的扩展程序\n');
}

await main();
