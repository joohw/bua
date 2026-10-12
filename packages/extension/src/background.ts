/**
 * BUA 扩展的 service worker。
 *
 * 职责：
 *
 * 1. 连本地桥（WebSocket，客户端角色 `extension`）
 * 2. 按需 `chrome.debugger.attach` 到目标标签
 * 3. **注入边缘泛光**并在导航后自动恢复（`Page.addScriptToEvaluateOnNewDocument`）
 * 4. 把桥转发来的方法调用落到 `chrome.debugger.sendCommand` / `chrome.*`
 * 5. 记录操作流水（供弹窗展示）与降级状态
 *
 * ⚠️ MV3 service worker 会被 Chrome 随时回收。因此**所有状态都存在
 * `chrome.storage.session` / `chrome.storage.local`**，而不是模块作用域变量。
 */

import {
  BUA_ERROR_CODES,
  M,
  PROTOCOL_VERSION,
  classifyRisk,
  type Capabilities,
} from '@bua/protocol';

import { OVERLAY_GLOBAL, OVERLAY_SCRIPT, type OverlayState } from './overlay.js';

/* ─────────────────────── 常量 ─────────────────────── */

const BRIDGE_PORT_KEY = 'bridgePort';
const LOG_KEY = 'activityLog';
const CONSENT_KEY = 'onboardingAcceptedAt';
const MAX_LOG = 200;

/** 默认桥端口。桥端 `--port 0` 时会用随机端口，此时由用户在引导页填写。 */
const DEFAULT_BRIDGE_PORT = 17432;

/* ─────────────────────── 持久状态 ─────────────────────── */

interface ActivityEntry {
  ts: number;
  method: string;
  risk: 'read' | 'write' | 'destructive';
  targetDescription?: string;
  ok: boolean;
  errorCode?: string;
  sessionId?: string;
}

/**
 * 内存态与持久态的分工：
 * - `ws` / `attached` 是运行时资源，SW 重启即失效，无需持久化
 * - `capabilities` / `log` / `port` / `consent` 必须持久化，否则 SW 一回收就丢
 */
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attachedTabs = new Set<number>();
let currentCapabilities: Capabilities = {
  cdp: false,
  screenshots: false,
  fileUploads: false,
  downloads: false,
  evaluate: false,
  management: false,
  notes: [],
};

/* ─────────────────────── 存储辅助 ─────────────────────── */

async function getPort(): Promise<number> {
  const bag = await chrome.storage.local.get(BRIDGE_PORT_KEY);
  const value = bag[BRIDGE_PORT_KEY];
  return typeof value === 'number' ? value : DEFAULT_BRIDGE_PORT;
}

async function getLog(): Promise<ActivityEntry[]> {
  const bag = await chrome.storage.local.get(LOG_KEY);
  const value = bag[LOG_KEY];
  return Array.isArray(value) ? (value as ActivityEntry[]) : [];
}

async function appendLog(entry: ActivityEntry): Promise<void> {
  const log = await getLog();
  log.unshift(entry);
  await chrome.storage.local.set({ [LOG_KEY]: log.slice(0, MAX_LOG) });
  // 通知弹窗（若打开着）
  try {
    await chrome.runtime.sendMessage({ type: 'bua:log', entry });
  } catch {
    /* 没有监听者时忽略 */
  }
}

/* ─────────────────────── 边缘泛光 ─────────────────────── */

/**
 * 确保标签已注册「每次新文档都注入覆盖层」。
 *
 * 用 `Page.addScriptToEvaluateOnNewDocument` 而不是 `Runtime.evaluate`：
 * 前者在**每次导航**后自动重跑，后者只在当前文档有效，页面一跳泛光就没了。
 *
 * @returns CDP 返回的 identifier，用于后续移除
 */
