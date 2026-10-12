/**
 * 线上数据结构。
 *
 * 这些形状**刻意对齐 OpenAI Codex 浏览器扩展的 API**，使针对 Codex 写的
 * agent 逻辑可以低成本迁移。对齐基准见 `research/03-codex-api-reference.md`。
 */

import type { Grant } from './grant.js';

/* ────────────────────────────── 浏览器 ────────────────────────────── */

/**
 * 浏览器后端类型，取值**与 Codex 完全一致**。
 *
 * - `extension`  BUA 原生路线：MV3 扩展 + `chrome.debugger`，操作用户真实浏览器
 * - `cdp`        外部 CDP 端点（`--remote-debugging-port`），独立或用户浏览器
 * - `iab`        应用内嵌浏览器
 * - `mcpapps`    宿主 side panel 中的全屏 MCP 应用
 */
export type BrowserType = 'extension' | 'cdp' | 'iab' | 'mcpapps';

export interface BrowserInfo {
  id: string;
  name: string;
  /** 浏览器家族，例如 `chrome` / `edge` / `brave`。 */
  family?: string;
  type: BrowserType;
  /** Chromium profile 名，例如 `Default` / `Profile 1`。 */
  profileName?: string;
  tabs: TabInfo[];
  metadata?: BrowserMetadata;
}

export interface BrowserMetadata {
  /** 扩展实例 id —— 同一浏览器可能装了多个 BUA 实例（不同 profile）。 */
  extensionInstanceId?: string;
  /** 桥侧的会话 id，对应某个 agent 会话。 */
  buaSessionId?: string;
}

/* ─────────────────────────────── 标签 ─────────────────────────────── */

export interface TabInfo {
  id: string;
  url?: string;
  title?: string;
  active: boolean;
  pinned?: boolean;
  windowId?: number;
  status?: 'loading' | 'complete';
}

/**
 * 用户自己打开的标签。
 *
 * 与 `TabInfo` 的区别：这是**未被接管**的标签的可读视图，
 * 列出它只需要 `none` 级授权（可见性），读内容才需要 `read`。
 */
export interface UserTabInfo {
  id: string;
  title?: string;
  url?: string;
  /** Unix ms，用于按最近打开排序。 */
  lastOpened: number;
  windowId: number;
  pinned: boolean;
  audible?: boolean;
  /** 是否已被某个 agent 会话接管。 */
  claimed: boolean;
  /** 接管它的会话 id。 */
  claimedBy?: string;
}

/** 未接管标签的**有界**只读上下文。 */
export interface UserTabContext {
  title?: string;
  url?: string;
  /** 页面文本，默认上限见 `USER_TAB_CONTEXT_MAX_CHARS`。 */
  text?: string;
  truncated: boolean;
}

/** 默认的上下文文本上限：8 KB。防止一次读取把 agent 上下文灌爆。 */
export const USER_TAB_CONTEXT_MAX_CHARS = 8192;

/* ─────────────────────────── 大对象与句柄 ─────────────────────────── */

/**
 * 大对象（截图 / DOM 快照 / 无障碍树）**不以 base64 内联进 RPC 帧**，
 * 而是由桥落盘后返回引用。理由：这些对象动辄数百 KB 到数 MB，
 * 内联会撞上 WebSocket 帧上限并浪费内存。
 */
export interface BlobRef {
  ref: string;
  mime: string;
  bytes: number;
  /** 图像类 blob 才有。 */
  width?: number;
  height?: number;
}

/* ──────────────────────────── 通用几何 ──────────────────────────── */

export interface Point {
  x: number;
  y: number;
}

export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  /** 默认 `png`。 */
  format?: 'png' | 'jpeg';
  /** 仅 jpeg 有效，1..100。 */
  quality?: number;
  /** 默认 `false`（仅视口）。 */
  fullPage?: boolean;
  clip?: ClipRect;
}

export type MouseButton = 'left' | 'right' | 'middle';

export type KeyboardModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface InputModifiers {
  modifiers?: KeyboardModifier[];
}

/* ──────────────────── 变更型动作的强制字段（L3） ──────────────────── */

/**
 * 动作风险级别。**在扩展侧硬编码判定，不信任 agent 传的 hint**
 * （MCP 规范明确警告 tool annotations 不可信）。
 *
 * - `read`        截图 / 快照 / 列标签 —— 免审批
 * - `write`       点击 / 输入 / 滚动 / 导航 —— 按 origin 授权
 * - `destructive` 提交表单 / 支付 / 删除 / 发送消息 / 上传下载 / 写剪贴板 / 关标签
 *                 —— **每次必审批**
 */
export type ActionRisk = 'read' | 'write' | 'destructive';

/**
 * 所有 `write` 与 `destructive` 动作**必须**携带的人类可读目标描述。
 *
 * 理由：**坐标本身无法让人判断风险，描述可以。**
 * 审批 UI 展示的正是这个字段。
 *
 * 设计原型是 Playwright MCP 的 `browser_click` —— 其 `element` 参数注释即
 * *"used to obtain permission"*。
 *
 * @example "结算按钮（￥299，含运费）"
 */
export interface WithTargetDescription {
  /** 扩展侧校验非空；缺失时桥拒绝该调用。 */
  targetDescription: string;
}

