#!/usr/bin/env node
/**
 * `bua-server` 命令行入口。
 *
 * 用法：
 *   bua-server                  随机端口（推荐，避免与用户已有服务冲突）
 *   bua-server --port 17432     固定端口
 *   bua-server --quiet          只输出错误
 *
 * 刻意**不提供** `--host` —— 桥只绑 `127.0.0.1`，这是本设计中唯一真正的安全边界。
 * 见 `docs/design.md` §4.1 L1。
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Bridge } from './index.js';
import type { AuditRecord } from './index.js';

interface Args {
  port: number;
  quiet: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { port: 0, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--quiet' || a === '-q') {
      args.quiet = true;
    } else if (a === '--port' || a === '-p') {
      const raw = argv[i + 1];
      i += 1;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`--port 需要一个 0..65535 的整数，收到：${String(raw)}`);
      }
      args.port = n;
    } else if (a !== undefined && a.startsWith('--port=')) {
      const n = Number(a.slice('--port='.length));
      if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`--port 需要一个 0..65535 的整数，收到：${a}`);
      }
      args.port = n;
    } else if (a !== undefined && a.startsWith('-')) {
      throw new Error(`未知参数：${a}`);
    }
  }
  return args;
}

const HELP = `bua-server —— BUA 本地桥

用法：
  bua-server [选项]

选项：
  -p, --port <n>   监听端口（0 = 由系统分配空闲端口，默认）
  -q, --quiet      只输出错误
  -h, --help       显示本帮助

说明：
  桥只绑 127.0.0.1，没有 --host 选项。

  ⚠️ 桥不做鉴权：本机任意进程都能连接并驱动你的浏览器。
  这是刻意的设计取舍，详见 docs/design.md §4.0。
`;

function formatAudit(e: AuditRecord): string {
  const time = new Date(e.ts).toISOString().slice(11, 19);
  const mark = e.ok ? '✓' : '✗';
  const risk = e.risk === 'destructive' ? `[${e.risk.toUpperCase()}]` : `[${e.risk}]`;
  const desc = e.targetDescription !== undefined ? ` — ${e.targetDescription}` : '';
  const err = e.errorCode !== undefined ? ` (${e.errorCode})` : '';
  return `${time} ${mark} ${risk} ${e.method}${desc}${err}`;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const log = (level: 'info' | 'warn' | 'error', message: string): void => {
    if (args.quiet && level === 'info') return;
    const prefix = level === 'error' ? 'bua: 错误' : level === 'warn' ? 'bua: 警告' : 'bua:';
    process.stderr.write(`${prefix} ${message}\n`);
  };

  const bridge = new Bridge({
    port: args.port,
    onLog: log,
    onAudit: (entry) => {
      if (!args.quiet) process.stderr.write(`bua: 审计 ${formatAudit(entry)}\n`);
    },
  });

  try {
    const address = await bridge.start();
    process.stdout.write(`bua: 桥已就绪  ${address.url}\n`);
    process.stdout.write('bua: 等待扩展连接…（无鉴权，本机任意进程均可连）\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 端口占用是常见情况，给可操作的提示而不是堆栈
    if (/EADDRINUSE/.test(msg)) {
      log('error', `端口 ${args.port} 已被占用。请换一个端口，或省略 --port 让系统分配。`);
      log('warn', 'BUA 不会强杀占用端口的进程。');
    } else {
      log('error', `启动失败：${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  const shutdown = (signal: string): void => {
    log('info', `收到 ${signal}，正在关闭…`);
    void bridge.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 仅在被直接执行时运行（便于测试 import parseArgs）
// 用 fileURLToPath + path.resolve 规范化后比较 —— 直接在字符串上比 URL 与路径
// 在 Windows 上会因为盘符大小写、正反斜杠而不一致。
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main();
}

export { main };
