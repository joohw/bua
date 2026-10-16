/**
 * BUA 扩展的 service worker。
 *
 * 职责：
 *
 * 1. 连本地桥（WebSocket，客户端角色 `extension`）
 * 2. 按需 `chrome.debugger.attach` 到目标标签
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


/* ─────────────────────── 常量 ─────────────────────── */

const LOG_KEY = 'activityLog';
const CONSENT_KEY = 'onboardingAcceptedAt';
const MAX_LOG = 200;
const CONNECTION_ALARM = 'bua:connection-watchdog';

/**
 * 桥端口 —— **硬编码，不可配置**。
 *
 * 为什么固定：端口可配引入了一个纯粹自找的失败模式 —— 用户在扩展里填了一个端口、
 * 桥起在另一个端口，两边都「看起来正常」但连不上，而错误信息只有一句
 * 「请确认 bua-server 已启动」，完全指不到真正的原因。这个坑真实发生过。
 *
 * 固定之后：报错必定是「桥没跑」，指向明确。代价是无法自定义端口，
 * 换来的是不会配错。若 17432 被占用，桥会明确报端口冲突并让用户换端口启动，
 * 而不是让扩展去猜。
 *
 * 选 17432 的理由：落在 17xxx 私有段、避开常见服务，与本机已用端口无冲突。
 */
const BRIDGE_PORT = 17432;

/* ─────────────────────── 持久状态 ─────────────────────── */

interface ActivityEntry {
  id?: string;
  tabId?: number;
  url?: string;
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
const attachedTabs = new Set<number>();
const tabSessions = new Map<number, Set<string>>();
const debugGroups = new Map<number, number>();

async function markDebugging(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: 'DBG' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
  await chrome.action.setTitle({ tabId, title: 'BUA · 正在调试此标签页' });
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1 || tab.pinned) return;
    const groupId = await chrome.tabs.group({ tabIds: tabId });
    debugGroups.set(tabId, groupId);
    await chrome.tabGroups.update(groupId, { title: 'BUA · 正在调试', color: 'blue', collapsed: false });
  } catch (error) { console.warn('[bua] 标签组标识失败', error); }
}

async function clearDebugging(tabId: number): Promise<void> {
  tabSessions.delete(tabId);
  const groupId = debugGroups.get(tabId);
  debugGroups.delete(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (groupId !== undefined && tab.groupId === groupId) await chrome.tabs.ungroup(tabId);
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'BUA — 设置' });
  } catch { /* 标签已关闭 */ }
}

/**
 * 后端**实际具备**的能力。
 *
 * 初始全 `false`，直到 {@link detectCapabilities} 探测成功才置位 ——
 * 宁可先说「不知道」，也不要在探测前谎报具备 CDP。这个值会随 `bua.event`
 * 的 `backend.ready` 上报给桥，桥再广播给所有 agent。
 */
let currentCapabilities: Capabilities = {
  cdp: false,
  screenshots: false,
  fileUploads: false,
  downloads: false,
  evaluate: false,
  management: false,
  notes: ['尚未探测。'],
};

let capabilitiesProbed = false;

/**
 * 探测本实例实际具备的能力。
 *
 * 关键场景是**企业策略拒绝 CDP**（Chrome 155+）：那种情况下
 * `chrome.debugger.attach()` 在任何目标上都失败，且无法用
 * `runtime_allowed_hosts` 绕过。必须在能力里如实报告，让 agent 降级。
 *
 * 探测方式：对任意一个真实标签尝试 attach，成功即 `cdp: true`。
 */