/**
 * TOCTOU 防护：观察类方法返回 `snapshotId`，后续变更动作必须携带。
 * 不匹配则拒绝（`BUA_HANDLE_STALE`）并要求 agent 重新观察。
 *
 * 防止「观察」与「操作」之间页面变化导致的误操作。
 */
export interface WithSnapshotId {
  snapshotId: string;
}

/**
 * 敏感字段占位符。agent 传 `{{secret:name}}`，**扩展侧替换为真实值再输入**，
 * 真实值永不进入 agent 上下文。
 */
export const SECRET_PLACEHOLDER_PATTERN = /^\{\{secret:([a-zA-Z0-9_.-]+)\}\}$/;

/** 从占位符中取出密钥名；不是占位符则返回 `null`。 */
export function parseSecretPlaceholder(value: string): string | null {
  const m = SECRET_PLACEHOLDER_PATTERN.exec(value);
  return m?.[1] ?? null;
}

/**
 * 是否包含**任意位置**的占位符。
 *
 * 注意与 {@link parseSecretPlaceholder} 的区别：那个要求整个值就是占位符，
 * 这个用于在自由文本里检测混入的占位符（例如往输入框里填一段含密码的文本）。
 */
export function containsSecretPlaceholder(value: string): boolean {
  return /\{\{secret:[a-zA-Z0-9_.-]+\}\}/.test(value);
}


/* ───────────────────────────── 审计 ───────────────────────────── */

/**
 * 审计条目：每次**变更型操作**都记录变更前状态，使撤销成为可能。
 *
 * 这继承并推广了 Codex `management.getAuditTrail()` 的设计。
 * 新增 `sessionId` —— 多 agent 同时操作时，用户必须能分清是谁改的。
 */
export interface AuditEntry {
  id: string;
  createdAt: number;
  /** 哪个 agent 会话发起的。多 agent 场景的关键字段。 */
  sessionId: string;
  /** 命名空间，例如 `tabs` / `tab` / `management`。 */
  namespace: string;
  method: string;
  args: unknown[];
  /** 变更前状态，用于撤销。 */
  before: unknown;
  result?: unknown;
  undone?: boolean;
}

/* ─────────────────────────── 能力协商 ─────────────────────────── */

/**
 * 已知能力 id。
 *
 * 能力是**可选、可探测、自带文档**的。agent 必须写成
 * 「先探测再使用」，而不是假定某个能力存在。
 *
 * 前 8 个对齐 Codex；`bua.*` 两个是 BUA 增补。
 */
export const CAPABILITY_IDS = [
  // —— 对齐 Codex ——
  /** 原始 CDP 逃生口。需要 `debugger` 权限。 */
  'cdp',
  /** 凭据安全填充：值在扩展侧填入，**永不穿过桥**。 */
  'browserAuth',
  /** 网站主动暴露的工具（W3C WebMCP 提案）。 */
  'webmcp',
  /** 窗口 / 标签组 / 书签整理。 */
  'management',
  /** 页面资源（图片、媒体、附件）。 */
  'pageAssets',
  /** 风控 / 机器人检测信号探测。 */
  'botDetection',
  /** 视口控制。 */
  'viewport',
  /** 标签可见性控制。 */
  'visibility',
  // —— BUA 增补 ——
  /** 所有变更型操作的可回滚记录。 */
  'bua.audit',
  /** 域名级授权与敏感操作确认。 */
  'bua.consent',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CapabilityInfo {
  id: CapabilityId | (string & {});
  /** 该能力自己的文档，用 `capabilities.get` 取。 */
  documentation: string;
}

export type CapabilityScope = 'browser' | 'tab';

/* ───────────────────────── 会话与握手 ───────────────────────── */

/** 协议版本。扩展与桥必须一致，否则 `BUA_PROTOCOL_VERSION`。 */
export const PROTOCOL_VERSION = 'v0';

export interface ClientInfo {
  extensionId: string;
  extensionVersion: string;
  chromeVersion?: string;
  /** 本扩展实例支持的能力 id 列表。 */
  capabilities: string[];
}

export interface HelloParams {
  protocolVersion: string;
  /** 配对时用户粘贴的 token。校验失败时桥直接断连，不回错误体。 */
  token: string;
  client: ClientInfo;
}

export interface HelloResult {
  sessionId: string;
  /** 心跳间隔（ms）。桥需在 `2 × heartbeatMs` 内收到心跳。 */
  heartbeatMs: number;
  grant: Grant;
}

/* ──────────────────────────── 默认值 ──────────────────────────── */

export const DEFAULTS = Object.freeze({
  /** 心跳间隔。 */
  heartbeatMs: 15_000,
  /** 常规调用超时。 */
  callTimeoutMs: 30_000,
  /** 导航类长任务超时。 */
  navigationTimeoutMs: 90_000,
  /** Playwright 定位器自动等待上限。 */
  locatorTimeoutMs: 30_000,
  /** 定位器句柄无引用回收 TTL。 */
  handleTtlMs: 5 * 60_000,
});

/** 需要放宽超时的方法名前缀。 */
export const LONG_RUNNING_METHODS: readonly string[] = [
  'tab.goto',
  'playwright.waitForLoadState',
  'playwright.waitForURL',
  'playwright.waitForEvent',
  'playwright.expectNavigation',
  'tabs.content',
  'content.export',
  'content.exportGsuite',
];
