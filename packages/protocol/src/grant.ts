/**
 * 授权模型。
 *
 * 一个能读所有标签页并代用户点击的组件，权限等级等同于「遥控浏览器」。
 * 因此授权是**默认拒绝**的，且可限定域名与时限。
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
