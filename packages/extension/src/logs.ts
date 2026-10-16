void (function main(): void {
  interface Entry {
    ts: number;
    tabId?: number;
    url?: string;
    method: string;
    ok: boolean;
    errorCode?: string;
    targetDescription?: string;
  }
  interface Page { entries: Entry[]; nextCursor: string | null; error?: string }
  const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const select = get<HTMLButtonElement>('page');
  const picker = get('picker');
  const pages = get('pages');
  let selectedId = ''; 
  const list = get('log');
  const state = get('state');
  const retry = get<HTMLButtonElement>('retry');
  const updates = get<HTMLButtonElement>('updates');
  let tabs: chrome.tabs.Tab[] = [];
  let cursor: string | null = null;
  let more = true;
  let busy = false;
  let generation = 0;
  const selected = (): chrome.tabs.Tab | undefined => tabs.find(tab => String(tab.id) === selectedId);

  function pageContent(tab: chrome.tabs.Tab): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const icon = document.createElement('span');
    icon.className = 'favicon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '◎';
    if (tab.favIconUrl && /^(https?:|data:image\/)/i.test(tab.favIconUrl)) {
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      img.src = tab.favIconUrl;
      icon.append(img);
    }
    const text = document.createElement('span');
    text.className = 'page-text';
    text.textContent = `${tab.title || tab.url} — ${tab.url}`;
    fragment.append(icon, text);
    return fragment;
  }
  function closePicker(focus = false): void {
    pages.hidden = true;
    select.setAttribute('aria-expanded', 'false');
    if (focus) select.focus();
  }
  function renderPicker(): void {
    pages.textContent = '';
    select.disabled = tabs.length === 0;
    const tab = selected();
    select.replaceChildren(tab ? pageContent(tab) : document.createTextNode('暂无可查看的页面'));
    select.title = tab ? `${tab.title || ''} — ${tab.url}` : '';
    for (const item of tabs) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(item.id === tab?.id));
      option.tabIndex = -1;
      option.title = `${item.title || ''} — ${item.url}`;
      option.append(pageContent(item));
      option.addEventListener('click', () => {
        selectedId = String(item.id);
        closePicker(true);
        renderPicker();
        reset();
      });
      pages.append(option);
    }
  }
  function openPicker(last = false): void {
    if (!tabs.length) return;
    pages.hidden = false;
    select.setAttribute('aria-expanded', 'true');
    const options = Array.from(pages.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    (last ? options.at(-1) : options.find(option => option.getAttribute('aria-selected') === 'true') ?? options[0])?.focus();
  }
  select.addEventListener('click', () => pages.hidden ? openPicker() : closePicker());
  select.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); openPicker(event.key === 'ArrowUp');
    }
  });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePicker(true); }
    if (event.key === 'Tab') closePicker();
    if (pages.hidden || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(pages.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  });
  document.addEventListener('click', event => { if (!picker.contains(event.target as Node)) closePicker(); });
  picker.addEventListener('focusout', event => {
    if (!picker.contains(event.relatedTarget as Node | null)) closePicker();
  });

  async function load(): Promise<void> {
    const tab = selected();
    if (!tab || busy || !more) return;
    const version = generation;
    busy = true;
    retry.hidden = true;
    state.textContent = '正在加载…';
    try {
      const page = await chrome.runtime.sendMessage({ type: 'bua:logPage', tabId: tab.id, url: tab.url, cursor }) as Page;
      if (version !== generation) return;
      if (!page || page.error) throw new Error(page?.error);
      for (const entry of page.entries) {
        const item = document.createElement('li');
        const head = document.createElement('div');
        head.className = 'entry-head';
        const time = document.createElement('time');
        time.dateTime = new Date(entry.ts).toISOString();
        time.textContent = new Date(entry.ts).toLocaleString('zh-CN', { hour12: false });
        const method = document.createElement('code');
        method.className = 'method';
        method.textContent = entry.method;
        const result = document.createElement('span');
        result.className = `result${entry.ok ? '' : ' fail'}`;
        result.textContent = entry.ok ? '成功' : '失败';
        head.append(time, method, result);
        item.append(head);
        if (entry.targetDescription || entry.errorCode) {
          const detail = document.createElement('p');
          detail.className = 'detail';
          detail.textContent = [entry.targetDescription, entry.errorCode].filter(Boolean).join(' · ');
          item.append(detail);
        }
        list.append(item);
      }
      cursor = page.nextCursor;
      more = cursor !== null;
      state.textContent = more ? '向下滚动加载更多' : (list.childElementCount ? '已显示当前页面的全部记录' : '当前页面暂无操作记录');
    } catch {
      if (version !== generation) return;
      state.textContent = '无法读取操作日志，请重试。';
      retry.hidden = false;
    } finally {
      if (version === generation) {
        busy = false;
        if (more && retry.hidden && state.getBoundingClientRect().top < window.innerHeight) void load();
      }
    }
  }
  function reset(): void {
    generation++;
    busy = false;
    cursor = null;
    more = true;
    list.textContent = '';
    updates.hidden = true;
    void load();
  }
  async function refreshTabs(): Promise<void> {
    const previous = selectedId;
    tabs = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined && tab.url && !tab.url.startsWith('chrome-extension://'));
    tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    selectedId = tabs.some(tab => String(tab.id) === previous) ? previous : String(tabs[0]?.id ?? '');
    closePicker();
    renderPicker();
    if (!tabs.length) {
      generation++;
      list.textContent = '';
      retry.hidden = true;
      updates.hidden = true;
      state.textContent = '请先打开需要查看日志的页面。';
      return;
    }
    reset();
  }
  retry.addEventListener('click', () => void load());
  updates.addEventListener('click', reset);
  new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && retry.hidden) void load();
  }, { rootMargin: '100px' }).observe(state);
  chrome.runtime.onMessage.addListener((msg: { type?: string; entry?: Entry }) => {
    const tab = selected();
    if (msg.type === 'bua:log' && tab && msg.entry?.tabId === tab.id && msg.entry?.url === tab.url) updates.hidden = false;
    return false;
  });
  chrome.tabs.onUpdated.addListener((id, changes) => {
    if (id === selected()?.id && changes.url) void refreshTabs();
  });
  chrome.tabs.onRemoved.addListener(id => {
    if (tabs.some(tab => tab.id === id)) void refreshTabs();
  });
  window.addEventListener('focus', () => void refreshTabs().catch(() => { state.textContent = '无法读取标签页，请刷新重试。'; }));
  void refreshTabs().catch(() => { state.textContent = '无法读取标签页，请刷新重试。'; });
})();
