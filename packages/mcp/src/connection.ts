/**
 * MCP 服务器到 BUA 桥的共享连接。
 *
 * 所有工具调用复用**同一个 agent 会话**。这一点是刻意的：桥按 `sessionId` 记录审计，
 * 复用会话能让用户在扩展弹窗的操作流水里看到一条连贯的记录，而不是每次调用都
 * 冒出一个新会话。
 *
 * 连接是**惰性建立**的：MCP 服务器可能在桥还没起来时就被 DSH 拉起，此时不应该
 * 在启动阶段就失败。首次工具调用时才连，失败时给出可操作的错误信息。
 */

import { connect as sdkConnect, type Agent, type Browser } from '@bua/sdk';
import { BUA_ERROR_CODES } from '@bua/protocol';

/** 与扩展里硬编码的 `BRIDGE_PORT` 保持一致。 */
export const DEFAULT_BRIDGE_PORT = 17432;

export interface ConnectionOptions {
  port?: number;
  clientName?: string;
}

/**
 * 惰性单例连接。
 *
 * 注意 MCP 的 stdio 绑定下进程生命周期与连接生命周期无关 —— DSH 可能在一次会话里
 * 从没调用过浏览器工具，此时不该有任何 socket。
 */
export class BuaConnection {
  readonly #port: number;
  readonly #clientName: string;
  #agent: Agent | null = null;
  #connecting: Promise<Agent> | null = null;

  constructor(options: ConnectionOptions = {}) {
    this.#port = options.port ?? DEFAULT_BRIDGE_PORT;
    this.#clientName = options.clientName ?? 'dsh';
  }

  get port(): number {
    return this.#port;
  }

  get connected(): boolean {
    return this.#agent !== null;
  }

  /** 取得（必要时建立）agent 连接。 */
  async agent(): Promise<Agent> {
    if (this.#agent !== null) return this.#agent;
    // 并发首次调用只建立一个连接
    if (this.#connecting !== null) return this.#connecting;

    this.#connecting = (async () => {
      try {
        const a = await sdkConnect({
          port: this.#port,
          client: { name: this.#clientName, version: '0.0.1' },
        });
        this.#agent = a;
        return a;
      } finally {
        this.#connecting = null;
      }
    })();

    return this.#connecting;
  }

  /** 取得默认浏览器，并在没有后端时给出明确说明。 */
  async browser(): Promise<Browser> {
    const agent = await this.agent();
    return agent.browsers.getDefault();
  }

  async close(): Promise<void> {
    const a = this.#agent;
    this.#agent = null;
    if (a !== null) await a.close().catch(() => {});
  }
}

/**
 * 判断是否 BUA SDK 的错误。
 *
 * 刻意用**结构判断**而不是 `instanceof BuaError`。
 * 在 pnpm 的工作区里同一个包可能被解析出多份实例（本包依赖的 `@bua/sdk` 与
 * 调用方持有的未必是同一个模块对象），那时 `instanceof` 会静默失败 —— 错误依然
 * 是 BuaError，却走不进按码分派的分支，最后呈现给模型的就成了一句无用的通用文案。
 * 跨模块边界判断错误类型时，看形状比看原型可靠。
 */
function isBuaErrorLike(err: unknown): err is { buaCode: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { buaCode?: unknown }).buaCode === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

/**
 * 把 SDK 抛出的错误转成**给模型看**的文本。
 *
 * MCP 工具的失败会作为 tool result 回到模型上下文，所以信息要能指导下一步动作，
 * 而不是抛一句 `ECONNREFUSED`。这里按 `buaCode` 分派，每种情况都写清「为什么」和
 * 「怎么办」。
 */
export function describeError(err: unknown, port: number): string {
  if (isBuaErrorLike(err)) {
    switch (err.buaCode) {
      case BUA_ERROR_CODES.UNSUPPORTED:
        return [
          '没有浏览器后端可用。',
          '',
          `BUA 扩展可能未安装、未启用，或尚未在引导页完成授权。桥地址：ws://127.0.0.1:${port}`,
          '请让用户在 chrome://extensions 确认 BUA 已启用，并在其引导页勾选同意。',
        ].join('\n');
      case BUA_ERROR_CODES.DEBUGGER_UNAVAILABLE:
        return [
          '无法使用 Chrome DevTools Protocol。',
          '',
          `原因：${err.message}`,
          '',
          '两种可能：① 该标签已被 DevTools 或其他客户端占用（可换标签重试）；',
          '② 企业策略（Chrome 155+）拒绝了 CDP，此时截图与真实输入事件不可用，',
          '应改用读取类工具（dom_snapshot / text）。',
        ].join('\n');
      case BUA_ERROR_CODES.MISSING_TARGET_DESCRIPTION:
        return [
          '该操作缺少 targetDescription。',
          '',
          '所有变更型操作（点击/输入/导航）都必须说明人类可读的操作意图，',
          '例如「结算按钮（￥299）」。这是为了让用户能在操作流水里读懂发生了什么。',
        ].join('\n');
      case BUA_ERROR_CODES.TAB_NOT_FOUND:
        return '标签不存在或已关闭。请重新调用 tabs_list 获取当前标签。';
      case BUA_ERROR_CODES.TAB_CLAIMED:
        return '该标签已被另一个 agent 会话接管。请换一个标签，或等对方释放。';
      case BUA_ERROR_CODES.HANDLE_STALE:
        return '句柄已失效（页面可能已变化）。请重新观察页面后再操作。';
      case BUA_ERROR_CODES.NAVIGATION_TIMEOUT:
        return '导航超时。建议先用 tab_info 读当前 URL，确认页面实际状态，不要盲目重试。';
      default:
        return `浏览器操作失败（${err.buaCode}）：${err.message}`;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  // 连接层面的失败最常见，单独给一条可操作的说明
  if (/ECONNREFUSED|WebSocket|connect/i.test(message)) {
    return [
      `无法连接 BUA 桥（ws://127.0.0.1:${port}）。`,
      '',
      '请在终端运行：bua-server',
      '（端口固定为 17432，与扩展一致。首次安装扩展后需在引导页完成授权。）',
    ].join('\n');
  }
  return `失败：${message}`;
}

/** 统一的工具结果包装。 */
export function ok(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export function fail(text: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return { content: [{ type: 'text', text }], isError: true };
}