async function detectCapabilities(): Promise<void> {
  if (capabilitiesProbed) return;

  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((tab) => /^https?:\/\//.test(tab.url ?? '') && !/^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/.test(tab.url ?? ''));
  const tab = candidates.find((candidate) => candidate.active) ?? candidates[0];
  const probeTabId = tab?.id;

  if (probeTabId === undefined) {
    currentCapabilities = {
      ...currentCapabilities,
      notes: [],
    };
    return;
  }

  try {
    await chrome.debugger.attach({ tabId: probeTabId }, '1.3');
    // attach 成功即具备完整 CDP 面
    currentCapabilities = {
      cdp: true,
      screenshots: true,
      fileUploads: true,
      downloads: true,
      evaluate: true,
      management: true,
      notes: [],
    };
    capabilitiesProbed = true;
    await chrome.debugger.detach({ tabId: probeTabId }).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const byPolicy = /restricted by policy/i.test(message);
    // 单个页面受限或调试器被占用，不能据此宣告整个浏览器已降级。
    if (!byPolicy) {
      currentCapabilities = { ...currentCapabilities, notes: [] };
      return;
    }
    currentCapabilities = {
      cdp: false,
      screenshots: !/Screenshot capture is restricted by policy/i.test(message),
      fileUploads: false,
      downloads: false,
      evaluate: false,
      management: true, // chrome.tabs / bookmarks 等不受 CDP 策略影响
      notes: [
        '⚠ 企业策略限制了 CDP 浏览器操作',
        '真实输入事件、截图与跨 iframe 一致控制不可用',
      ],
    };
    capabilitiesProbed = true; // 策略性失败不会因重试而改变
  }

  // 上报给桥，桥再广播给所有 agent（含降级说明）
  send({
    jsonrpc: '2.0',
    method: 'bua.event',
    params: {
      type: 'backend.ready',
      chromeVersion: detectChromeVersion(),
      capabilities: currentCapabilities,
    },
  });
}

function detectChromeVersion(): string | null {
  if (typeof navigator === 'undefined') return null;
  return /\bChrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null;
}


/* ─────────────────────── 存储辅助 ─────────────────────── */

async function getLog(): Promise<ActivityEntry[]> {
  const bag = await chrome.storage.local.get(LOG_KEY);
  const value = bag[LOG_KEY];
  return Array.isArray(value) ? (value as ActivityEntry[]) : [];
}

async function appendLog(entry: ActivityEntry): Promise<void> {
  const log = await getLog();
  log.unshift({ ...entry, id: crypto.randomUUID() });
  await chrome.storage.local.set({ [LOG_KEY]: log.slice(0, MAX_LOG) });
  // 通知弹窗（若打开着）
  try {
    await chrome.runtime.sendMessage({ type: 'bua:log', entry });
  } catch {
    /* 没有监听者时忽略 */
  }
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
  if (!capabilitiesProbed) {
    currentCapabilities = { cdp: true, screenshots: true, fileUploads: true, downloads: true, evaluate: true, management: true, notes: [] };
    capabilitiesProbed = true;
    send({ jsonrpc: '2.0', method: 'bua.event', params: { type: 'backend.ready', chromeVersion: detectChromeVersion(), capabilities: currentCapabilities } });
  }
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable').catch(() => {});
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => {});
  await markDebugging(tabId);
  return { ok: true };
}

async function detachTab(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    tabSessions.delete(tabId);
    return;
  }
  attachedTabs.delete(tabId);
  await clearDebugging(tabId);
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
  void clearDebugging(tabId);
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

  // 同意检查有异步等待；多个唤醒事件可能同时进入，需再次检查。
  if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const port = BRIDGE_PORT;
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  ws = socket;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  socket.addEventListener('open', () => {
    // MV3 的空闲窗口是 30 秒；真实 WebSocket 消息才能保持后台连接活跃。
    keepaliveTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ jsonrpc: '2.0', method: M.heartbeat, params: {} }));
      }
    }, 20_000);
    retryDelayMs = 2_000; // 连上了，重置退避
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
          ...(detectChromeVersion() !== null ? { chromeVersion: detectChromeVersion() } : {}),
        },
        capabilities: ['cdp', 'screenshots', 'downloads', 'evaluate', 'management'],
      },
    });
    // 连上桥后探测真实能力并上报 —— 不在探测前谎报具备 CDP
    void detectCapabilities();
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

  socket.addEventListener('close', (event) => {
    if (keepaliveTimer !== null) clearInterval(keepaliveTimer);
    console.warn('BUA 桥连接关闭', { code: event.code, reason: event.reason, wasClean: event.wasClean });
    // 手动重连时旧连接的 close 可能晚于新连接创建，不能清除新连接。
    if (ws !== socket) return;
    void Promise.all([...attachedTabs].map(detachTab));
    ws = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // close 事件会紧跟其后，重连逻辑放那里
  });
}

/**
 * 重连退避。
 *
 * 为什么必须有这个：扩展原先只在 service worker 启动时连一次桥。如果那一刻
 * 桥还没起来（很常见 —— 用户先装扩展、后启动桥），连接就永久失败，除非用户
 * 去引导页重新保存一次配置。用户的体感就是「一直提示未能连接」。
 *
 * 退避策略：起始 2 秒，每次失败翻倍，上限 30 秒。连上后重置。
 */
