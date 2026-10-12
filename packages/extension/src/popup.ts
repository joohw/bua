/**
 * 工具栏弹窗：连接状态 + 能力 + 操作流水。
 *
 * 为什么把流水放在这里而不是页面上的浮层：边缘泛光只做**氛围信号**，
 * 不占用页面面积。完整流水等用户主动查看时才展开 —— 既不干扰页面，
 * 又让「谁在操作、做了什么」随时可查。在无鉴权模型下，审计是用户唯一的追溯手段。
 *
 * ⚠️ 整体包在 IIFE 里：这个文件由 `<script>` 直接加载（不是 module），
 * 顶层 `const` 会落进全局作用域，与 onboarding 的同名声明冲突。
 */

void (function main(): void {
  interface ActivityEntry {
    ts: number;
    method: string;
    risk: 'read' | 'write' | 'destructive';
    targetDescription?: string;
    ok: boolean;
    errorCode?: string;
    sessionId?: string;
  }

  interface StatusResponse {
    connected: boolean;
    port: number;
    consentGiven: boolean;
    attachedTabs: number[];
    capabilities: Record<string, unknown> & { notes?: string[] };
    log: ActivityEntry[];
  }

  const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (el === null) throw new Error(`缺少元素 #${id}`);
    return el as T;
  };

  const dot = $<HTMLSpanElement>('dot');
  const conn = $<HTMLHeadingElement>('conn');
  const meta = $<HTMLDivElement>('meta');
  const caps = $<HTMLDivElement>('caps');
  const warn = $<HTMLDivElement>('warn');
  const empty = $<HTMLDivElement>('empty');
  const logList = $<HTMLUListElement>('log');
  const clearBtn = $<HTMLButtonElement>('clear');
  const settingsBtn = $<HTMLButtonElement>('openOnboarding');
  const reconnectBtn = $<HTMLButtonElement>('reconnect');

  /** 能力的中文名。未列出的键直接显示原名。 */
  const CAP_LABELS: Record<string, string> = {
    cdp: 'CDP',
    screenshots: '截图',
    fileUploads: '上传',
    downloads: '下载',
    evaluate: '执行 JS',
    management: '浏览器管理',
  };

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function renderCaps(capabilities: StatusResponse['capabilities']): void {
    caps.textContent = '';
    for (const [key, value] of Object.entries(capabilities)) {
      if (key === 'notes') continue;
      const el = document.createElement('span');
      el.className = `cap ${value === true ? 'on' : 'off'}`;
      el.textContent = CAP_LABELS[key] ?? key;
      caps.appendChild(el);
    }
  }

  function renderLog(entries: ActivityEntry[]): void {
    logList.textContent = '';
    if (entries.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    for (const e of entries) {
      const li = document.createElement('li');

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = fmtTime(e.ts);

      const badge = document.createElement('span');
      badge.className = `badge ${e.risk}`;
      badge.textContent = e.risk === 'destructive' ? '危险' : e.risk === 'write' ? '写' : '读';

      const body = document.createElement('div');
      body.className = 'body';
      const m = document.createElement('div');
      m.className = `m${e.ok ? '' : ' fail'}`;
      m.textContent = e.method + (e.errorCode !== undefined ? ` → ${e.errorCode}` : '');
      body.appendChild(m);

      if (e.targetDescription !== undefined) {
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = e.targetDescription;
        body.appendChild(desc);
      }

      li.append(badge, time, body);
      logList.appendChild(li);
    }
  }

  function render(res: StatusResponse): void {
    dot.className = `dot ${res.connected ? 'on' : 'off'}`;

    if (!res.consentGiven) {
      conn.textContent = '尚未启用';
    } else {
      conn.textContent = res.connected ? '已连接本地桥' : '未连接到桥';
    }

    const attached = res.attachedTabs.length;
    meta.textContent = `ws://127.0.0.1:${res.port}${attached > 0 ? ` · 已接管 ${attached} 个标签` : ''}`;

    renderCaps(res.capabilities ?? {});

    const notes = res.capabilities?.notes;
    if (Array.isArray(notes) && notes.length > 0) {
      warn.style.display = 'block';
      warn.textContent = notes.join('；');
    } else {
      warn.style.display = 'none';
    }

    renderLog(res.log ?? []);
  }

  function refresh(): void {
    chrome.runtime.sendMessage({ type: 'bua:status' }, (res: unknown) => {
      if (chrome.runtime.lastError || res === undefined) {
        conn.textContent = '无法读取状态';
        dot.className = 'dot off';
        meta.textContent = chrome.runtime.lastError?.message ?? '';
        return;
      }
      render(res as StatusResponse);
    });
  }

  // 打开时拉一次；之后 background 写审计时会广播，收到就刷新
  refresh();

  chrome.runtime.onMessage.addListener((msg: unknown) => {
    if (
      typeof msg === 'object' &&
      msg !== null &&
      (msg as Record<string, unknown>)['type'] === 'bua:log'
    ) {
      refresh();
    }
    return false;
  });

  clearBtn.addEventListener('click', () => {
    void chrome.storage.local.set({ activityLog: [] }).then(refresh);
  });

  settingsBtn.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
})();
