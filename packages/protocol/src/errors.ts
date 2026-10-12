/**
 * BUA 协议错误码。
 *
 * 设计原则：错误码是 agent 的**路由依据**，不是给人看的文案。
 * 每个码必须对应一个明确的 agent 应对动作（重试 / 换路 / 请求授权 / 停止）。
 */

export const BUA_ERROR_CODES = {
  /** 协议版本不匹配 —— 应对：升级扩展或桥 */
  PROTOCOL_VERSION: 'BUA_PROTOCOL_VERSION',
  /** token 无效 —— 应对：重新配对。注意实现上通常直接断连而不回错 */
  UNAUTHORIZED: 'BUA_UNAUTHORIZED',
  /** 授权层级不够 —— 应对：请求用户提权 */
  GRANT_INSUFFICIENT: 'BUA_GRANT_INSUFFICIENT',
  /** 域名不在白名单 —— 应对：请求用户加白 */
  ORIGIN_DENIED: 'BUA_ORIGIN_DENIED',
  /** 敏感操作需用户确认 —— 应对：发起确认流程并等待 */
  CONSENT_REQUIRED: 'BUA_CONSENT_REQUIRED',
  /** 用户拒绝 —— 应对：停止，不要重试 */
  CONSENT_DECLINED: 'BUA_CONSENT_DECLINED',
  /** 标签不存在或已关闭 —— 应对：重新列标签 */
  TAB_NOT_FOUND: 'BUA_TAB_NOT_FOUND',
  /** 标签已被其他会话接管 —— 应对：换标签或等释放 */
  TAB_CLAIMED: 'BUA_TAB_CLAIMED',
  /** 句柄失效（locatorId / blobRef 过期） —— 应对：重新构造 */
  HANDLE_STALE: 'BUA_HANDLE_STALE',
  /**
   * chrome.debugger attach 失败（可能被 DevTools 或其他客户端占用）
   * —— 应对：降级到非 debugger 路径，而不是失败退出
   */
  DEBUGGER_UNAVAILABLE: 'BUA_DEBUGGER_UNAVAILABLE',
  /** 导航超时 —— 应对：检查 tab.url() 后决定，不要盲目重试 */
  NAVIGATION_TIMEOUT: 'BUA_NAVIGATION_TIMEOUT',
  /** 当前后端不支持该能力 —— 应对：查能力表，走替代路径 */
  UNSUPPORTED: 'BUA_UNSUPPORTED',
  /** 扩展侧内部错误 —— 应对：上报日志 */
  INTERNAL: 'BUA_INTERNAL',
} as const;

export type BuaErrorCode = (typeof BUA_ERROR_CODES)[keyof typeof BUA_ERROR_CODES];

/** 全部错误码的字面量联合，用于运行时校验与穷尽性检查。 */
export const ALL_BUA_ERROR_CODES: readonly BuaErrorCode[] = Object.values(BUA_ERROR_CODES);

/**
 * 桥以 JSON-RPC 错误对象返回失败，`error.data.buaCode` 携带上表的码。
 * `error.data` 里**禁止**放页面内容、凭据或完整 URL 查询串。
 */
export interface BuaErrorData {
  buaCode: BuaErrorCode;
  /** 人类可读的简短说明。不得包含敏感值。 */
  message?: string;
  /** 结构化补充信息，例如冲突的会话 id、被拒的 origin。 */
  details?: Record<string, unknown>;
}
