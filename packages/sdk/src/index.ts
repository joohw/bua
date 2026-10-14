/**
 * `@bua/sdk` —— BUA agent 侧 SDK。
 *
 * 把「手搓 JSON-RPC 消息」变成可发现、可补全的对象树。形状**对齐 OpenAI Codex
 * 的浏览器 API**（对齐基准见 `research/03-codex-api-reference.md`），使已有针对
 * Codex 写的 agent 逻辑能低成本迁移。
 *
 * ```ts
 * const agent = await connect({ port: 17432, client: { name: 'dsh' } });
 * const browser = await agent.browsers.getDefault();
 * const [userTab] = await browser.user.openTabs();
 * const tab = await browser.user.claimTab(userTab);
 * await tab.playwright.getByRole('button', { name: '提交' })
 *   .click({ targetDescription: '提交按钮' });
 * ```
 */

import { BUA_ERROR_CODES, M, type Capabilities } from '@bua/protocol';

import { BuaError, Connection, type BridgeEvent, type ConnectOptions } from './connection.js';

export { BuaError, Connection } from './connection.js';
export type { BridgeEvent, BuaErrorInfo, ConnectOptions, HelloResult } from './connection.js';

type RpcConnection = Pick<Connection, 'call'>;

/* ─────────────────────────── 线上结构 ─────────────────────────── */

export interface TabInfo {
  id: number;
  url?: string;
  title?: string;
  active: boolean;
  pinned?: boolean;
  windowId?: number;
  status?: string;
}

export interface UserTabInfo {
  id: number;
  title?: string;
  url?: string;
  lastOpened?: number;
  windowId?: number;
  pinned?: boolean;
  audible?: boolean;
  claimed?: boolean;
  claimedBy?: string;
}

export interface UserTabContext {
  title?: string;
  url?: string;
  text?: string;
  truncated?: boolean;
}

export interface BrowserInfo {
  id: string;
  name?: string;
  family?: string;
  type?: 'extension' | 'cdp' | 'iab' | 'mcpapps';
  tabs?: TabInfo[];
  metadata?: Record<string, unknown>;
}

/** 所有变更型方法必须携带的意图描述。 */
export interface Intent {
  /**
   * **人类可读**的目标描述，例如 `"结算按钮（￥299）"`。
   *
   * 必填，理由见设计文档：**坐标无法让人判断风险，描述可以**。
   * 桥会在转发前校验它非空。
   */
  targetDescription: string;
}

/* ─────────────────────────── 定位器 ─────────────────────────── */

export interface LocatorOptions {
  exact?: boolean;
  name?: string;
}

/**
 * Playwright 层定位器。
 *
 * 每次调用都会**重新按选择器查询** DOM，因此不必手动重新获取 ——
 * 页面变化后下一次调用自然拿到新元素。（我们没有用 Codex 那种服务端句柄模型，
 * 因为按选择器重查在这个 SDK 的粒度上更简单，也更不容易踩到句柄过期的坑。）
 */
export class Locator {
  readonly #conn: RpcConnection;
  readonly #selector: string;
  readonly #role: { role: string; name?: string; exact?: boolean } | null;

  constructor(
    conn: RpcConnection,
    selector: string,
    role: { role: string; name?: string; exact?: boolean } | null = null,
  ) {
    this.#conn = conn;
    this.#selector = selector;
    this.#role = role;
  }

  get selector(): string {
    return this.#selector;
  }

  /** 定位器链：`locator.filter({ hasText })` 之类暂未实现，先只支持嵌套查询。 */
  locator(selector: string): Locator {
    return new Locator(this.#conn, `${this.#selector} ${selector}`);
  }

  async click(intent: Intent): Promise<void> {
    await this.#conn.call(M.locatorClick, {
      selector: this.#selector,
      targetDescription: intent.targetDescription,
    });
  }

  async fill(value: string, intent: Intent): Promise<void> {
    await this.#conn.call(M.locatorFill, {
      selector: this.#selector,
      value,
      targetDescription: intent.targetDescription,
    });
  }

  async innerText(): Promise<string | null> {
    const r = await this.#conn.call<{ result: { value: string | null } }>(M.locatorInnerText, {
      selector: this.#selector,
    });
    return r.result.value;
  }

  async textContent(): Promise<string | null> {
    const r = await this.#conn.call<{ result: { value: string | null } }>(M.locatorTextContent, {
      selector: this.#selector,
    });
    return r.result.value;
  }

  async isVisible(): Promise<boolean> {
    const r = await this.#conn.call<{ result: { value: boolean } }>(M.locatorIsVisible, {
      selector: this.#selector,
    });
    return r.result.value;
  }

  async isEnabled(): Promise<boolean> {
    const r = await this.#conn.call<{ result: { value: boolean } }>(M.locatorIsEnabled, {
      selector: this.#selector,
    });
    return r.result.value;
  }

  async count(): Promise<number> {
    const r = await this.#conn.call<{ result: { value: number } }>(M.locatorCount, {
      selector: this.#selector,
    });
    return r.result.value;
  }
}