let retryDelayMs = 2_000;
const RETRY_MAX_MS = 30_000;

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  // 未同意时不重试 —— 用户还没授权，不该反复尝试建连
  void isConsentGiven().then((accepted) => {
    if (!accepted) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, retryDelayMs);
    retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
  });
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
  if (method === 'bua.event') {
    const event = msg['params'] as { type?: string; sessionId?: string } | undefined;
    if (event?.type === 'session.closed' && event.sessionId) {
      for (const [tabId, owners] of tabSessions) {
        owners.delete(event.sessionId);
        if (owners.size === 0) await detachTab(tabId);
      }
    }
    return;
  }
  if (typeof method !== 'string' || id === undefined) return; // 只处理请求

  const params =
    typeof msg['params'] === 'object' && msg['params'] !== null
      ? (msg['params'] as Record<string, unknown>)
      : {};
  const sessionId = typeof params['__buaSessionId'] === 'string' ? params['__buaSessionId'] : undefined;
  const risk = classifyRisk(method);
  const targetDescription =
    typeof params['targetDescription'] === 'string' ? params['targetDescription'] : undefined;

  let logTabId = typeof params['tabId'] === 'number' ? params['tabId'] : undefined;
  let logUrl: string | undefined;
  async function capturePage(tabId: number): Promise<void> {
    logTabId = tabId;
    logUrl = (await chrome.tabs.get(tabId).catch(() => undefined))?.url;
  }
  if (logTabId !== undefined) await capturePage(logTabId);

  const respond = async (result: unknown, errorCode?: string, message?: string): Promise<void> => {
    await appendLog({
      ts: Date.now(),
      ...(logTabId !== undefined ? { tabId: logTabId } : {}),
      ...(logUrl !== undefined ? { url: logUrl } : {}),
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

  /* ── 不需要 tabId 的方法（走 chrome.* 而非 CDP）── */
  switch (method) {
    case M.userOpenTabs:
    case M.tabsList: {
      const tabs = await chrome.tabs.query({});
      await respond({
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active === true,
          pinned: t.pinned === true,
          windowId: t.windowId,
          status: t.status,
          ...(method === M.userOpenTabs ? {
            audible: t.audible === true,
            claimed: (tabSessions.get(t.id!)?.size ?? 0) > 0,
            claimedBy: tabSessions.get(t.id!)?.values().next().value,
          } : {}),
        })),
      });
      return;
    }
    case M.userGetTabContext:
    case M.userClaimTab: {
      const target = params['tabId'];
      if (typeof target !== 'number') {
        await respond(null, BUA_ERROR_CODES.TAB_NOT_FOUND, '需要明确的 tabId');
        return;
      }
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(target);
      } catch {
        await respond(null, BUA_ERROR_CODES.TAB_NOT_FOUND, '标签已关闭，请重新列出标签');
        return;
      }
      if (method === M.userGetTabContext) {
        // 元数据上下文不附加 debugger，不接管页面。
        await respond({ context: { title: tab.title, url: tab.url } });
        return;
      }
      const owners = tabSessions.get(target) ?? new Set<string>();
      if (!sessionId || [...owners].some((owner) => owner !== sessionId)) {
        await respond(null, BUA_ERROR_CODES.TAB_CLAIMED, '标签已被其他会话使用，或请求缺少会话身份');
        return;
      }
      owners.add(sessionId);
      tabSessions.set(target, owners);
      await respond({ tabId: target });
      return;
    }
    case M.tabsNew: {
      const url = typeof params['url'] === 'string' ? params['url'] : undefined;
      const tab = await chrome.tabs.create({
        ...(url !== undefined ? { url } : {}),
        active: params['visible'] === true,
      });
      logTabId = tab.id;
      logUrl = tab.url ?? url;
      await respond({ tabId: tab.id, url: tab.url, title: tab.title });
      return;
    }
    case M.tabsSelected: {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      logTabId = tab?.id;
      logUrl = tab?.url;
      await respond(tab === undefined ? { tab: null } : { tab: { id: tab.id, url: tab.url, title: tab.title } });
      return;
    }
    case M.tabClose:
    case M.tabsClose: {
      const target = typeof params['tabId'] === 'number' ? params['tabId'] : undefined;
      if (target === undefined) {
        await respond(null, BUA_ERROR_CODES.UNSUPPORTED, '关闭标签需要 tabId');
        return;
      }
      await detachTab(target);
      await chrome.tabs.remove(target);
      await respond({ ok: true });
      return;
    }
    case M.browserGetDefault:
    case M.browserList: {
      const manifest = chrome.runtime.getManifest();
      await respond({
        browsers: [
          {
            id: 'extension',
            name: '本机 Chrome',
            family: 'chrome',
            type: 'extension',
            tabs: (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url, title: t.title })),
            metadata: { extensionInstanceId: chrome.runtime.id },
          },
        ],
        capabilities: currentCapabilities,
        version: manifest.version,
      });
      return;
    }
    default:
      break;
  }

  // ── 需要标签的方法 ──
  // 未显式给 tabId 时回落到当前活动标签。这让 agent 在「就是操作眼前这一页」的
  // 常见场景下少一次往返；显式传 tabId 时行为完全可预测。
  let tabId = typeof params['tabId'] === 'number' ? params['tabId'] : undefined;
  if (tabId === undefined) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id !== undefined) {
      tabId = active.id;
    }
  }
  if (tabId === undefined) {
    await respond(null, BUA_ERROR_CODES.TAB_NOT_FOUND, `方法 ${method} 需要 tabId，且当前没有活动标签`);
    return;
  }

  await capturePage(tabId);
  const attach = await attachTab(tabId);
  if (!attach.ok) {
    // attach 失败要区分：DevTools 占用可重试；企业策略不可绕过
    await respond(null, BUA_ERROR_CODES.DEBUGGER_UNAVAILABLE, attach.reason);
    return;
  }
  if (sessionId) {
    const owners = tabSessions.get(tabId) ?? new Set<string>();
    owners.add(sessionId);
    tabSessions.set(tabId, owners);
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

// 浏览器管理的 alarm 可在 SW 被回收后重新唤醒，补足 setTimeout 丢失的重试。
async function syncConnectionAlarm(): Promise<void> {
  if (await isConsentGiven()) {
    await chrome.alarms.create(CONNECTION_ALARM, { periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(CONNECTION_ALARM);
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CONNECTION_ALARM) return;
  void connect();
});
void syncConnectionAlarm();

// 点击工具栏图标直接打开设置页。
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

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

// 同意状态变化时重连（用户刚在引导页确认 → 立刻建连；撤销则需要断开）
// 端口已固定，不再监听它的变化。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (CONSENT_KEY in changes) {
    void syncConnectionAlarm();
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    retryDelayMs = 2_000;
    ws?.close();
    ws = null;
    void connect();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  void clearDebugging(tabId);
});