async function registerOverlayScript(tabId: number): Promise<string | null> {
  try {
    const result = (await chrome.debugger.sendCommand(
      { tabId },
      'Page.addScriptToEvaluateOnNewDocument',
      { source: OVERLAY_SCRIPT, runImmediately: true },
    )) as { identifier?: string } | undefined;
    return result?.identifier ?? null;
  } catch (err) {
    // 这不是致命失败：泛光只是视觉提示，缺了它核心功能仍可用
    console.warn('[bua] 注册覆盖层脚本失败：', err);
    return null;
  }
}

/**
 * 把当前状态推给页面里的覆盖层。
 *
 * 覆盖层在 `closed` shadow root 里，我们通过它挂在 `globalThis` 上的 API 驱动。
 * 页面 CSP 可能禁止 `Runtime.evaluate`，此时静默失败（泛光缺失不影响功能）。
 */
async function paintOverlay(
  tabId: number,
  state: OverlayState,
  warnings: string[] = [],
): Promise<void> {
  const payload = { state, warnings };
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `globalThis.${OVERLAY_GLOBAL} && globalThis.${OVERLAY_GLOBAL}.set(${JSON.stringify(payload)})`,
      returnByValue: true,
      awaitPromise: false,
    });
  } catch {
    /* 页面可能已关闭或 CSP 受限，忽略 */
  }
}

/** 重新计算并刷新某个标签的泛光状态。 */
async function refreshOverlay(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;
  const warnings = currentCapabilities.notes ?? [];
  const state: OverlayState = currentCapabilities.cdp ? 'active' : 'degraded';
  await paintOverlay(tabId, state, warnings);
}

/** 对所有已 attach 的标签刷新泛光。能力变化时调用。 */
async function refreshAllOverlays(): Promise<void> {
  await Promise.all([...attachedTabs].map((id) => refreshOverlay(id)));
}

/* ─────────────────────── CDP attach ─────────────────────── */

/**
 * attach 到标签并完成 CDP 侧初始化。
 *
 * 两种失败要区分对待（错误串来自 Chrome 官方文档）：
 * - 「已被 DevTools 或其他客户端占用」→ 临时冲突，可重试
 * - 「Host access is restricted by policy」/「Screenshot capture is restricted by policy」
 *   → 企业策略，Chrome 155+，**无法绕过**，必须降级
 */
async function attachTab(tabId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (attachedTabs.has(tabId)) return { ok: true };
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/restricted by policy/i.test(message)) {
      return { ok: false, reason: `企业策略拒绝了 CDP：${message}` };
    }
    return { ok: false, reason: message };
  }

  attachedTabs.add(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable').catch(() => {});
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => {});
  await registerOverlayScript(tabId);
  await refreshOverlay(tabId);
  return { ok: true };
}

async function detachTab(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* 已经断开 */
  }
}

/**
 * 用户关闭调试横幅 ⇒ Chrome 立即终止 attach（官方明文）。
 * 必须在这里感知并广播，否则 agent 会对着一个已死的会话继续发指令。
 */
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (typeof tabId !== 'number') return;
  attachedTabs.delete(tabId);
  send({
    jsonrpc: '2.0',
    method: 'bua.event',
    params: { type: 'debugger.detached', tabId, reason },
  });
});

/* ─────────────────────── 桥连接 ─────────────────────── */

