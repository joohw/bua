/**
 * 方法名常量。
 *
 * **这是全项目唯一的方法名真源。** 扩展、桥、SDK 三侧都必须从这里引用，
 * 不允许任何地方硬编码方法名字符串 —— 那是三处漂移的根源。
 */

/* ────────────────────────── 桥管理 ────────────────────────── */

export const M = {
  // 握手与连接
  hello: 'bua.hello',
  heartbeat: 'bua.heartbeat',
  goodbye: 'bua.goodbye',

  // 大对象
  blobGet: 'blob.get',

  // 浏览器
  browserList: 'browser.list',
  browserGet: 'browser.get',
  browserGetDefault: 'browser.getDefault',
  browserGetForUrl: 'browser.getForUrl',
  browserNameSession: 'browser.nameSession',
  browserHistory: 'browser.history',
  browserCapsList: 'browser.capabilities.list',
  browserCapsGet: 'browser.capabilities.get',

  // 用户标签（BUA 核心差异点）
  userOpenTabs: 'user.openTabs',
  userGetTabContext: 'user.getTabContext',
  userClaimTab: 'user.claimTab',

  // 标签集合
  tabsList: 'tabs.list',
  tabsGet: 'tabs.get',
  tabsNew: 'tabs.new',
  tabsSelected: 'tabs.selected',
  tabsContent: 'tabs.content',
  tabsClose: 'tabs.close',

  // 标签操作
  tabGoto: 'tab.goto',
  tabBack: 'tab.back',
  tabForward: 'tab.forward',
  tabReload: 'tab.reload',
  tabClose: 'tab.close',
  tabUrl: 'tab.url',
  tabTitle: 'tab.title',
  tabScreenshot: 'tab.screenshot',
  tabGetJsDialog: 'tab.getJsDialog',
  tabMarkDeliverable: 'tab.markDeliverable',
  tabMarkHandoff: 'tab.markHandoff',
  tabRequestManualHandoff: 'tab.requestManualHandoff',
  tabCapsList: 'tab.capabilities.list',
  tabCapsGet: 'tab.capabilities.get',

  // Playwright 层
  pwDomSnapshot: 'playwright.domSnapshot',
  pwEvaluate: 'playwright.evaluate',
  pwElementInfo: 'playwright.elementInfo',
  pwElementScreenshot: 'playwright.elementScreenshot',
  pwFrameLocator: 'playwright.frameLocator',
  pwWaitForLoadState: 'playwright.waitForLoadState',
  pwWaitForURL: 'playwright.waitForURL',
  pwWaitForTimeout: 'playwright.waitForTimeout',
  pwWaitForEvent: 'playwright.waitForEvent',
  pwExpectNavigation: 'playwright.expectNavigation',

  // Playwright 定位器构造
  locator: 'playwright.locator',
  getByRole: 'playwright.getByRole',
  getByText: 'playwright.getByText',
  getByLabel: 'playwright.getByLabel',
  getByPlaceholder: 'playwright.getByPlaceholder',
  getByTestId: 'playwright.getByTestId',

  // Playwright 定位器操作
  locatorClick: 'locator.click',
  locatorDblclick: 'locator.dblclick',
  locatorFill: 'locator.fill',
  locatorType: 'locator.type',
  locatorPress: 'locator.press',
  locatorPressSequentially: 'locator.pressSequentially',
  locatorCheck: 'locator.check',
  locatorUncheck: 'locator.uncheck',
  locatorSetChecked: 'locator.setChecked',
  locatorSelectOption: 'locator.selectOption',
  locatorInnerText: 'locator.innerText',
  locatorTextContent: 'locator.textContent',
  locatorAllTextContents: 'locator.allTextContents',
  locatorGetAttribute: 'locator.getAttribute',
  locatorIsVisible: 'locator.isVisible',
  locatorIsEnabled: 'locator.isEnabled',
  locatorCount: 'locator.count',
  locatorWaitFor: 'locator.waitFor',
  locatorEvaluate: 'locator.evaluate',
  locatorEvaluateAll: 'locator.evaluateAll',
  locatorDownloadMedia: 'locator.downloadMedia',
  // 定位器组合（句柄模型下这些都是句柄 → 句柄）
  locatorFilter: 'locator.filter',
  locatorLocator: 'locator.locator',
  locatorFirst: 'locator.first',
  locatorLast: 'locator.last',
  locatorNth: 'locator.nth',
  locatorAnd: 'locator.and',
  locatorOr: 'locator.or',
  locatorAll: 'locator.all',
  /** 显式释放句柄。句柄另有 TTL 自动回收。 */
  locatorRelease: 'locator.release',

  // AX 层
  axGet: 'ax.get',
  axWrite: 'ax.write',
  axClick: 'ax.click',
  axTypeText: 'ax.typeText',
  axPressKey: 'ax.pressKey',
  axSetValue: 'ax.setValue',
  axPaste: 'ax.paste',
  axSelectText: 'ax.selectText',
  axScroll: 'ax.scroll',
  axDrag: 'ax.drag',
  axPerformSecondaryAction: 'ax.performSecondaryAction',

  // CUA 层（视口坐标）
  cuaClick: 'cua.click',
  cuaDoubleClick: 'cua.double_click',
  cuaMove: 'cua.move',
  cuaDrag: 'cua.drag',
  cuaScroll: 'cua.scroll',
  cuaType: 'cua.type',
  cuaKeypress: 'cua.keypress',
  cuaDownloadMedia: 'cua.downloadMedia',

  // DomCUA 层（可见 DOM 节点 id）
  domCuaGetVisibleDom: 'dom_cua.get_visible_dom',
  domCuaClick: 'dom_cua.click',
  domCuaDoubleClick: 'dom_cua.double_click',
  domCuaScroll: 'dom_cua.scroll',
  domCuaType: 'dom_cua.type',
  domCuaKeypress: 'dom_cua.keypress',
  domCuaDownloadMedia: 'dom_cua.downloadMedia',

  // 内容导出
  contentExport: 'content.export',
  contentExportGsuite: 'content.exportGsuite',
  contentExportYouTubeTranscript: 'content.exportYouTubeTranscript',

  // 能力
  capsList: 'capabilities.list',
  capsGet: 'capabilities.get',

  // 审计（BUA 增补）
  auditTrail: 'audit.trail',
  auditUndo: 'audit.undo',
} as const;

