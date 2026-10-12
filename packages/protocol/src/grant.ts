/**
 * 授权模型。
 *
 * 一个能读所有标签页并代用户点击的组件，权限等级等同于「遥控浏览器」。
 * 因此授权是**默认拒绝**的，且可限定域名与时限。
 *
 * ⚠️ **重要：本模块的 origin 白名单不是安全边界。**
 *
 * 三方独立来源都承认 URL 级白名单不可靠：
 *
 * - Playwright MCP 官方注释：`--allowed-origins` *"does not serve as a security
 *   boundary and does not affect redirects"*
 * - chrome-devtools-mcp 的 `--blockedUrlPattern` 拒绝含 regexp group 的 pattern，
 *   理由是「在重定向和子资源上无法强制执行」
 * - Chrome 155 官方博客：*"Because CDP operates beneath the web platform's origin
 *   model, origin-based filtering cannot securely restrict it"*
 *
 * 原因是**结构性的**：CDP 位于 Web 平台 origin 模型**之下**，一旦 attach 成功，
 * 就能读到该 tab 的一切（含跨域 iframe），并对任意 origin 发起导航。
 * 白名单只能约束**我们自己代码愿意检查的东西**。
 *
 * 因此本模块的定位是：
 *
 * - ✅ **用户体验工具**：让 agent 不乱逛，让用户能表达「只准用这几个站」
 * - ✅ **纵深防御的一层**：提高误操作的门槛
 * - ❌ **不是安全边界**。真正的闸门在扩展侧的**动作级**校验：
 *   动作风险分级（read / write / destructive）+ 破坏性动作逐次人工确认。
 *
 * 参见 `research/01-competitors.md` §5.2 的 L1/L2/L3 分层建议。
 */

/**
 * 授权层级，由弱到强。
 *
 * - `none`                  只能看到「有这些标签」，读不到内容
 * - `read`                  可读 DOM / 截图 / 无障碍树，不能点击输入
 * - `interact`              可点击、输入、导航
 * - `restricted-interact`   上述 + 敏感操作逐次确认（**默认档**）
 * - `full`                  无逐次确认
 */
export const GRANT_LEVELS = [
  'none',
  'read',
  'interact',
  'restricted-interact',
  'full',
] as const;

export type GrantLevel = (typeof GRANT_LEVELS)[number];

/** 层级强度数值，便于比较。索引即强度。 */
export const GRANT_LEVEL_STRENGTH: Readonly<Record<GrantLevel, number>> = Object.freeze({
  none: 0,
  read: 1,
  interact: 2,
  'restricted-interact': 3,
  full: 4,
});

/** 默认授权：会话建立后、用户明确授权前使用。 */
export const DEFAULT_GRANT: Grant = Object.freeze({
  level: 'none',
  origins: [],
  expiresAt: null,
});

export interface Grant {
  level: GrantLevel;
  /**
   * 允许操作的 origin 白名单（`https://example.com` 形式，含 scheme/host/port，
   * 不含 path/query/fragment）。
   * 空数组表示**未授予任何域名**。
   * 特例：`["*"]` 表示不限域名，仅在用户显式选择时使用。
   */
  origins: string[];
  /** 过期时刻（Unix ms）。`null` 表示无期限。 */
  expiresAt: number | null;
}

/** 授权是否已过期。 */
export function isGrantExpired(grant: Grant, now: number = Date.now()): boolean {
  return grant.expiresAt !== null && now >= grant.expiresAt;
}

/** 层级是否达到要求。 */
export function hasGrantLevel(grant: Grant, required: GrantLevel): boolean {
  return GRANT_LEVEL_STRENGTH[grant.level] >= GRANT_LEVEL_STRENGTH[required];
}

/**
 * origin 是否被授权。
 *
 * 注意：这里刻意使用 `URL.origin` 归一化比较，避免
 * `https://example.com.evil.test` 被 `endsWith` 之类的朴素匹配误放行。
 */
export function isOriginAllowed(grant: Grant, origin: string): boolean {
  if (grant.origins.includes('*')) return true;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  return grant.origins.some((allowed) => {
    try {
      return new URL(allowed).origin === normalized;
    } catch {
      return false;
    }
  });
}

/**
 * 判定一次操作是否被允许。
 * 返回 `null` 表示允许；否则返回应回给 agent 的错误码。
 */
export function checkGrant(
  grant: Grant,
  required: GrantLevel,
  origin?: string,
  now: number = Date.now(),
): 'BUA_GRANT_INSUFFICIENT' | 'BUA_ORIGIN_DENIED' | null {
  if (isGrantExpired(grant, now)) return 'BUA_GRANT_INSUFFICIENT';
  if (!hasGrantLevel(grant, required)) return 'BUA_GRANT_INSUFFICIENT';
  if (origin !== undefined && !isOriginAllowed(grant, origin)) return 'BUA_ORIGIN_DENIED';
  return null;
}
