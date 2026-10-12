/**
 * BUA 的 MCP 工具集。
 *
 * 命名与参数形状**对齐 Codex 的浏览器 API**（对齐基准见
 * `research/03-codex-api-reference.md`），这样针对 Codex 写的 agent 逻辑能低成本迁移，
 * 而 DSH 侧看到的工具名形如 `mcp__bua__tab_click`。
 *
 * ## 设计取舍
 *
 * **一、读取优先。** 大多数工具是只读的（快照、正文、截图、列标签）。变更型工具少而明确，
 * 且都要求 `targetDescription` —— 理由见设计文档：**坐标无法让人判断风险，描述可以**。
 *
 * **二、按标签 id 显式寻址。** 不隐式操作「当前标签」。多 agent 并发时隐式寻址会让
 * 两个会话互相抢页面，症状极难排查。所有需要标签的工具都要求 `tabId`。
 *
 * **三、失败信息要能指导下一步。** MCP 工具的错误会回到模型上下文，所以
 * `describeError` 会按 `buaCode` 分派，写清「为什么」与「怎么办」，而不是抛原始异常。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import { BuaConnection, describeError, fail, ok } from './connection.js';

/** 变更型工具共用的意图描述参数。 */
const intentSchema = z
  .string()
  .min(1)
  .describe(
    '人类可读的操作意图，例如「结算按钮（￥299，含运费）」。必填：坐标无法让人判断风险，描述可以。它会进用户在扩展弹窗里看到的操作流水。',
  );

const tabIdSchema = z.number().int().describe('标签 id，由 tabs_list 或 tab_open 返回。');

/** 把截图变成 MCP 的 image 内容块。 */
function imageBlock(png: Buffer): { type: 'image'; data: string; mimeType: string } {
  return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' };
}

