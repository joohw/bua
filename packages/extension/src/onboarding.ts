/**
 * 引导页逻辑。
 *
 * 这一页承担两件事：
 *
 * 1. **风险告知 + 主动同意** —— 产品要求，也是 Chrome Web Store 的
 *    Prominent Disclosure 硬要求（官方明文：商店描述或内联安装页里的披露
 *    **不算数**，必须发生在扩展自己的 UI 内，且用户要有一个明确的同意动作）。
 * 2. 桥端口配置。
 *
 * 同意之前不建立任何桥连接 —— 这个判断在 `background.ts` 的 `connect()` 里，
 * 所以即使有人绕过这一页也没有连接。
 *
 * ⚠️ 整体包在 IIFE 里：这个文件由 `<script>` 直接加载（不是 module），
 * 顶层 `const` 会落进全局作用域，与 popup 的同名声明冲突。
 */

void (function main(): void {
  const CONSENT_KEY = 'onboardingAcceptedAt';
  const BRIDGE_PORT_KEY = 'bridgePort';

  const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (el === null) throw new Error(`缺少元素 #${id}`);
    return el as T;
  };

  const portInput = $<HTMLInputElement>('port');
  const versionInput = $<HTMLInputElement>('chromeVersion');
  const agree = $<HTMLInputElement>('agree');
  const enableBtn = $<HTMLButtonElement>('enable');
  const statusEl = $<HTMLDivElement>('status');

  function setStatus(text: string, kind: 'ok' | 'err' | '' = ''): void {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`.trim();
  }

  async function load(): Promise<void> {
    const bag = await chrome.storage.local.get([BRIDGE_PORT_KEY, CONSENT_KEY]);
    if (typeof bag[BRIDGE_PORT_KEY] === 'number') portInput.value = String(bag[BRIDGE_PORT_KEY]);

    // 已经同意过：勾上并允许重设端口（不要求重新走一遍同意）
    if (typeof bag[CONSENT_KEY] === 'number') {
      agree.checked = true;
      enableBtn.disabled = false;
      enableBtn.textContent = '保存设置';
      setStatus(`已于 ${new Date(bag[CONSENT_KEY]).toLocaleString('zh-CN')} 启用`, 'ok');
    }

    const match = /\bChrome\/([\d.]+)/.exec(navigator.userAgent);
    versionInput.value = match?.[1] ?? '未知';
  }

  agree.addEventListener('change', () => {
    enableBtn.disabled = !agree.checked;
  });

  enableBtn.addEventListener('click', () => {
    void (async () => {
      const raw = Number(portInput.value);
      if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
        setStatus('端口需要是 1..65535 的整数', 'err');
        return;
      }
      if (!agree.checked) {
        setStatus('请先勾选同意', 'err');
        return;
      }

      const existing = await chrome.storage.local.get(CONSENT_KEY);
      const patch: Record<string, unknown> = { [BRIDGE_PORT_KEY]: raw };
      // 只在首次同意时写入时间戳 —— 之后保存端口不应覆盖原始同意时间
      if (typeof existing[CONSENT_KEY] !== 'number') {
        patch[CONSENT_KEY] = Date.now();
      }
      await chrome.storage.local.set(patch);

      setStatus('已保存，正在尝试连接桥…');
      // background 会在 storage 变化时重连；这里只是给用户一个反馈
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'bua:status' }, (res: unknown) => {
          if (chrome.runtime.lastError) {
            setStatus('已保存。打开扩展弹窗查看连接状态。', 'ok');
            return;
          }
          const connected = (res as { connected?: boolean } | undefined)?.connected === true;
          setStatus(
            connected
              ? `已连接到 ws://127.0.0.1:${raw}`
              : `已保存，但未能连接 ws://127.0.0.1:${raw}。请确认 bua-server 已启动。`,
            connected ? 'ok' : 'err',
          );
        });
      }, 600);
    })();
  });

  void load();
})();