function send(msg: unknown): void {
  if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function connect(): Promise<void> {
  if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const accepted = await isConsentGiven();
  if (!accepted) return; // 未经用户同意不建立连接

  const port = await getPort();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  ws = socket;

  socket.addEventListener('open', () => {
    send({
      jsonrpc: '2.0',
      id: 0,
      method: M.hello,
      params: {
        protocolVersion: PROTOCOL_VERSION,
        role: 'extension',
        client: {
          extensionId: chrome.runtime.id,
          extensionVersion: chrome.runtime.getManifest().version,
          ...(typeof navigator !== 'undefined' && /\bChrome\/(\d+)/.exec(navigator.userAgent) !== null
            ? { chromeVersion: /\bChrome\/(\d+[\d.]*)/.exec(navigator.userAgent)?.[1] ?? '' }
            : {}),
        },
        capabilities: ['cdp', 'screenshots', 'downloads', 'evaluate', 'management'],
      },
    });
  });

  socket.addEventListener('message', (ev) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    void handleBridgeMessage(msg);
  });

  socket.addEventListener('close', () => {
    ws = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // close 事件会紧跟其后，重连逻辑放那里
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, 3000);
}

/* ─────────────────────── 方法分发 ─────────────────────── */

interface CdpRequest {
  method: string;
  params: Record<string, unknown>;
}

/**
 * 把 BUA 方法转成 CDP 命令。
 *
 * 这是**扩展侧的唯一真源**：方法名 → CDP 映射只写在这里。
 * 返回 `null` 表示该方法不由 CDP 实现（走 `chrome.*` API 或尚未实现）。
 */
function methodToCdp(method: string, params: Record<string, unknown>): CdpRequest[] | null {
  switch (method) {
    // ── 标签导航与信息 ──
    case M.tabGoto:
      return [{ method: 'Page.navigate', params: { url: String(params['url'] ?? '') } }];
    case M.tabReload:
      return [{ method: 'Page.reload', params: {} }];
    case M.tabUrl:
      return [{ method: 'Runtime.evaluate', params: {
        expression: 'location.href', returnByValue: true } }];
    case M.tabTitle:
      return [{ method: 'Runtime.evaluate', params: {
        expression: 'document.title', returnByValue: true } }];
    case M.tabScreenshot:
      return [{ method: 'Page.captureScreenshot', params: {
        format: params['format'] ?? 'png',
        ...(params['quality'] !== undefined ? { quality: params['quality'] } : {}),
        captureBeyondViewport: params['fullPage'] === true,
      } }];
    case M.tabBack:
      return [{ method: 'Runtime.evaluate', params: { expression: 'history.back()', returnByValue: true } }];
    case M.tabForward:
      return [{ method: 'Runtime.evaluate', params: { expression: 'history.forward()', returnByValue: true } }];

    // ── Playwright 层 ──
    case M.pwDomSnapshot:
      return [{ method: 'Runtime.evaluate', params: { expression: DOM_SNAPSHOT_EXPR, returnByValue: true } }];
    case M.pwEvaluate:
      return [{ method: 'Runtime.evaluate', params: {
        expression: String(params['functionSource'] ?? 'undefined'),
        returnByValue: true,
        awaitPromise: true,
      } }];
    case M.locatorClick:
    case M.locatorFill:
    case M.locatorInnerText:
    case M.locatorTextContent:
    case M.locatorIsVisible:
    case M.locatorIsEnabled:
    case M.locatorCount:
      return [{ method: 'Runtime.evaluate', params: {
        expression: buildLocatorExpression(method, params),
        returnByValue: true,
        awaitPromise: true,
      } }];

    // ── AX 层 ──
    case M.axGet:
      return [{ method: 'Runtime.evaluate', params: { expression: AX_STATE_EXPR, returnByValue: true } }];
    case M.axClick:
      return [{ method: 'Runtime.evaluate', params: {
        expression: `document.elementFromPoint(${Number(params['x'] ?? 0)}, ${Number(params['y'] ?? 0)})?.click(); true`,
        returnByValue: true,
      } }];

    // ── CUA 坐标层：真实输入事件（这是 scripting 做不到的，也是保留 debugger 的理由）──
    case M.cuaClick:
      return [
        { method: 'Input.dispatchMouseEvent', params: {
          type: 'mousePressed', x: Number(params['x'] ?? 0), y: Number(params['y'] ?? 0),
          button: params['button'] ?? 'left', clickCount: 1 } },
        { method: 'Input.dispatchMouseEvent', params: {
          type: 'mouseReleased', x: Number(params['x'] ?? 0), y: Number(params['y'] ?? 0),
          button: params['button'] ?? 'left', clickCount: 1 } },
      ];
    case M.cuaDoubleClick:
      return [
        { method: 'Input.dispatchMouseEvent', params: {
          type: 'mousePressed', x: Number(params['x'] ?? 0), y: Number(params['y'] ?? 0),
          button: 'left', clickCount: 2 } },
        { method: 'Input.dispatchMouseEvent', params: {
          type: 'mouseReleased', x: Number(params['x'] ?? 0), y: Number(params['y'] ?? 0),
          button: 'left', clickCount: 2 } },
      ];
    case M.cuaMove:
      return [{ method: 'Input.dispatchMouseEvent', params: {
        type: 'mouseMoved', x: Number(params['x'] ?? 0), y: Number(params['y'] ?? 0) } }];
    case M.cuaScroll:
      return [{ method: 'Input.dispatchMouseEvent', params: {
        type: 'mouseWheel', x: Number(params['x'] ?? 0), y: Number(params['y'] ?? 0),
        deltaX: Number(params['deltaX'] ?? 0), deltaY: Number(params['deltaY'] ?? 0) } }];
    case M.cuaType:
      return [{ method: 'Input.insertText', params: { text: String(params['text'] ?? '') } }];
    case M.cuaKeypress:
      return [
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: String(params['key'] ?? '') } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: String(params['key'] ?? '') } },
      ];

    default:
      return null;
  }
}