/* ─────────────────── Playwright / AX / CUA 命名空间 ─────────────────── */

export interface DomNode {
  id: number;
  tag: string;
  role?: string;
  name?: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export class PlaywrightApi {
  readonly #conn: RpcConnection;
  constructor(conn: RpcConnection) {
    this.#conn = conn;
  }

  /** 语义定位：CSS 选择器。 */
  locator(selector: string): Locator {
    return new Locator(this.#conn, selector);
  }

  getByRole(role: string, options: LocatorOptions = {}): Locator {
    // 用属性选择器近似 role/name —— 完整 ARIA 语义解析留给扩展侧
    const name = options.name;
    const sel =
      name !== undefined
        ? `[role="${role}"], ${role}[aria-label*="${name}"]`
        : `[role="${role}"], ${role}`;
    return new Locator(this.#conn, sel, { role, ...(name !== undefined ? { name } : {}) });
  }

  getByText(text: string): Locator {
    return new Locator(this.#conn, `:is(button,a,span,div,label):has-text("${text}")`);
  }

  getByLabel(text: string): Locator {
    return new Locator(this.#conn, `[aria-label*="${text}"]`);
  }

  getByPlaceholder(text: string): Locator {
    return new Locator(this.#conn, `[placeholder*="${text}"]`);
  }

  getByTestId(testId: string): Locator {
    return new Locator(this.#conn, `[data-testid="${testId}"]`);
  }

  /** 带节点 id 的可交互元素清单 —— 首选的结构化观察方式。 */
  async domSnapshot(): Promise<DomNode[]> {
    const r = await this.#conn.call<{ result: { value: DomNode[] } }>(M.pwDomSnapshot, {});
    return r.result.value;
  }

  /** 在页面里执行 JS 并回传值。 */
  async evaluate<T = unknown>(functionSource: string): Promise<T> {
    const r = await this.#conn.call<{ result: { value: T } }>(M.pwEvaluate, { functionSource });
    return r.result.value;
  }

  async waitForTimeout(timeoutMs: number): Promise<void> {
    await this.#conn.call(M.pwWaitForTimeout, { timeoutMs });
  }

  async waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    await this.#conn.call(M.pwWaitForLoadState, { state });
  }
}

export class AxApi {
  readonly #conn: RpcConnection;
  constructor(conn: RpcConnection) {
    this.#conn = conn;
  }

  /** 无障碍状态快照（只读，不产生副作用）。 */
  async get(): Promise<string> {
    const r = await this.#conn.call<{ result: { value: string } }>(M.axGet, {});
    return r.result.value;
  }

  async click(x: number, y: number, intent: Intent): Promise<void> {
    await this.#conn.call(M.axClick, { x, y, targetDescription: intent.targetDescription });
  }
}

export class CuaApi {
  readonly #conn: RpcConnection;
  constructor(conn: RpcConnection) {
    this.#conn = conn;
  }

  async click(x: number, y: number, intent: Intent): Promise<void> {
    await this.#conn.call(M.cuaClick, { x, y, targetDescription: intent.targetDescription });
  }

  async doubleClick(x: number, y: number, intent: Intent): Promise<void> {
    await this.#conn.call(M.cuaDoubleClick, { x, y, targetDescription: intent.targetDescription });
  }

  async move(x: number, y: number): Promise<void> {
    await this.#conn.call(M.cuaMove, { x, y });
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.#conn.call(M.cuaScroll, { x, y, deltaX, deltaY });
  }

  async type(text: string, intent: Intent): Promise<void> {
    await this.#conn.call(M.cuaType, { text, targetDescription: intent.targetDescription });
  }

  async keypress(key: string, intent: Intent): Promise<void> {
    await this.#conn.call(M.cuaKeypress, { key, targetDescription: intent.targetDescription });
  }
}

export class DomCuaApi {
  readonly #conn: RpcConnection;
  constructor(conn: RpcConnection) {
    this.#conn = conn;
  }

  /** 返回带节点 id 的可见 DOM（`dom_cua.get_visible_dom` 的包装）。 */
  async getVisibleDom(): Promise<DomNode[]> {
    const r = await this.#conn.call<{ result: { value: DomNode[] } }>(M.pwDomSnapshot, {});
    return r.result.value;
  }

  async click(nodeId: number, intent: Intent): Promise<void> {
    await this.#conn.call(M.domCuaClick, { nodeId, targetDescription: intent.targetDescription });
  }
}

export class ContentApi {
  readonly #conn: RpcConnection;
  constructor(conn: RpcConnection) {
    this.#conn = conn;
  }

  async export(): Promise<string> {
    const r = await this.#conn.call<{ path: string }>(M.contentExport, {});
    return r.path;
  }
}

/* ─────────────────────────── 标签 ─────────────────────────── */

export class Tab {
  readonly #conn: Connection;
  readonly id: number;
  readonly playwright: PlaywrightApi;
  readonly ax: AxApi;
  readonly cua: CuaApi;
  readonly domCua: DomCuaApi;
  readonly content: ContentApi;

  constructor(conn: Connection, id: number) {
    this.#conn = conn;
    this.id = id;
    const scoped: RpcConnection = {
      call: (method, params = {}) => conn.call(method, { ...params, tabId: id }),
    };
    this.playwright = new PlaywrightApi(scoped);
    this.ax = new AxApi(scoped);
    this.cua = new CuaApi(scoped);
    this.domCua = new DomCuaApi(scoped);
    this.content = new ContentApi(scoped);
  }

  /* 导航 */
  async goto(url: string, intent: Intent): Promise<void> {
    await this.#conn.call(M.tabGoto, { tabId: this.id, url, targetDescription: intent.targetDescription });
  }
  async back(): Promise<void> {
    await this.#conn.call(M.tabBack, { tabId: this.id });
  }
  async forward(): Promise<void> {
    await this.#conn.call(M.tabForward, { tabId: this.id });
  }
  async reload(): Promise<void> {
    await this.#conn.call(M.tabReload, { tabId: this.id });
  }

  /**
   * 关闭标签。
   *
   * 桥把 `tab.close` 归为 write 类（会改变浏览器状态），因此要求
   * `targetDescription`。但「关闭这个标签」的意图是自明的 —— 让调用方为了关一个
   * 标签去编一句描述纯属摩擦。所以这里**由 SDK 显式提供一个说明性描述**，
   * 而不是把它变成调用方的负担。
   *
   * 若调用方有更具体的意图要记录（例如「关闭登录页，因为已完成」），可传入覆盖。
   */
  async close(intent?: Intent): Promise<void> {
    await this.#conn.call(M.tabClose, {
      tabId: this.id,
      targetDescription: intent?.targetDescription ?? `关闭标签页 #${this.id}`,
    });
  }

  /* 观察 */
  async url(): Promise<string | null> {
    const r = await this.#conn.call<{ result: { value: string | null } }>(M.tabUrl, { tabId: this.id });
    return r.result.value;
  }
  async title(): Promise<string | null> {
    const r = await this.#conn.call<{ result: { value: string | null } }>(M.tabTitle, { tabId: this.id });
    return r.result.value;
  }

  /** 截图。返回 PNG/JPEG 字节。 */
  async screenshot(
    options: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean } = {},
  ): Promise<Buffer> {
    const r = await this.#conn.call<{ data: string }>(M.tabScreenshot, {
      tabId: this.id,
      ...options,
    });
    return Buffer.from(r.data, 'base64');
  }

  /* 会话生命周期（对齐 Codex） */
  async markDeliverable(): Promise<void> {
    await this.#conn.call(M.tabMarkDeliverable, { tabId: this.id });
  }
  async markHandoff(): Promise<void> {
    await this.#conn.call(M.tabMarkHandoff, { tabId: this.id });
  }

  /* ── 便捷方法 ──
   * 这几个不是 Codex 的 API，是为「少写样板」加的糖。
   * 底层仍是同一套 locator 调用，行为一致。 */

  /** 按 CSS 选择器点击。等价于 `tab.playwright.locator(sel).click(intent)`。 */
  async click(selector: string, intent: Intent): Promise<void> {
    return this.playwright.locator(selector).click(intent);
  }

  /** 按 CSS 选择器填值。 */
  async fill(selector: string, value: string, intent: Intent): Promise<void> {
    return this.playwright.locator(selector).fill(value, intent);
  }

  /** 读页面可见文本，用于快速摸底。 */
  async text(): Promise<string> {
    return this.playwright.evaluate<string>('document.body.innerText');
  }
}

/* ─────────────────────────── 标签集合 ─────────────────────────── */

export class Tabs {
  readonly #conn: Connection;
  constructor(conn: Connection) {
    this.#conn = conn;
  }

