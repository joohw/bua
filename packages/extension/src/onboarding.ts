/** 首次展示风险告知；主动同意后展示使用教程。 */
void (function main(): void {
  const CONSENT_KEY = 'onboardingAcceptedAt';
  const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (el === null) throw new Error(`缺少元素 #${id}`);
    return el as T;
  };
  const agree = $<HTMLInputElement>('agree');
  const enableBtn = $<HTMLButtonElement>('enable');
  const statusEl = $('status');
  function setStatus(text: string, kind: 'ok' | 'err' | '' = ''): void {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`.trim();
  }
  function showTutorial(): void {
    $('disclosure').hidden = true;
    $('tutorial').hidden = false;
    document.title = 'BUA — 使用教程';
    $('pageTitle').textContent = '开始使用 BUA';
    setStatus('');
  }
  async function load(): Promise<void> {
    try {
      const bag = await chrome.storage.local.get(CONSENT_KEY);
      if (typeof bag[CONSENT_KEY] === 'number') showTutorial();
    } catch {
      setStatus('无法读取启用状态，请重新打开页面。', 'err');
    }
  }
  agree.addEventListener('change', () => {
    enableBtn.disabled = !agree.checked;
  });
  enableBtn.addEventListener('click', () => {
    void (async () => {
      if (!agree.checked) {
        setStatus('请先勾选同意', 'err');
        return;
      }
      enableBtn.disabled = true;
      try {
        const existing = await chrome.storage.local.get(CONSENT_KEY);
        if (typeof existing[CONSENT_KEY] !== 'number') {
          await chrome.storage.local.set({ [CONSENT_KEY]: Date.now() });
        }
        showTutorial();
        window.scrollTo(0, 0);
      } catch {
        setStatus('启用失败，请重试。', 'err');
      } finally {
        enableBtn.disabled = !agree.checked;
      }
    })();
  });
  void load();
})();
