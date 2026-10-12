/**
 * 传输层校验 —— 桥唯一保留的防线。
 *
 * ⚠️ **这里校验的是「浏览器发起的攻击」，不是「本机进程」。**
 *
 * BUA 不限制 agent（见 `docs/design.md` §4.0），所以本机任意进程都能连桥 ——
 * 这是刻意的。但**用户浏览器里的恶意页面**不该能连上：那会让一个普通网页
 * （通过 DNS rebinding 或直接发包）获得操控浏览器的能力。
 *
 * 两道校验都只针对「网页发起」这一威胁，不限制任何本地 agent：
 *
 * 1. **`Origin` 校验** —— 允许缺失（本机非浏览器客户端，如 SDK / CLI），
 *    或 `chrome-extension://`（扩展）。**拒绝一切 `http(s)://` origin**，
 *    即任何网页。这是比 `Host` 更硬的一道，因为浏览器**总是**带 `Origin`，
 *    而 `Host` 只反映连接目标。
 * 2. **`Host` 校验** —— 只接受回环主机名。挡 DNS rebinding 的经典场景。
 */

import type { IncomingMessage } from 'node:http';

/** 回环主机名白名单。刻意不含通配、不含私有网段。 */
const LOOPBACK_HOSTNAMES = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
]);

export type HostCheckResult =
  | { ok: true }
  | { ok: false; reason: 'bad-host'; detail: string }
  | { ok: false; reason: 'bad-origin'; detail: string };

/**
 * 拆 `Host` 头为 hostname 与 port。
 * 支持 `host:port`、`[::1]:port`、`[::1]`、`host` 四种形态。
 */
export function parseHostHeader(host: string): { hostname: string; port: string | null } {
  const trimmed = host.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) return { hostname: trimmed.toLowerCase(), port: null };
    const hostname = trimmed.slice(0, end + 1).toLowerCase();
    const rest = trimmed.slice(end + 1);
    return { hostname, port: rest.startsWith(':') ? rest.slice(1) : null };
  }
  const idx = trimmed.lastIndexOf(':');
  // 没有冒号，或冒号在开头（非法）→ 整体当主机名
  if (idx <= 0) return { hostname: trimmed.toLowerCase(), port: null };
  return {
    hostname: trimmed.slice(0, idx).toLowerCase(),
    port: trimmed.slice(idx + 1) || null,
  };
}

/**
 * 校验 WebSocket 升级请求。
 *
 * @param req - 升级请求
 * @param expectedPort - 桥实际监听的端口；`Host` 带端口时要求一致
 */
export function checkUpgradeRequest(
  req: IncomingMessage,
  expectedPort: number,
): HostCheckResult {
  /* ── ① Origin 校验：拒绝一切网页来源 ── */
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    // 浏览器总是带 Origin；带 http(s):// 的一律是网页 → 拒绝
    if (/^https?:\/\//i.test(origin)) {
      return {
        ok: false,
        reason: 'bad-origin',
        detail: `网页来源不被接受：${origin}`,
      };
    }
    // 扩展来源放行；其他 scheme（如 file://）也拒绝
    if (!origin.toLowerCase().startsWith('chrome-extension://')) {
      return {
        ok: false,
        reason: 'bad-origin',
        detail: `不接受的 Origin scheme：${origin}`,
      };
    }
  }
  // origin 缺失 = 非浏览器客户端（SDK / CLI / 测试）→ 放行

  /* ── ② Host 校验：只接受回环 ── */
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
    return { ok: false, reason: 'bad-host', detail: '缺少 Host 头' };
  }
  const { hostname, port } = parseHostHeader(hostHeader);
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    return {
      ok: false,
      reason: 'bad-host',
      detail: `Host 必须是回环地址，收到：${hostHeader}`,
    };
  }
  if (port !== null && port !== String(expectedPort)) {
    return {
      ok: false,
      reason: 'bad-host',
      detail: `Host 端口与监听端口不一致：${hostHeader}（监听 ${expectedPort}）`,
    };
  }
  return { ok: true };
}
