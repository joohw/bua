import { defineTool } from '@deepseek-ai/dsh-tools';
import { BrowserRuntime } from './runtime.js';
import { createTools } from './tools.js';

export const name = 'bua';
export const inject = ['tools'];

export function apply(ctx) {
  const runtime = new BrowserRuntime();
  ctx.effect(() => {
    void runtime.ensureBridge().catch((error) => console.error('[bua]', error.message));
    return () => runtime.close();
  });
  const saveScreenshot = async (data, exec) => {
    const attachments = ctx.get('attachments');
    if (!attachments) throw new Error('DSH 未启用图片附件存储，请改用 bua_tab_text。');
    const routed = exec.agent?.session.requestHeader()?.config;
    const provider = routed?.provider ?? exec.agent?.options.provider;
    const model = routed?.model ?? exec.agent?.options.model;
    const llm = ctx.get('llm');
    if (!llm || provider === undefined || model === undefined) throw new Error('无法确认当前模型是否支持图片输入，请改用 bua_tab_text。');
    const info = await llm.resolveModelInfo(provider, model, exec.signal);
    if (!info.inputModalities?.includes('image')) throw new Error('当前模型不支持图片输入，请改用 bua_tab_text。');
    exec.signal.throwIfAborted();
    return attachments.saveImage({ data, mediaType: 'image/png', name: 'bua-screenshot.png' });
  };
  for (const tool of createTools(runtime, defineTool, saveScreenshot)) ctx.tools.register(tool);
}
