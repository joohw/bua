import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const required = ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'];
const origin = 'https://api.addons.microsoftedge.microsoft.com';
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function submitEdgeReview({ env = process.env, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), version, archive, checksum } = {}) {
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Configure GitHub Actions variables/secrets: ${missing.join(', ')}`);
  if (!guid.test(env.EDGE_PRODUCT_ID) || !guid.test(env.EDGE_CLIENT_ID)) throw new Error('Invalid Edge product or client ID');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  if (checksum.trim().split(/\s+/)[0] !== sha256) throw new Error('ZIP checksum mismatch');
  const base = `${origin}/v1/products/${env.EDGE_PRODUCT_ID}/submissions`;
  const headers = { Authorization: `ApiKey ${env.EDGE_API_KEY}`, 'X-ClientID': env.EDGE_CLIENT_ID };
  async function request(url, options = {}) {
    const response = await fetchImpl(url, { ...options, headers: { ...headers, ...options.headers },
      redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Edge API request failed (HTTP ${response.status}); inspect Partner Center before retrying`);
    return response;
  }
  async function start(url, options) {
    const response = await request(url, { ...options, method: 'POST' });
    if (response.status !== 202) throw new Error('Edge API did not accept the operation');
    const location = response.headers.get('location');
    if (!location) throw new Error('Edge API returned no operation ID');
    // Location can be an operation ID or URL. Never send API keys to another host/path.
    const expected = `${url}/operations/`;
    const operation = /^[a-z0-9_-]+$/i.test(location) ? new URL(expected + location) : new URL(location, origin);
    if (!operation.href.startsWith(expected) || operation.search || operation.hash ||
        !/^[a-z0-9_-]+$/i.test(operation.href.slice(expected.length))) throw new Error('Unexpected Edge operation URL');
    return operation.href;
  }
  async function poll(url) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await (await request(url)).json();
      if (result.status === 'Succeeded') return;
      if (result.status !== 'InProgress') throw new Error(`Edge operation failed (${result.errorCode || result.status || 'unknown'}); inspect Partner Center`);
      await sleep(5_000);
    }
    throw new Error('Edge operation timed out; inspect Partner Center before retrying');
  }
  const upload = await start(`${base}/draft/package`, {
    headers: { 'Content-Type': 'application/zip' }, body: archive,
  });
  await poll(upload);
  const submission = await start(base, { headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: `BUA ${version}. Automated validated release submission. SHA-256: ${sha256}` }) });
  await poll(submission);
  return { version, sha256, productId: env.EDGE_PRODUCT_ID, state: 'SUBMITTED' };
}

async function main() {
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Configure GitHub Actions variables/secrets: ${missing.join(', ')}`);
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const file = `release/bua-extension-v${manifest.version}.zip`;
  const result = await submitEdgeReview({ version: manifest.version,
    archive: await readFile(new URL(file, root)), checksum: await readFile(new URL(`${file}.sha256`, root), 'utf8') });
  console.log(`Microsoft Edge ${result.version}: ${result.state} (${result.sha256})`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Microsoft Edge submission\n\nVersion: ${result.version}\n\nState: ${result.state}\n\nSHA-256: ${result.sha256}\n\nSubmission accepted; this does not mean certification passed. Check Partner Center for review and publication status.\n`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
