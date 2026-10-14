import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
test('native publishable bundle contains portable entry and metadata', async () => {
  assert.equal(pkg.name, 'dsh-plugin-bua');
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.exports['.'], './dist/index.js');
  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('icon.svg'));
  assert.ok(pkg.files.includes('locale/*.json'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /name: dsh-plugin-bua/);
  assert.doesNotMatch(patch, /mcp|D:\\|npx/);
  for (const lang of ['en', 'zh']) {
    const locale = JSON.parse(await readFile(new URL(`../locale/${lang}.json`, import.meta.url)));
    assert.ok(locale.meta.title && locale.meta.description);
  }
});
