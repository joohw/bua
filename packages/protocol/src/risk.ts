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
 * ⚠️ **这个集合刻意很小，而且是空的。** 原因是实测得出的结论：
 * **单靠方法名无法可靠判定「破坏性」。**
 *
 * 同一个 `locator.click` 点「下一页」和点「确认支付」风险天差地别；
 * `cua.downloadMedia` 只是触发下载，并没有毁掉任何东西。把这类方法一股脑
 * 标成 destructive 只会制造噪声，让审计里真正危险的条目被淹没。
 *
 * 真正准确的判定需要**页面语义**（这个按钮是不是 submit、表单里有没有金额），
 * 那属于扩展侧运行时职责，不是方法名能表达的。
 *
 * 因此当前策略是：
 * - 方法名只区分 `read` / `write`（可靠）
 * - 破坏性意图通过 {@link looksDestructive} 从 `targetDescription` 里做**启发式**识别
 * - 保留这个空集合作为显式扩展点：将来若某个方法在语义上确定有害，加进来即可
 */
export const DESTRUCTIVE_METHODS: ReadonlySet<string> = new Set<string>([
  // 目前为空 —— 见上方说明。曾经的候选及放弃理由：
  //   content.export*      → 导出用户自己看得见的内容，不是破坏
  //   cua.downloadMedia    → 触发下载，没有数据损失
  //   ax.paste             → 向页面输入文本，属 write
  //   tab.close / tabs.close → 用户可见但可撤销（标签可恢复）
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

  /*
   * `playwright.evaluate` 归为 read。
   *
   * 理由是它在本设计里**就是首选的读取机制**（对齐 Codex 的
   * `evaluate` 语义：「Evaluate JavaScript in a read-only page scope」）。
   * 它当然可以改页面，但把它标成 write 会迫使 agent 每次读值都编一句
   * targetDescription，结果是描述变成噪声、审计失去意义。
   *
   * 若部署方要更严的约束，可关闭 `capabilities.evaluate`（协议里已有该开关）。
   */
  'playwright.evaluate',
  'locator.evaluate',

  /*
   * 标签级导航归为 read。
   *
   * `tabs.new` 只是开一个标签，没有副作用落到既有页面上；`back` / `forward` /
   * `reload` 是纯导航，意图由用户或 agent 的表达已经说清。
   * 注意 `tab.goto` **不在此列** —— 它要跨到别处去，值得让 agent 说明意图。
   */
  'tabs.new',
  'tab.back',
  'tab.forward',
  'tab.reload',
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

/* ─────────────────── 破坏性意图的启发式识别 ─────────────────── */

/**
 * 从人类可读描述里识别**可能造成不可逆后果**的意图。
 *
 * 为什么是启发式：见 {@link DESTRUCTIVE_METHODS} 的说明 —— 方法名无法表达
 * 「确认支付」与「下一页」的区别，但 **agent 自己写的 targetDescription 可以**。
 * 这是把不可靠信息变成可用信号的唯一低摩擦途径。
 *
 * 用途（**都是信息性的，不拦截**）：
 * - 审计里把这些条目单独标出来，用户回看时能直接定位有后果的操作
 * - 弹窗里以「危险」标签呈现
 * - 将来若做操作回放时间线，可用于着色
 *
 * ### 已知局限
 *
 * 1. **会被绕过**：agent 写「点一下那个按钮」就识别不出来。这不是安全边界。
 * 2. **语言偏中文/英文**：其他语言覆盖不全，需要时补词表。
 * 3. **可能误报**：说「不要删除」也会命中。宁可误报——误报只影响标注。
 */
const DESTRUCTIVE_INTENT_PATTERNS: readonly RegExp[] = [
  // 中文
  /支付|付款|结算|下单|购买|买入|充值|转账|汇款/,
  /提交|确认提交|发送|发布|上传|投递/,
  /删除|清空|移除|注销|解绑|退订|取消订单/,
  /确认|同意并|授权|签约|开通/,
  // 英文
  /\b(pay|payment|checkout|purchase|buy|subscribe|donate|transfer)\b/i,
  // 「下单」在英文里是 place/confirm/submit + order，不写成 payment
  /\b(place|confirm|submit|create|complete)\s+(an?\s+)?(order|booking|reservation)\b/i,
  /\b(submit|send|post|publish|upload|delete|remove|confirm|cancel)\b/i,
  // 金额与订单号是很强的信号
  /[¥$€£]\s?\d/,
  /\b\d+\s?(usd|usdt|cny|rmb|eur)\b/i,
];

export interface DestructiveSignal {
  /** 是否疑似破坏性。 */
  destructive: boolean;
  /** 命中的模式（便于调试与审计解释）。 */
  matches: string[];
}

/**
 * 判断一个 `targetDescription` 是否疑似破坏性意图。
 *
 * @param targetDescription - agent 提供的人类可读目标描述
 */
export function looksDestructive(targetDescription: string | undefined): DestructiveSignal {
  if (targetDescription === undefined || targetDescription.trim().length === 0) {
    return { destructive: false, matches: [] };
  }
  const matches: string[] = [];
  for (const re of DESTRUCTIVE_INTENT_PATTERNS) {
    const m = re.exec(targetDescription);
    if (m !== null) matches.push(m[0]);
  }
  return { destructive: matches.length > 0, matches };
}

