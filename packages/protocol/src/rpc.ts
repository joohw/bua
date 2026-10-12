/**
 * JSON-RPC 2.0 帧定义。
 *
 * 只实现 BUA 用到的子集：请求 / 成功响应 / 错误响应 / 通知。
 * 刻意**不支持批量请求** —— 浏览器操作有强顺序依赖，
 * 批量会让「哪一步失败」难以定位，也让审批 UI 无法逐步确认。
 */

import type { BuaErrorData } from './errors.js';

export interface RpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: P;
}

export interface RpcNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
}

export interface RpcSuccess<R = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result: R;
}

/**
 * 错误响应。
 *
 * `id` 允许 `null` —— JSON-RPC 2.0 规定：解析失败或无法确定请求 id 时用 `null`。
 * 这是它与其他帧类型的关键区别，所以单独声明而不是复用 `RpcRequest['id']`。
 */
export interface RpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: {
    /** JSON-RPC 保留区间：-32768..-32000；应用错误用 -32000 以上。 */
    code: number;
    message: string;
    data?: BuaErrorData;
  };
}

export type RpcMessage<R = unknown> = RpcRequest | RpcSuccess<R> | RpcError | RpcNotification;

/**
 * 把未知来源的 id 收窄为合法的 JSON-RPC id。
 * 非法值（对象、数组、boolean、undefined）一律返回 `null`。
 */
export function normalizeRpcId(raw: unknown): number | string | null {
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  return null;
}

/** JSON-RPC 标准错误码。 */
export const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** 应用层错误统一用这个码，具体原因看 `error.data.buaCode`。 */
  BUA_ERROR: -32000,
} as const;

/** WebSocket 关闭码。 */
export const WS_CLOSE_CODES = {
  /** 协议版本不匹配。 */
  PROTOCOL_VERSION: 4002,
  /** 心跳超时。 */
  HEARTBEAT_TIMEOUT: 4003,
  /** `Host` 头校验失败（防 DNS rebinding）。 */
  BAD_HOST: 4004,
  NORMAL: 1000,
} as const;

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m['jsonrpc'] === '2.0' && typeof m['method'] === 'string' && m['id'] !== undefined;
}

export function isRpcNotification(msg: unknown): msg is RpcNotification {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m['jsonrpc'] === '2.0' && typeof m['method'] === 'string' && m['id'] === undefined;
}

export function isRpcResponse(msg: unknown): msg is RpcSuccess | RpcError {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m['jsonrpc'] !== '2.0' || m['id'] === undefined) return false;
  return 'result' in m || 'error' in m;
}
