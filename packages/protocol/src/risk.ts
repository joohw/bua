/**
 * 动作风险分级。
 *
 * ⚠️ **这不是安全闸门。** BUA 的信任模型是「本机即信任」—— 不限制 agent，
 * 不发凭据（见 `docs/design.md` §4.0）。本模块只做**信息性**标注，用途有三：
 *
 * 1. **审计可读性** —— 日志按风险分组，用户回看时能快速定位有后果的操作
 * 2. **agent 自我约束** —— agent 可据此在破坏性动作前主动向用户确认
 * 3. **UI 呈现** —— 未来若做操作回放/时间线，可按风险分级着色
 *
 * 它**不拦截**任何调用。任何依赖它来「保证安全」的想法都是误解。
 *
 * 分级由扩展侧按方法名判定，**不信任 agent 传的任何 hint**
 * （MCP 规范明确警告 tool annotations 不可信）。
 */

/**
 * - `read`        无副作用：截图 / 快照 / 列标签 / 读 URL 标题
 * - `write`       改变页面状态：点击 / 输入 / 滚动 / 选择 / 导航
 * - `destructive` **不可逆或影响外部系统**：提交表单 / 支付 / 删除 / 发送消息 /
 *                 上传下载 / 写剪贴板 / 关标签
 */
export type ActionRisk = 'read' | 'write' | 'destructive';

/** 风险强度数值，便于比较与排序。 */
export const ACTION_RISK_STRENGTH: Readonly<Record<ActionRisk, number>> = Object.freeze({
  read: 0,
  write: 1,
  destructive: 2,
});

/**
 * 不可逆或影响外部系统的动作。
 *
 * 这个集合的判定标准是「**用户能不能撤销**」：能在页面上点回去的算 `write`，
 * 一旦发生就无法挽回、或已经影响到浏览器之外（发出消息、付了钱、文件落了盘）的算 `destructive`。
 *
 * 注意：这里按**方法名**判定是粗粒度的。同一个 `locator.click` 点「下一页」和点
 * 「确认支付」风险天差地别。真正精准的判定需要页面语义信息，那属于扩展侧运行时职责。
 * 因此本集合只覆盖**语义上明确**的破坏性方法；剩余判断交给 agent 的
 * `targetDescription` 与自我约束。
 */
export const DESTRUCTIVE_METHODS: ReadonlySet<string> = new Set<string>([
  // 文件落盘 / 上传下载
  'locator.downloadMedia',
  'cua.downloadMedia',
  'dom_cua.downloadMedia',
  'content.export',
  'content.exportGsuite',
  'content.exportYouTubeTranscript',
  // 剪贴板写入
  'ax.paste',
  // 关闭标签 —— 可能丢失未保存的表单
  'tab.close',
  'tabs.close',
]);

/**
 * 只读方法：无副作用，可安全重试。
 * 未在 `WRITE_METHODS` 与 `DESTRUCTIVE_METHODS` 中的方法默认按此处理。
 */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set<string>([
  'blob.get',
  'browser.list',
  'browser.get',
  'browser.getDefault',
  'browser.getForUrl',
  'browser.history',
  'browser.capabilities.list',
  'browser.capabilities.get',
  'user.openTabs',
  'user.getTabContext',
  'tabs.list',
  'tabs.get',
  'tabs.selected',
  'tabs.content',
  'tab.url',
  'tab.title',
  'tab.screenshot',
  'tab.getJsDialog',
  'tab.capabilities.list',
  'tab.capabilities.get',
  'playwright.domSnapshot',
  'playwright.elementInfo',
  'playwright.elementScreenshot',
  'locator.innerText',
  'locator.textContent',
  'locator.allTextContents',
  'locator.getAttribute',
  'locator.isVisible',
  'locator.isEnabled',
  'locator.count',
  'locator.evaluateAll',
  'ax.get',
  'dom_cua.get_visible_dom',
  'capabilities.list',
  'capabilities.get',
  'audit.trail',
]);

/**
 * 判定一个方法的风险级别。
 *
 * 未知方法**保守地按 `write` 处理** —— 宁可多标注一点，也不要让一个新的
 * 变更型方法悄悄落进 `read` 而被审计忽略。
 */
export function classifyRisk(method: string): ActionRisk {
  if (DESTRUCTIVE_METHODS.has(method)) return 'destructive';
  if (READ_ONLY_METHODS.has(method)) return 'read';
  return 'write';
}

/** 需要携带 `targetDescription` 的级别。 */
export function requiresTargetDescription(risk: ActionRisk): boolean {
  return risk !== 'read';
}