/** 生成一个在页面上下文里求值的定位器表达式。 */
function buildLocatorExpression(method: string, params: Record<string, unknown>): string {
  const selector = String(params['selector'] ?? '');
  const safeSelector = JSON.stringify(selector);
  switch (method) {
    case M.locatorClick:
      return `(() => { const el = document.querySelector(${safeSelector}); if (!el) return { ok: false, error: 'not found' }; el.click(); return { ok: true }; })()`;
    case M.locatorFill:
      return `(() => { const el = document.querySelector(${safeSelector}); if (!el) return { ok: false, error: 'not found' }; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(el, ${JSON.stringify(String(params['value'] ?? ''))}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true }; })()`;
    case M.locatorInnerText:
      return `document.querySelector(${safeSelector})?.innerText ?? null`;
    case M.locatorTextContent:
      return `document.querySelector(${safeSelector})?.textContent ?? null`;
    case M.locatorIsVisible:
      return `(() => { const el = document.querySelector(${safeSelector}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
    case M.locatorIsEnabled:
      return `(() => { const el = document.querySelector(${safeSelector}); return el ? !el.disabled : false; })()`;
    case M.locatorCount:
      return `document.querySelectorAll(${safeSelector}).length`;
    default:
      return 'null';
  }
}

/** DOM 快照：带节点 id 的可交互元素清单（对齐 Codex 的 `domSnapshot` 思路）。 */
const DOM_SNAPSHOT_EXPR = `(() => {
  const out = [];
  const sel = 'a[href],button,input,select,textarea,[role],[onclick],[contenteditable="true"]';
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (i >= 400) break;
    out.push({
      id: i++,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      name: (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 120),
      selector: el.id ? '#' + CSS.escape(el.id) : undefined,
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    });
  }
  return out;
})()`;

/** 无障碍状态快照：尽量用无障碍属性，与 Codex 的 `ax.get` 对齐。 */
const AX_STATE_EXPR = `(() => {
  const lines = [];
  const sel = '[role],a[href],button,input,select,textarea,h1,h2,h3';
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (i >= 300) break;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 80);
    const state = [];
    if (el.disabled) state.push('disabled');
    if (el.checked) state.push('checked');
    lines.push('[' + i++ + '] ' + role + (name ? ' "' + name + '"' : '') + (state.length ? ' (' + state.join(',') + ')' : ''));
  }
  return lines.join('\\n');
})()`;

async function handleBridgeMessage(raw: unknown): Promise<void> {
  if (typeof raw !== 'object' || raw === null) return;
  const msg = raw as Record<string, unknown>;
  const id = msg['id'];
  const method = msg['method'];
  if (typeof method !== 'string' || id === undefined) return; // 只处理请求

  const params =
    typeof msg['params'] === 'object' && msg['params'] !== null
      ? (msg['params'] as Record<string, unknown>)
      : {};
  const sessionId = typeof params['__buaSessionId'] === 'string' ? params['__buaSessionId'] : undefined;
  const risk = classifyRisk(method);
  const targetDescription =
    typeof params['targetDescription'] === 'string' ? params['targetDescription'] : undefined;

  const respond = async (result: unknown, errorCode?: string, message?: string): Promise<void> => {
    await appendLog({
      ts: Date.now(),
      method,
      risk,
      ok: errorCode === undefined,
      ...(targetDescription !== undefined ? { targetDescription } : {}),
      ...(errorCode !== undefined ? { errorCode } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
    send(
      errorCode === undefined
        ? { jsonrpc: '2.0', id, result }
        : { jsonrpc: '2.0', id, error: { code: -32000, message: message ?? errorCode, data: { buaCode: errorCode } } },
    );
  };

  // ── 桥管理方法 ──
  if (method === M.heartbeat) {
    send({ jsonrpc: '2.0', id, result: { ok: true } });
    return;
  }

  // ── 需要标签的方法 ──
  const tabId = typeof params['tabId'] === 'number' ? params['tabId'] : undefined;
  if (tabId === undefined) {
    await respond(null, BUA_ERROR_CODES.UNSUPPORTED, `方法 ${method} 需要 tabId`);
    return;
  }

  const attach = await attachTab(tabId);
  if (!attach.ok) {
    // attach 失败要区分：DevTools 占用可重试；企业策略不可绕过
    await respond(null, BUA_ERROR_CODES.DEBUGGER_UNAVAILABLE, attach.reason);
    return;
  }

  const cdpCalls = methodToCdp(method, params);
  if (cdpCalls === null) {
    await respond(null, BUA_ERROR_CODES.UNSUPPORTED, `方法 ${method} 尚未实现`);
    return;
  }

  try {
    let last: unknown = null;
    for (const call of cdpCalls) {
      last = await chrome.debugger.sendCommand({ tabId }, call.method, call.params);
    }
    await respond(last);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await respond(null, BUA_ERROR_CODES.INTERNAL, message);
  }
}

/* ─────────────────────── 同意与生命周期 ─────────────────────── */

async function isConsentGiven(): Promise<boolean> {
  const bag = await chrome.storage.local.get(CONSENT_KEY);
  return typeof bag[CONSENT_KEY] === 'number';
}

// 安装时：首次安装打开引导页（必须在扩展自己的 UI 内完成同意），并尝试连接
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装必定未经同意，所以引导页是唯一合理的落点
    void chrome.runtime.openOptionsPage();
  }
  void connect();
});
chrome.runtime.onStartup.addListener(() => {
  void connect();
});

// SW 被回收后重新唤醒时也尝试连接（MV3 的常见情况）
void connect();

// 端口或同意状态在引导页被修改时重连
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (BRIDGE_PORT_KEY in changes || CONSENT_KEY in changes) {
    ws?.close();
    ws = null;
    void connect();
  }
});

// 页面导航后重新绘制泛光（overlay 脚本本身由 CDP 自动重注入）
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && attachedTabs.has(tabId)) {
    // 导航会清掉注入的脚本实例，但 addScriptToEvaluateOnNewDocument 会重新注入，
    // 因此只需在新文档就绪后重绘一次状态
    setTimeout(() => void refreshOverlay(tabId), 400);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
});

// 供弹窗查询状态
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg !== 'object' || msg === null) return false;
  const type = (msg as Record<string, unknown>)['type'];
  if (type === 'bua:status') {
    void (async () => {
      const log = await getLog();
      sendResponse({
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
        port: await getPort(),
        consentGiven: await isConsentGiven(),
        attachedTabs: [...attachedTabs],
        capabilities: currentCapabilities,
        log,
      });
    })();
    return true; // 异步响应
  }
  if (type === 'bua:setCapabilities') {
    const caps = (msg as Record<string, unknown>)['capabilities'];
    if (typeof caps === 'object' && caps !== null) {
      currentCapabilities = caps as Capabilities;
      void refreshAllOverlays();
    }
    return false;
  }
  return false;
});

export {};