export type MethodName = (typeof M)[keyof typeof M];

/** 全部方法名的运行时列表，用于协议一致性测试。 */
export const ALL_METHODS: readonly MethodName[] = Object.values(M);

/**
 * **变更型**方法。桥为这些方法生成审计条目，并可能触发用户确认。
 * 误判为只读会让审计缺失；误判为变更会让用户被无谓打扰。
 */
export const MUTATING_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  M.tabsNew,
  M.tabsClose,
  M.userClaimTab,
  M.tabGoto,
  M.tabBack,
  M.tabForward,
  M.tabReload,
  M.tabClose,
  M.tabMarkDeliverable,
  M.tabMarkHandoff,
  M.tabRequestManualHandoff,
  M.locatorClick,
  M.locatorDblclick,
  M.locatorFill,
  M.locatorType,
  M.locatorPress,
  M.locatorPressSequentially,
  M.locatorCheck,
  M.locatorUncheck,
  M.locatorSetChecked,
  M.locatorSelectOption,
  M.axClick,
  M.axTypeText,
  M.axPressKey,
  M.axSetValue,
  M.axPaste,
  M.axSelectText,
  M.axScroll,
  M.axDrag,
  M.axPerformSecondaryAction,
  M.cuaClick,
  M.cuaDoubleClick,
  M.cuaMove,
  M.cuaDrag,
  M.cuaScroll,
  M.cuaType,
  M.cuaKeypress,
  M.domCuaClick,
  M.domCuaDoubleClick,
  M.domCuaScroll,
  M.domCuaType,
  M.domCuaKeypress,
  M.auditUndo,
]);

/**
 * 各方法所需的最低授权层级。
 * 未列出的方法默认 `none`（可枚举、可握手，但读不到内容）。
 */
export const METHOD_REQUIRED_GRANT: Readonly<Partial<Record<MethodName, 'read' | 'interact' | 'restricted-interact'>>> =
  Object.freeze({
    // 读内容
    [M.blobGet]: 'read',
    [M.userGetTabContext]: 'read',
    [M.tabsContent]: 'read',
    [M.tabUrl]: 'read',
    [M.tabTitle]: 'read',
    [M.tabScreenshot]: 'read',
    [M.tabGetJsDialog]: 'read',
    [M.pwDomSnapshot]: 'read',
    [M.pwEvaluate]: 'read',
    [M.pwElementInfo]: 'read',
    [M.pwElementScreenshot]: 'read',
    [M.locatorInnerText]: 'read',
    [M.locatorTextContent]: 'read',
    [M.locatorAllTextContents]: 'read',
    [M.locatorGetAttribute]: 'read',
    [M.locatorIsVisible]: 'read',
    [M.locatorIsEnabled]: 'read',
    [M.locatorCount]: 'read',
    [M.locatorEvaluate]: 'read',
    [M.locatorEvaluateAll]: 'read',
    [M.axGet]: 'read',
    [M.domCuaGetVisibleDom]: 'read',
    [M.contentExport]: 'read',
    [M.contentExportGsuite]: 'read',
    [M.contentExportYouTubeTranscript]: 'read',
    [M.browserHistory]: 'read',
    // 交互
    [M.userClaimTab]: 'interact',
    [M.tabsNew]: 'interact',
    [M.tabGoto]: 'interact',
    [M.tabBack]: 'interact',
    [M.tabForward]: 'interact',
    [M.tabReload]: 'interact',
    [M.axWrite]: 'interact',
  });
