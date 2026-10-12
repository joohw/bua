/**
 * `@bua/protocol` —— BUA 桥协议的唯一真源。
 *
 * 扩展、桥、SDK 三侧共享本包，避免方法名与类型在三处各写一遍导致漂移。
 *
 * ```ts
 * import { M, BUA_ERROR_CODES, PROTOCOL_VERSION, hasGrantLevel } from '@bua/protocol';
 * ```
 */

export * from './errors.js';
export * from './grant.js';
export * from './shapes.js';
export * from './methods.js';
export * from './rpc.js';