  async list(): Promise<TabInfo[]> {
    const r = await this.#conn.call<{ tabs?: TabInfo[] }>(M.tabsList, {});
    /*
     * 形状校验是刻意的。
     *
     * 若扩展回了 `{}` 或非预期结构，直接 `.length` 会抛 `Cannot read properties of
     * undefined`，那个错误在 MCP / HTTP 这类上层会变成一句无从下手的内部异常 ——
     * 调用方既不知道是哪一层出的问题，也拿不到可路由的 buaCode。
     * 这里显式区分「协议形状不符」与「真的有标签」。
     */
    if (!Array.isArray(r?.tabs)) {
      throw new BuaError({
        buaCode: BUA_ERROR_CODES.INTERNAL,
        message: '后端返回的标签列表格式不正确（期望 tabs 数组）。可能是扩展版本与协议不匹配。',
      });
    }
    return r.tabs;
  }

  async get(id: number): Promise<Tab> {
    return new Tab(this.#conn, id);
  }

  async new(options: { url?: string; visible?: boolean } = {}): Promise<Tab> {
    const r = await this.#conn.call<{ tabId: number }>(M.tabsNew, options);
    return new Tab(this.#conn, r.tabId);
  }

  async selected(): Promise<Tab | null> {
    const r = await this.#conn.call<{ tab: { id: number } | null }>(M.tabsSelected, {});
    return r.tab === null ? null : new Tab(this.#conn, r.tab.id);
  }

  /** 批量在后台标签取内容，不改变当前选中标签。 */
  async content(urls: string[]): Promise<Array<{ url?: string; text?: string; title?: string }>> {
    const r = await this.#conn.call<{ results: Array<{ url?: string; text?: string; title?: string }> }>(
      M.tabsContent,
      { urls },
    );
    return r.results;
  }
}

/* ─────────────────────────── 用户标签 ─────────────────────────── */

/**
 * 操作**用户自己打开的**标签 —— 这是 BUA 相对独立浏览器方案的核心价值：
 * 真实登录态，不需要重新登录。
 */
export class BrowserUser {
  readonly #conn: Connection;
  constructor(conn: Connection) {
    this.#conn = conn;
  }

  /** 列出用户打开的标签（不改动它们）。 */
  async openTabs(): Promise<UserTabInfo[]> {
    const r = await this.#conn.call<{ tabs: UserTabInfo[] }>(M.userOpenTabs, {});
    return r.tabs;
  }

  /** 只读地取一个有界的页面上下文，不接管标签。 */
  async getTabContext(tabId: number): Promise<UserTabContext> {
    const r = await this.#conn.call<{ context: UserTabContext }>(M.userGetTabContext, { tabId });
    return r.context;
  }

  /** 接管一个用户标签，返回可操作的 {@link Tab}。 */
  async claimTab(tab: UserTabInfo | number): Promise<Tab> {
    const tabId = typeof tab === 'number' ? tab : tab.id;
    const r = await this.#conn.call<{ tabId: number }>(M.userClaimTab, { tabId });
    return new Tab(this.#conn, r.tabId);
  }
}

/* ─────────────────────────── 浏览器 ─────────────────────────── */

export class Browser {
  readonly #conn: Connection;
  readonly id: string;
  readonly tabs: Tabs;
  readonly user: BrowserUser;

  constructor(conn: Connection, id: string) {
    this.#conn = conn;
    this.id = id;
    this.tabs = new Tabs(conn);
    this.user = new BrowserUser(conn);
  }

  /** 后端**此刻实际**具备的能力。降级场景据此判断，而不是假定能力存在。 */
  async capabilities(): Promise<Capabilities> {
    const r = await this.#conn.call<{ capabilities: Capabilities }>(M.browserList, {});
    return r.capabilities;
  }

  /** 名称当前自动化会话（便于在浏览器里辨认）。 */
  async nameSession(name: string): Promise<void> {
    await this.#conn.call(M.browserNameSession, { browserId: this.id, name });
  }

  async history(): Promise<Array<{ url: string; title?: string; dateVisited: number }>> {
    const r = await this.#conn.call<{ entries: Array<{ url: string; title?: string; dateVisited: number }> }>(
      M.browserHistory,
      { browserId: this.id },
    );
    return r.entries;
  }
}

/* ─────────────────────────── 浏览器集合 ─────────────────────────── */

export class Browsers {
  readonly #conn: Connection;
  constructor(conn: Connection) {
    this.#conn = conn;
  }

  /** 列出可用浏览器。 */
  async list(): Promise<BrowserInfo[]> {
    const r = await this.#conn.call<{ browsers?: BrowserInfo[] }>(M.browserList, {});
    // 同 tabs.list：形状不符时给可路由的错误，而不是崩在 undefined 上
    if (!Array.isArray(r?.browsers)) {
      throw new BuaError({
        buaCode: BUA_ERROR_CODES.INTERNAL,
        message: '后端返回的浏览器列表格式不正确（期望 browsers 数组）。可能是扩展版本与协议不匹配。',
      });
    }
    return r.browsers;
  }

  async get(id: string): Promise<Browser> {
    await this.#conn.call(M.browserGet, { id });
    return new Browser(this.#conn, id);
  }

  /**
   * 取默认浏览器。
   *
   * v0 桥只支持单后端（一个扩展），所以默认浏览器恒为第一个（`extension`）。
   * 保留这个方法是为了对齐 Codex 的形状，将来多 profile 时无需改调用方。
   *
   * @throws {BuaError} `BUA_UNSUPPORTED` —— 没有任何扩展连接到桥时
   */
  async getDefault(): Promise<Browser> {
    const browsers = await this.list();
    const first = browsers[0];
    if (first === undefined) {
      throw new BuaError({
        buaCode: BUA_ERROR_CODES.UNSUPPORTED,
        message:
          '没有可用的浏览器后端。请确认 BUA 扩展已安装、已启用，且已在引导页完成授权（扩展会主动连接本地桥）。',
      });
    }
    return new Browser(this.#conn, first.id);
  }

  async getForUrl(url: string): Promise<Browser> {
    await this.#conn.call(M.browserGetForUrl, { url });
    return new Browser(this.#conn, 'extension');
  }
}

/* ─────────────────────────── 根对象 ─────────────────────────── */

/**
 * agent 侧入口，对应 Codex 的 `Agent` 根对象。
 *
 * ```ts
 * const agent = await connect({ port: 17432, client: { name: 'dsh' } });
 * ```
 */
export class Agent {
  readonly #conn: Connection;
  readonly browsers: Browsers;

  private constructor(conn: Connection) {
    this.#conn = conn;
    this.browsers = new Browsers(conn);
  }

  /** 建立连接并完成握手。 */
  static async connect(options: ConnectOptions & { client: { name: string; version?: string } }): Promise<Agent> {
    const conn = new Connection(options);
    await conn.connect(options.client);
    return new Agent(conn);
  }

  /** 本会话在桥侧的 id —— 审计里用它区分「谁干的」。 */
  get sessionId(): string | null {
    return this.#conn.sessionId;
  }

  /** 后端**此刻**的能力。降级时 `cdp === false`。 */
  get capabilities(): Capabilities | null {
    return this.#conn.capabilities;
  }

  /** 底层连接，供需要直接发方法的高级用法。 */
  get connection(): Connection {
    return this.#conn;
  }

  /** 订阅桥事件（`tab.updated` / `debugger.detached` / `backend.gone` 等）。 */
  onEvent(handler: (e: BridgeEvent) => void): () => void {
    return this.#conn.onEvent(handler);
  }

  async close(): Promise<void> {
    await this.#conn.close();
  }
}

/** 便捷入口：`const agent = await connect({ port })`。 */
export async function connect(
  options: ConnectOptions & { client?: { name: string; version?: string } },
): Promise<Agent> {
  const { client, ...rest } = options;
  return Agent.connect({ ...rest, client: client ?? { name: 'bua-sdk' } });
}
