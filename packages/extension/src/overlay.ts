/**
 * 边缘泛光覆盖层 —— BUA 的「正在被操控」视觉信号。
 *
 * 设计要点：
 *
 * 1. **Shadow DOM 完全隔离** —— 页面 CSS 无法影响我们，我们也影响不到页面。
 *    这是必须的：宿主页面的 `* { }` 规则与 `z-index` 战争会让普通注入失效。
 * 2. **`pointer-events: none`** —— 绝不拦截用户的点击。视觉上存在，交互上透明。
 * 3. **泛光 = inset 三层 + 外溢一层** —— inset 画向内的光晕，外溢部分让光晕
 *    超出视口边缘，看起来像屏幕在发光，而不只是一个内边框。
 * 4. **`position: fixed` + 满视口** —— 页面滚动时不动。
 *
 * 与 Chrome 调试横幅的关系：横幅是 Chrome 的，无法隐藏、用户一关即终止会话；
 * 泛光是 BUA 自己的，能在横幅之外独立表达状态（例如「已降级，无 CDP」）。
 *
 * **职责边界**：泛光只做**氛围信号**，不做信息面板。完整操作流水在扩展弹窗里
 * （用户主动点击入口查看），不占用页面面积、也不需要悬停交互。
 *
 * 这个模块的内容会被 `Page.addScriptToEvaluateOnNewDocument` 注入，
 * 因此源码里那个函数**必须自包含** —— 不能有 import、不引用外部作用域。
 */

/** 覆盖层挂在页面 `globalThis` 上的键名。 */
export const OVERLAY_GLOBAL = '__BUA_OVERLAY__';

/** 覆盖层状态。 */
export type OverlayState = 'active' | 'paused' | 'degraded' | 'idle';

export interface OverlayOptions {
  state: OverlayState;
  /** 覆盖默认标签文案。 */
  label?: string;
  /**
   * 警示行。**仅在有内容时显示**，用于降级/错误这类用户必须知道的事。
   * 以 `⚠` 开头的行会以警示色渲染。
   */
  warnings?: string[];
}

/**
 * 注入用的脚本源码。
 *
 * 刻意写成「函数序列化」而不是直接拼模板字符串里的裸 JS —— 这样编辑器与
 * `tsc` 会对这份代码做语法检查，改错立刻在编译期暴露，而不是等注入到
 * 用户页面里才静默失败。
 */
export const OVERLAY_SCRIPT: string = `(${overlayMain.toString()})(${JSON.stringify(OVERLAY_GLOBAL)});`;

/**
 * 覆盖层主函数。被 `toString()` 序列化后注入页面执行。
 *
 * ⚠️ **不能引用任何外部变量、类型或 import** —— 它被序列化后独立运行在页面里。
 * 需要的常量全部写在函数体内。
 */
