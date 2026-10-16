import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const required = ['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];

// Only use the official store endpoints. Never log token responses or request headers.
export async function submitReview({ env = process.env, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  version, archive, checksum } = {}) {
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Configure GitHub Actions variables/secrets: ${missing.join(', ')}`);
  if (!/^[a-z]{32}$/.test(env.CWS_EXTENSION_ID) || !/^[\w-]+$/.test(env.CWS_PUBLISHER_ID)) throw new Error('Invalid Chrome Web Store item or publisher ID');
  const actualHash = createHash('sha256').update(archive).digest('hex');
  if (checksum.trim().split(/\s+/)[0] !== actualHash) throw new Error('ZIP checksum mismatch');
  async function json(url, options) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Chrome Web Store request failed (HTTP ${response.status}); inspect developer dashboard before retrying`);
    return response.json();
  }
  const token = await json('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET, refresh_token: env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!token.access_token) throw new Error('OAuth response has no access token');
  if (env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${token.access_token}`);
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const item = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
  const base = `https://chromewebstore.googleapis.com/v2/${item}`;
  const upload = await json(`https://chromewebstore.googleapis.com/upload/v2/${item}:upload?uploadType=media`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: archive,
  });
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error('Uploaded version does not match build');
  let uploadState = upload.uploadState;
  for (let attempt = 0; uploadState === 'IN_PROGRESS' && attempt < 30; attempt++) {
    await sleep(10_000);
    const status = await json(`${base}:fetchStatus`, { headers });
    uploadState = status.lastAsyncUploadState;
  }
  if (uploadState !== 'SUCCEEDED') throw new Error(`Package upload did not succeed: ${uploadState ?? 'unknown'}`);
  const result = await json(`${base}:publish`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'STAGED_PUBLISH', skipReview: false, blockOnWarnings: true }),
  });
  if (!['PENDING_REVIEW', 'STAGED'].includes(result.state)) throw new Error(`Unexpected review state: ${result.state ?? 'unknown'}`);
  return { version, state: result.state, sha256: actualHash, itemId: env.CWS_EXTENSION_ID };
}

async function main() {
  // Validate credentials before making any network requests.
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Configure GitHub Actions variables/secrets: ${missing.join(', ')}`);
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const filename = `bua-extension-v${manifest.version}.zip`;
  const result = await submitReview({ version: manifest.version,
    archive: await readFile(new URL(`release/${filename}`, root)),
    checksum: await readFile(new URL(`release/${filename}.sha256`, root), 'utf8') });
  console.log(`Chrome Web Store ${result.version}: ${result.state} (${result.sha256})`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Chrome Web Store review\n\nVersion: ${result.version}\n\nState: ${result.state}\n\nSHA-256: ${result.sha256}\n\nApproval stages the release; publish it from the developer dashboard.\n`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
