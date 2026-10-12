#!/usr/bin/env node
/**
 * 打包成 Chrome Web Store 可上传的 zip。
 *
 * 用 Node 内置 `zlib` 手写 ZIP 容器，不引入 archiver / adm-zip：
 * 发布产物应当只依赖标准库，少一个供应链面。
 *
 * 存储方式选 **deflate**；条目顺序固定（按路径排序）以保证**可复现** ——
 * 同样的源码打两次得到逐字节相同的 zip，便于核对提交物哈希。
 *
 * 用法：node scripts/pack.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const releaseDir = join(root, 'release');

if (!existsSync(join(dist, 'manifest.json'))) {
  process.stderr.write('未找到 dist/manifest.json —— 请先运行 pnpm run build\n');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

/* ─────────────────────── CRC32（ZIP 需要） ─────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ─────────────────────── 收集条目 ─────────────────────── */

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const entries = walk(dist)
  .map((p) => ({ name: relative(dist, p).replace(/\\/g, '/'), abs: p }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/* ─────────────────────── 构造 ZIP ─────────────────────── */

function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

/*
 * 固定时间戳，保证可复现。
 * 用 1980-01-01（DOS 纪元起点）——ZIP 不支持更早的时间。
 */
const FIXED = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
const TIME = dosTime(FIXED);
const DATE = dosDate(FIXED);

const chunks = [];
const central = [];
let offset = 0;

for (const e of entries) {
  const data = readFileSync(e.abs);
  const crc = crc32(data);
  const compressed = deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(e.name, 'utf8');

  // 本地文件头
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // flags: UTF-8 文件名
  local.writeUInt16LE(8, 8); // method: deflate
  local.writeUInt16LE(TIME, 10);
  local.writeUInt16LE(DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra length

  chunks.push(local, nameBuf, compressed);

  // 中央目录项
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4); // version made by
  cd.writeUInt16LE(20, 6); // version needed
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(TIME, 12);
  cd.writeUInt16LE(DATE, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(compressed.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30); // extra
  cd.writeUInt16LE(0, 32); // comment
  cd.writeUInt16LE(0, 34); // disk
  cd.writeUInt16LE(0, 36); // internal attrs
  cd.writeUInt32LE(0, 38); // external attrs
  cd.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([cd, nameBuf]));

  offset += local.length + nameBuf.length + compressed.length;
}

const centralBuf = Buffer.concat(central);

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

const zip = Buffer.concat([...chunks, centralBuf, end]);

/* ─────────────────────── 输出 ─────────────────────── */

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const outPath = join(releaseDir, `bua-extension-v${manifest.version}.zip`);
writeFileSync(outPath, zip);

const sha = createHash('sha256').update(zip).digest('hex');
writeFileSync(`${outPath}.sha256`, `${sha}  bua-extension-v${manifest.version}.zip\n`);

process.stdout.write(`bua: 提交包已生成\n`);
process.stdout.write(`  路径   ${outPath}\n`);
process.stdout.write(`  条目   ${entries.length}\n`);
process.stdout.write(`  大小   ${(zip.length / 1024).toFixed(1)} KB\n`);
process.stdout.write(`  SHA256 ${sha}\n`);