/** 把 DOM 快照节点渲染成人/模型都易读的紧凑清单。 */
function renderNodes(nodes: Array<{ id: number; tag: string; name?: string; role?: string }>): string {
  if (nodes.length === 0) return '没有找到可交互元素。';
  return nodes
    .map((n) => {
      const label = (n.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const role = n.role !== undefined ? `${n.tag}[${n.role}]` : n.tag;
      return `[${n.id}] <${role}> ${label !== '' ? JSON.stringify(label) : '(无文本)'}`;
    })
    .join('\n');
}

export interface RegisterOptions {
  /** 桥端口。默认 17432。 */
  port?: number;
  /** 在工具描述里出现的客户端名，仅用于审计。 */
  clientName?: string;
}

/**
 * 把一个 MCP 服务器实例的工具全部注册进去。
 *
 * 用工厂模式（`serveStdio(() => { const s = new McpServer(...); registerTools(s); return s; })`）
 * 是因为 MCP 的 stdio 绑定会在连接建立时从工厂取一个实例并固定给该连接。
 */
export function registerTools(server: McpServer, options: RegisterOptions = {}): BuaConnection {
  const conn = new BuaConnection({
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.clientName !== undefined ? { clientName: options.clientName } : {}),
  });

  /** 所有工具共用的执行包装：连桥 → 跑 → 按 buaCode 转错误。 */
  async function run<T>(fn: (c: BuaConnection) => Promise<T>): Promise<T | ReturnType<typeof fail>> {
    try {
      return await fn(conn);
    } catch (err) {
      return fail(describeError(err, conn.port));
    }
  }

  /* ─────────────────────── 浏览器 ─────────────────────── */

  server.registerTool(
    'browser_info',
    {
      title: '浏览器信息',
      description:
        '报告 BUA 后端的可用性：扩展是否已连接、浏览器版本、以及**实际具备的能力**。' +
        '在调用其他工具前先用它判断后端是否就绪；若 cdp 为 false 说明已降级（企业策略拒绝 CDP），' +
        '此时不要用截图与真实输入事件类工具。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async (c) => {
        const agent = await c.agent();
        const browsers = await agent.browsers.list();
        const b = browsers[0];
        if (b === undefined) {
          return fail(
            [
              '扩展未连接到桥。',
              '',
              `桥地址：ws://127.0.0.1:${c.port}（已连通，但后端为空）`,
              '请让用户在 chrome://extensions 确认 BUA 已启用，并在其引导页勾选同意。',
            ].join('\n'),
          );
        }
        const caps = await agent.browsers.getDefault().then((x) => x.capabilities());
        return ok(
          [
            `后端：${b.name ?? b.id}（${b.type ?? 'extension'}）`,
            `标签数：${b.tabs?.length ?? 0}`,
            '',
            '能力：',
            ...Object.entries(caps)
              .filter(([k]) => k !== 'notes')
              .map(([k, v]) => `  ${v === true ? '✓' : '✗'} ${k}`),
            ...(Array.isArray(caps.notes) && caps.notes.length > 0
              ? ['', '注意事项：', ...caps.notes.map((n) => `  ${n}`)]
              : []),
          ].join('\n'),
        );
      }),
  );

  /* ─────────────────────── 标签 ─────────────────────── */

  server.registerTool(
    'tabs_list',
    {
      title: '列出标签页',
      description:
        '列出用户当前打开的所有标签页（id、标题、URL、是否活动）。' +
        '这是发现可操作目标的起点：先看有哪些页面，再用 tab_info / tab_dom_snapshot 了解某一页。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async (c) => {
        const tabs = await (await c.browser()).tabs.list();
        if (tabs.length === 0) return ok('用户当前没有打开任何标签页。');
        return ok(
          tabs
            .map((t) => {
              const mark = t.active === true ? '★' : ' ';
              const title = (t.title ?? '').slice(0, 60);
              return `${mark} [${t.id}] ${title}\n      ${t.url ?? '(无 URL)'}`;
            })
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'tab_open',
    {
      title: '新建标签页',
      description:
        '新建一个标签页并可选地导航到某个 URL，返回新的 tabId。' +
        '想知道用户已经打开了什么，用 tabs_list；这个工具是开新的。',
      inputSchema: z.object({
        url: z.string().optional().describe('要打开的 URL。省略则开空白页。'),
        visible: z.boolean().optional().describe('是否在前台显示（默认 false，后台打开）。'),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ url, visible }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.new({
          ...(url !== undefined ? { url } : {}),
          ...(visible !== undefined ? { visible } : {}),
        });
        return ok(`已新建标签页，tabId = ${tab.id}${url !== undefined ? `\nURL: ${url}` : ''}`);
      }),
  );

  server.registerTool(
    'tab_info',
    {
      title: '标签页信息',
      description: '读取某个标签页当前的 URL 与标题。用于确认导航是否生效、页面是否已变化。',
      inputSchema: z.object({ tabId: tabIdSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ tabId }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        const [url, title] = await Promise.all([tab.url(), tab.title()]);
        return ok(`URL  : ${url ?? '(未知)'}\n标题 : ${title ?? '(未知)'}`);
      }),
  );

  server.registerTool(
    'tab_navigate',
    {
      title: '导航标签页',
      description: '把某个标签页导航到指定 URL。变更型操作，必须说明意图。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        url: z.string().describe('目标 URL。'),
        targetDescription: intentSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ tabId, url, targetDescription }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        await tab.goto(url, { targetDescription });
        return ok(`已导航到 ${url}`);
      }),
  );

  server.registerTool(
    'tab_close',
    {
      title: '关闭标签页',
      description:
        '关闭指定的标签页。用于清理本次任务自己打开的页面 —— 不要关闭用户原有的标签，' +
        '除非用户明确要求。注意页面未保存的表单会随标签一起丢失。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        targetDescription: intentSchema.optional().describe('可选：说明为什么关闭这个标签。'),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ tabId, targetDescription }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        await tab.close(targetDescription !== undefined ? { targetDescription } : undefined);
        return ok(`已关闭标签页 ${tabId}`);
      }),
  );

  /* ─────────────────────── 观察 ─────────────────────── */

  server.registerTool(
    'tab_dom_snapshot',
    {
      title: '页面元素快照',
      description:
        '返回页面里**可交互元素**的结构化清单：每个元素有编号、标签名、角色与可见文本。' +
        '这是了解一个页面最省 token 的方式，也是决定如何点击的前提。' +
        '注意编号是快照内的序号，页面变化后会失效，重新快照即可。',
      inputSchema: z.object({ tabId: tabIdSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ tabId }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        const nodes = await tab.playwright.domSnapshot();
        return ok(`找到 ${nodes.length} 个可交互元素：\n\n${renderNodes(nodes)}`);
      }),
  );

  server.registerTool(
    'tab_text',
    {
      title: '页面正文',
      description:
        '返回页面可见正文（innerText）。用于阅读内容、确认页面状态。' +
        '比截图省 token 且可检索；需要视觉确认时再用 tab_screenshot。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('截断长度，默认 8000。页面很长时先截断再按需深入。'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ tabId, maxChars }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        const text = await tab.text();
        const limit = maxChars ?? 8000;
        if (text.length <= limit) return ok(text === '' ? '(页面正文为空)' : text);
        return ok(`${text.slice(0, limit)}\n\n…（已截断，完整长度 ${text.length} 字符）`);
      }),
  );

  server.registerTool(
    'tab_screenshot',
    {
      title: '页面截图',
      description:
        '截取页面截图并以图像返回。用于视觉确认（布局、图片、渲染结果）。' +
        '纯文本信息优先用 tab_text / tab_dom_snapshot，它们更省 token。',
      inputSchema: z.object({ tabId: tabIdSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ tabId }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        const png = await tab.screenshot();
        return { content: [imageBlock(png)] };
      }),
  );

  server.registerTool(
    'tab_evaluate',
    {
      title: '在页面执行 JS',
      description:
        '在页面上下文里执行一段 JavaScript 表达式并返回其值。' +
        '适合读取快照覆盖不到的结构化数据（例如某个元素的属性、页面的 JSON 数据）。' +
        '传入的应是**表达式或立即执行的函数**，其值会被序列化返回。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        expression: z
          .string()
          .describe('JavaScript 表达式，例如 document.querySelector("h1").textContent'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ tabId, expression }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        const value = await tab.playwright.evaluate(expression);
        return ok(`结果：\n${JSON.stringify(value, null, 2)}`);
      }),
  );

  /* ─────────────────────── 交互（语义定位） ─────────────────────── */

  server.registerTool(
    'tab_click',
    {
      title: '点击元素',
      description:
        '按 CSS 选择器点击页面元素。这是**首选的点击方式** —— 语义定位比坐标稳，' +
        '页面滚动或布局变化都不会点错。只有找不到合适选择器时才用 tab_click_at。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        selector: z.string().describe('CSS 选择器，例如 #submit 或 button[type=submit]。'),
        targetDescription: intentSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ tabId, selector, targetDescription }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        await tab.click(selector, { targetDescription });
        return ok(`已点击 ${selector}`);
      }),
  );

  server.registerTool(
    'tab_fill',
    {
      title: '填写输入框',
      description:
        '按 CSS 选择器把文本填入输入框，并触发 input/change 事件。' +
        '会先清空原有内容；要追加输入用 tab_type。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        selector: z.string().describe('目标输入框的 CSS 选择器。'),
        value: z.string().describe('要填入的文本。'),
        targetDescription: intentSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ tabId, selector, value, targetDescription }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        await tab.fill(selector, value, { targetDescription });
        return ok(`已填写 ${selector}`);
      }),
  );

  server.registerTool(
    'tab_type',
    {
      title: '输入文本（真实键盘）',
      description:
        '用**真实键盘事件**向当前焦点输入文本。与 tab_fill 的区别：这个走浏览器输入管线，' +
        '页面能收到真实的 keydown/keypress/keyup，适合那些拒绝脚本赋值的输入框。' +
        '使用前通常需要先用 tab_click 把焦点放到目标元素上。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        text: z.string().describe('要输入的文本。'),
        targetDescription: intentSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ tabId, text, targetDescription }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        await tab.cua.type(text, { targetDescription });
        return ok(`已输入 ${text.length} 个字符`);
      }),
  );

  /* ─────────────────────── 交互（坐标兜底） ─────────────────────── */

  server.registerTool(
    'tab_click_at',
    {
      title: '按坐标点击',
      description:
        '在视口坐标处派发**真实鼠标事件**。这是找不到合适选择器时的兜底方案。' +
        '坐标可以从 tab_dom_snapshot 返回的 rect 计算中心点。' +
        '⚠️ 坐标点击对页面滚动与布局变化敏感，能用 tab_click 就不要用这个。',
      inputSchema: z.object({
        tabId: tabIdSchema,
        x: z.number().int().describe('视口 x 坐标（像素）。'),
        y: z.number().int().describe('视口 y 坐标（像素）。'),
        targetDescription: intentSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ tabId, x, y, targetDescription }) =>
      run(async (c) => {
        const tab = await (await c.browser()).tabs.get(tabId);
        await tab.cua.click(x, y, { targetDescription });
        return ok(`已在 (${x}, ${y}) 点击`);
      }),
  );

  return conn;
}
