#!/usr/bin/env node
/**
 * `bua-mcp` —— stdio 入口。
 *
 * 由 agent（DSH / Claude Code / Codex）作为子进程拉起，通过标准输入输出讲 MCP。
 * 进程本身不做浏览器操作，它把请求转发给本机 BUA 桥。
 *
 * 用法：
 *   bua-mcp                        用默认端口 17432
 *   BUA_BRIDGE_PORT=18000 bua-mcp  换端口（需与扩展一致）
 *   bua-mcp --port 18000
 *   bua-mcp --help
 *
 * ⚠️ **绝不向 stdout 写任何非 MCP 数据。** stdout 是 MCP 的传输通道，
 * 一行日志就会破坏协议帧。所有诊断信息走 stderr。
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createServer, resolvePort } from './index.js';

function parseArgs(argv: readonly string[]): { port?: number; help: boolean } {
  let port: number | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      help = true;
    } else if (a === '--port' || a === '-p') {
      const raw = argv[i + 1];
      i += 1;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        process.stderr.write(`bua-mcp: --port 需要 1..65535 的整数，收到 ${String(raw)}\n`);
        process.exit(2);
      }
      port = n;
    } else if (a !== undefined && a.startsWith('--port=')) {
      const n = Number(a.slice('--port='.length));
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        process.stderr.write(`bua-mcp: --port 需要 1..65535 的整数，收到 ${a}\n`);
        process.exit(2);
      }
      port = n;
    }
  }
  return { ...(port !== undefined ? { port } : {}), help };
}

const HELP = `bua-mcp —— BUA 的 MCP 服务器（stdio）

用法：
  bua-mcp [选项]

选项：
  -p, --port <n>   桥端口（默认 17432，或环境变量 BUA_BRIDGE_PORT）
  -h, --help       显示本帮助

说明：
  本进程由 agent 作为子进程拉起，通过 stdin/stdout 讲 MCP，
  再把请求转发给本机 BUA 桥（ws://127.0.0.1:17432）。

  桥需要单独启动：bua-server

  所有诊断信息走 stderr —— stdout 是 MCP 的传输通道，不能有任何干扰。
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stderr.write(HELP);
  process.exit(0);
}

const port = resolvePort(args);

// 只在 stderr 上报告；stdout 留给 MCP 协议帧
process.stderr.write(`bua-mcp: 已启动，桥端口 ${port}\n`);

serveStdio(
  () => createServer({ port, clientName: 'dsh' }),
  {
    onerror: (err) => {
      process.stderr.write(`bua-mcp: ${err.message}\n`);
    },
  },
);