// 供弹窗查询状态
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg !== 'object' || msg === null) return false;
  const type = (msg as Record<string, unknown>)['type'];
  if (type === 'bua:status') {
    void (async () => {
      sendResponse({
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
        port: BRIDGE_PORT,
        consentGiven: await isConsentGiven(),
        attachedTabs: [...attachedTabs],
        capabilities: currentCapabilities,
      });
    })();
    return true; // 异步响应
  }
  if (type === 'bua:logPage') {
    void (async () => {
      // 必须先按当前标签和完整地址筛选，再分页；旧记录无法归属时不展示。
      const log = typeof msg.tabId === 'number' && typeof msg.url === 'string'
        ? (await getLog()).filter((entry) => entry.tabId === msg.tabId && entry.url === msg.url)
        : [];
      const cursor = typeof msg.cursor === 'string' ? msg.cursor : null;
      const key = (entry: ActivityEntry): string => entry.id ?? JSON.stringify(entry);
      const start = cursor === null ? 0 : log.findIndex((entry) => key(entry) === cursor) + 1;
      // 游标已超出保留窗口时停止，避免重新返回第一页。
      const entries = cursor !== null && start === 0 ? [] : log.slice(start, start + 20);
      const hasMore = entries.length > 0 && start + entries.length < log.length;
      sendResponse({ entries, nextCursor: hasMore ? key(entries[entries.length - 1]!) : null });
    })().catch(() => sendResponse({ error: '无法读取操作记录' }));
    return true;
  }
  if (type === 'bua:setCapabilities') {
    const caps = (msg as Record<string, unknown>)['capabilities'];
    if (typeof caps === 'object' && caps !== null) {
      currentCapabilities = caps as Capabilities;
    }
    return false;
  }
  if (type === 'bua:reconnect') {
    // 用户手动重试。重置退避，立刻连一次，然后把最新状态回给弹窗。
    retryDelayMs = 2_000;
    ws?.close();
    ws = null;
    void connect().then(async () => {
      // 给握手一点时间，否则弹窗拿到的仍是「未连接」
      await new Promise((r) => setTimeout(r, 350));
      sendResponse({
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
        port: BRIDGE_PORT,
      });
    });
    return true; // 异步响应
  }
  return false;
});

export {};
