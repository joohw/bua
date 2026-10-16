#!/usr/bin/env node
/**
 * 上架前自检。
 *
 * 逐条验证调研（`research/02-store-policy.md`）里那些**会直接导致拒审**的点。
 * 每一项都对应一条官方政策，注释里写明依据 —— 这样将来政策变化时能快速定位
 * 该改哪一条，而不是对着一份没人知道出处的检查表发呆。
 *
 * 用法：node scripts/preflight.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

/** @type {{id:string, ok:boolean, level:'fail'|'warn', detail:string, basis:string}[]} */
const results = [];

function check(id, ok, detail, basis, level = 'fail') {
  results.push({ id, ok, level: ok ? 'fail' : level, detail, basis });
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(join(dist, 'manifest.json'))) {
  process.stderr.write('未找到 dist/manifest.json —— 请先运行 pnpm run build\n');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const files = walk(dist);

/* ── ① manifest 基本面 ── */

check(
  'manifest-version',
  manifest.manifest_version === 3,
  `manifest_version = ${manifest.manifest_version}`,
  'MV3 是当前唯一可提交的版本',
);

check(
  'min-chrome-version',
  typeof manifest.minimum_chrome_version === 'string',
  `minimum_chrome_version = ${manifest.minimum_chrome_version ?? '(未设置)'}`,
  'flat sessions 跨 OOPIF 需要 Chrome 125+；显式声明可避免旧版装上后行为不一致',
  'warn',
);

/* ── ② 权限：只声明真实使用的 ── */

const MUTATING_PERMS = ['debugger', 'tabs', 'tabGroups', 'storage', 'alarms', 'scripting', 'activeTab'];
const perms = manifest.permissions ?? [];
const extra = perms.filter((p) => !MUTATING_PERMS.includes(p));

check(
  'no-unused-permissions',
  extra.length === 0,
  extra.length === 0 ? `仅声明 ${perms.join(', ')}` : `多出未在白名单内的权限：${extra.join(', ')}`,
  'Purple Potassium：声明了但没真实使用该权限会被拒审',
);

/*
 * ③ host_permissions 必须为空。
 *
 * 官方明文（declare-permissions）："In some special cases, host permissions are
 * not required. These include: ... Interacting with the browser using the
 * chrome.debugger API."
 *
 * 而 debugger 本身已经会让用户看到 "Read and change all your data on all
 * websites" 警告，所以再申请 host permission 是纯冗余，只会触发
 * broad-host-permission 深度审查。
 */
const hostPerms = manifest.host_permissions ?? [];
const optionalHostPerms = manifest.optional_host_permissions ?? [];
check(
  'no-host-permissions',
  hostPerms.length === 0,
  hostPerms.length === 0 ? 'host_permissions 为空' : `不应申请：${hostPerms.join(', ')}`,
  'chrome.debugger 不需要 host permission；多申请会触发 broad-host-permission 审查',
);
check(
  'no-optional-host-permissions',
  optionalHostPerms.length === 0,
  optionalHostPerms.length === 0 ? '未使用 optional_host_permissions' : `${optionalHostPerms.length} 项`,
  '既然不需要 host permission，optional 形式同样多余',
  'warn',
);

/* ── ④ 远程代码：不得有指向远端的 import/script ── */

const REMOTE_PATTERNS = [
  { re: /\bimport\s*\(\s*["'`]https?:\/\//, what: '动态 import 远端 URL' },
  { re: /\bfrom\s*["'`]https?:\/\//, what: '静态 import 远端 URL' },
  { re: /<script[^>]+src\s*=\s*["'`]https?:\/\//i, what: '外部 script 标签' },
  { re: /\beval\s*\(/, what: 'eval()' },
  { re: /new\s+Function\s*\(/, what: 'new Function()' },
];

const remoteHits = [];
for (const f of files) {
  if (!/\.(js|html)$/.test(f)) continue;
  const text = readFileSync(f, 'utf8');
  for (const { re, what } of REMOTE_PATTERNS) {
    if (re.test(text)) remoteHits.push(`${relative(dist, f)}: ${what}`);
  }
}
check(
  'no-remote-code',
  remoteHits.length === 0,
  remoteHits.length === 0 ? '未发现远端代码或动态求值' : remoteHits.join('; '),
  'Blue Argon（RHC）：打包产物里不得有从远端加载或求值的代码',
);

/* ── ⑤ CSP ── */

const csp = manifest.content_security_policy?.extension_pages ?? '';
check(
  'csp-locked',
  csp.includes("script-src 'self'") && !csp.includes('unsafe-eval'),
  csp === '' ? '(未设置，将使用默认 CSP)' : csp,
  'MV3 要求 CSP 不含 unsafe-eval；显式声明更清晰',
  'warn',
);

/* ── ⑥ 必需文件齐全 ── */

const required = ['manifest.json', 'background.js', 'onboarding.html', 'onboarding.js', 'logs.html', 'logs.js'];
const missing = required.filter((f) => !existsSync(join(dist, f)));
check(
  'required-files',
  missing.length === 0,
  missing.length === 0 ? `必需文件齐全（${files.length} 个文件）` : `缺少：${missing.join(', ')}`,
  '扩展无法加载或审核无法走通同意流程',
);

check(
  'icons-present',
  [16, 32, 48, 128].every((s) => existsSync(join(dist, 'icons', `icon-${s}.png`))),
  [16, 32, 48, 128].filter((s) => !existsSync(join(dist, 'icons', `icon-${s}.png`))).join(', ') || '四个尺寸齐全',
  '商店要求 128×128 图标；其余尺寸影响工具栏与商店列表观感',
);

/* ── ⑦ 单用途描述长度（官方要求 narrow and easy to understand） ── */

const desc = manifest.description ?? '';
check(
  'description-length',
  desc.length > 0 && desc.length <= 132,
  `${desc.length} 字符（商店上限 132）`,
  '商店 description 字段硬上限 132 字符',
);

/* ── 输出 ── */

const failed = results.filter((r) => !r.ok && r.level === 'fail');
const warned = results.filter((r) => !r.ok && r.level === 'warn');

const mark = (r) => (r.ok ? '✅' : r.level === 'fail' ? '❌' : '⚠️ ');
process.stdout.write('\nBUA 上架前自检\n' + '─'.repeat(72) + '\n');
for (const r of results) {
  process.stdout.write(`${mark(r)} ${r.id.padEnd(26)} ${r.detail}\n`);
  if (!r.ok) process.stdout.write(`   ${' '.repeat(26)} 依据：${r.basis}\n`);
}
process.stdout.write('─'.repeat(72) + '\n');
process.stdout.write(
  failed.length === 0
    ? `通过${warned.length > 0 ? `（${warned.length} 项提醒）` : ''}\n`
    : `${failed.length} 项必须修复，${warned.length} 项提醒\n`,
);

process.exit(failed.length === 0 ? 0 : 1);
