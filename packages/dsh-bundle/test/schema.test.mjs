import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createTools } from '../src/tools.js';

// Exercise the shipped DSH schema compiler without booting a complete host.
// Only unrelated host error/JSON utility dependencies are adapted here.
const require = createRequire(import.meta.url);
const schema = join(dirname(require.resolve('@deepseek-ai/dsh-tools')), 'types/schema.js');
const built = await build({ entryPoints: [schema], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'host-utility-adapters', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-(llm|session)$/ }, ({ path }) => ({ path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: path.endsWith('llm')
      ? 'export class HarnessError extends Error { constructor(message, code) { super(message); this.code = code; } } export function assertNever(x) { throw new Error(String(x)); }'
      : 'export function isJsonValue(x) { if (x === null) return true; if (typeof x === "number") return Number.isFinite(x); if (typeof x === "string" || typeof x === "boolean") return true; if (Array.isArray(x)) return x.every(isJsonValue); if (typeof x === "object") return Object.values(x).every(isJsonValue); return false; }' }));
  } }],
});
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports }, { filename: 'dsh-tool-schema.cjs' });
const { defineTool } = module.exports;

test('official DSH defineTool accepts all definitions and validates target arguments', async () => {
  let dispatched = 0;
  const runtime = { async run() { dispatched++; return { ok: true }; } };
  const tools = createTools(runtime, defineTool);
  assert.equal(tools.length, 14);
  const click = tools.find((t) => t.name === 'bua_tab_click');
  assert.ok(click.parameters.required.includes('tabId'));
  assert.ok(click.parameters.required.includes('targetDescription'));
  await assert.rejects(click.execute({ selector: '#submit', targetDescription: '提交' }), /tabId/);
  await assert.rejects(click.execute({ tabId: '22', selector: '#submit', targetDescription: '提交' }), /tabId/);
  assert.equal(dispatched, 0);
  assert.deepEqual(await click.execute({ tabId: 22, selector: '#submit', targetDescription: '提交' }), { ok: true });
  assert.equal(dispatched, 1);
});
