import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  external: ['ws', '@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'],
});
