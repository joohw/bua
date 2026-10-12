/**
 * 桥的角色与会话模型。
 *
 * 桥是唯一的 WebSocket **服务端**；agent SDK 与扩展都是客户端，都主动连桥。
 * 理由：MV3 service worker 会被 Chrome 随时回收重启，让扩展做服务端会引入
 * 「谁是服务端」的复杂度；桥是长驻进程，做服务端天然稳定。
 *
 * 详见 `docs/routing.md`。
 */

import type { Capabilities } from '@bua/protocol';

export type PeerRole = 'agent' | 'extension';

/** agent 侧在 hello 里声明的客户端信息。 */
export interface AgentClientInfo {
  /** 客户端名，例如 `dsh` / `claude-code` / 自研脚本。用于审计与日志。 */
  name: string;
  version?: string;
}

/** 扩展侧在 hello 里声明的客户端信息。 */
export interface ExtensionClientInfo {
  extensionId: string;
  extensionVersion: string;
  chromeVersion?: string;
}

export interface AgentHello {
  protocolVersion: string;
  role: 'agent';
  client: AgentClientInfo;
}

export interface ExtensionHello {
  protocolVersion: string;
  role: 'extension';
  client: ExtensionClientInfo;
  /** 本实例实现的能力 id 列表（`CAPABILITY_IDS` 子集）。 */
  capabilities?: string[];
}

export type HelloParams = AgentHello | ExtensionHello;

/** 桥回给 agent 的握手结果。 */
export interface AgentHelloResult {
  sessionId: string;
  heartbeatMs: number;
  /** 后端是否已连上。`connected: false` 时一切方法调用都会失败。 */
  backend: { connected: boolean; chromeVersion?: string };
  capabilities: Capabilities;
}

/** 桥回给扩展的握手结果。 */
export interface ExtensionHelloResult {
  sessionId: string;
  heartbeatMs: number;
}

/**
 * 扩展上报的能力声明（`bua.event` 的 `backend.ready` 载荷）。
 * 与 `Capabilities` 的区别：这是扩展**自己说**的支持面，桥据此向 agent 宣告。
 */
export type ExtensionCapabilities = Capabilities;

/* ─────────────────────────── 会话 ─────────────────────────── */

export interface SessionBase {
  sessionId: string;
  role: PeerRole;
  connectedAt: number;
  lastSeenAt: number;
}

export interface AgentSession extends SessionBase {
  role: 'agent';
  client: AgentClientInfo;
}

export interface ExtensionSession extends SessionBase {
  role: 'extension';
  client: ExtensionClientInfo;
  capabilities: Capabilities;
  /** 扩展宣称实现的 capability id 列表。 */
  declaredCapabilities: string[];
}

export type Session = AgentSession | ExtensionSession;

/**
 * 桥向 agent 宣告的「无后端」能力集。
 *
 * 刻意全是 `false` 而不是省略：agent 可以无条件读这些字段而不必判断
 * 它们是否存在，降级路径只有一条。
 */
export const NO_BACKEND_CAPABILITIES: Readonly<Capabilities> = Object.freeze({
  cdp: false,
  screenshots: false,
  fileUploads: false,
  downloads: false,
  evaluate: false,
  management: false,
  notes: ['没有扩展连接到桥。请确认 BUA 扩展已安装并处于启用状态。'],
});

/** 扩展**降级模式**下的能力集：无 CDP，靠 `chrome.scripting` 兜底。 */
export const DEGRADED_CAPABILITIES_HINT =
  '扩展未持有 CDP（企业策略拒绝 attach，或 DevTools 占用）。已降级到 chrome.scripting 模式，' +
  '真实输入事件、截图与跨 iframe 一致控制不可用。';