function overlayMain(globalKey: string): void {
  type StateName = 'active' | 'paused' | 'degraded' | 'idle';

  interface OverlayApi {
    set(options: { state: StateName; label?: string; warnings?: string[] }): void;
    destroy(): void;
  }

  // 幂等：重复注入不应产生两层光晕
  const bag = globalThis as unknown as Record<string, OverlayApi | undefined>;
  if (bag[globalKey] !== undefined) return;

  const HOST_ID = 'bua-edge-glow-host';

  const COLORS: Record<StateName, { solid: string; mid: string; soft: string }> = {
    active: { solid: 'rgba(59,130,246,0.95)', mid: 'rgba(96,165,250,0.55)', soft: 'rgba(37,99,235,0.30)' },
    paused: { solid: 'rgba(148,163,184,0.78)', mid: 'rgba(148,163,184,0.36)', soft: 'rgba(100,116,139,0.18)' },
    degraded: { solid: 'rgba(245,158,11,0.95)', mid: 'rgba(251,191,36,0.55)', soft: 'rgba(217,119,6,0.30)' },
    idle: { solid: 'rgba(148,163,184,0.45)', mid: 'rgba(148,163,184,0.22)', soft: 'rgba(100,116,139,0.12)' },
  };

  const LABELS: Record<StateName, string> = {
    active: 'BUA 正在操作',
    paused: 'BUA 已暂停',
    degraded: 'BUA 降级模式',
    idle: 'BUA 待机',
  };

  const STYLES = [
    ':host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;contain:strict}',
    '.glow{position:absolute;inset:0;pointer-events:none;border-radius:2px;transition:box-shadow 320ms ease;animation:buaPulse 2.8s ease-in-out infinite}',
    '@keyframes buaPulse{0%,100%{opacity:1}50%{opacity:.62}}',
    '.badge{position:absolute;top:0;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:7px;',
    'padding:4px 12px 5px;border-radius:0 0 9px 9px;color:#fff;white-space:nowrap;pointer-events:none;',
    'font:600 11px/1.35 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;',
    'box-shadow:0 2px 10px rgba(0,0,0,.35);transition:background 320ms ease}',
    '.dot{width:6px;height:6px;border-radius:50%;background:#fff;animation:buaBlink 1.6s ease-in-out infinite}',
    '@keyframes buaBlink{0%,100%{opacity:1}50%{opacity:.3}}',
    '.warn{position:absolute;top:30px;left:50%;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));',
    'display:none;flex-direction:column;gap:3px;padding:8px 12px;border-radius:9px;',
    'background:rgba(15,23,42,.95);border:1px solid rgba(251,191,36,.45);color:#fde68a;',
    'font:400 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 6px 22px rgba(0,0,0,.45)}',
    '.warn span{display:block}',
    '@media (prefers-reduced-motion:reduce){.glow,.dot{animation:none !important}}',
  ].join('');

  let host: HTMLElement | null = null;
  let glow: HTMLElement | null = null;
  let badge: HTMLElement | null = null;
  let badgeText: HTMLElement | null = null;
  let warnBox: HTMLElement | null = null;

  function build(): void {
    if (host !== null) return;
    const parent = document.body ?? document.documentElement;
    if (parent === null || parent === undefined) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('style', 'all:initial;pointer-events:none');
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;

    glow = document.createElement('div');
    glow.className = 'glow';

    badge = document.createElement('div');
    badge.className = 'badge';
    const dot = document.createElement('span');
    dot.className = 'dot';
    badgeText = document.createElement('span');
    badge.append(dot, badgeText);

    warnBox = document.createElement('div');
    warnBox.className = 'warn';

    shadow.append(style, glow, badge, warnBox);
    parent.appendChild(host);
  }

  function apply(options: { state: StateName; label?: string; warnings?: string[] }): void {
    build();
    if (glow === null || badge === null || badgeText === null || warnBox === null) return;

    const key: StateName =
      options.state === 'active' ||
      options.state === 'paused' ||
      options.state === 'degraded' ||
      options.state === 'idle'
        ? options.state
        : 'idle';
    const c = COLORS[key];

    glow.style.boxShadow = [
      'inset 0 0 6px 1px ' + c.solid,
      'inset 0 0 22px 4px ' + c.mid,
      'inset 0 0 60px 14px ' + c.soft,
      '0 0 30px 3px ' + c.soft,
    ].join(',');

    badge.style.background = c.solid;
    badgeText.textContent = options.label !== undefined ? options.label : LABELS[key];

    const warnings = options.warnings !== undefined ? options.warnings : [];
    warnBox.textContent = '';
    if (warnings.length === 0) {
      warnBox.style.display = 'none';
    } else {
      warnBox.style.display = 'flex';
      for (const line of warnings) {
        const span = document.createElement('span');
        span.textContent = line;
        warnBox.appendChild(span);
      }
    }
  }

  function destroy(): void {
    if (host !== null) host.remove();
    host = null;
    glow = null;
    badge = null;
    badgeText = null;
    warnBox = null;
  }

  bag[globalKey] = { set: apply, destroy };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply({ state: 'idle' }), { once: true });
  } else {
    apply({ state: 'idle' });
  }
}
