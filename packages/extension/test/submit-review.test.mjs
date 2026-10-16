import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { submitReview } from '../scripts/submit-review.mjs';

const archive = Buffer.from('test zip payload');
const env = { CWS_PUBLISHER_ID: 'publisher', CWS_EXTENSION_ID: 'a'.repeat(32),
  CWS_CLIENT_ID: 'client', CWS_CLIENT_SECRET: 'secret', CWS_REFRESH_TOKEN: 'refresh' };
const config = { env, archive, checksum: createHash('sha256').update(archive).digest('hex'), version: '0.1.1' };
const response = value => ({ ok: true, json: async () => value });

test('missing credentials and altered packages never contact the store', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; throw Error('unexpected request'); };
  await assert.rejects(submitReview({ ...config, env: {}, fetchImpl }), /CWS_CLIENT_ID/);
  await assert.rejects(submitReview({ ...config, checksum: 'wrong', fetchImpl }), /checksum/);
  assert.equal(requests, 0);
});

test('wait for asynchronous upload then submit for staged review', async () => {
  const requests = [];
  const results = [{ access_token: 'token' }, { uploadState: 'IN_PROGRESS' },
    { lastAsyncUploadState: 'SUCCEEDED' }, { state: 'PENDING_REVIEW' }];
  const result = await submitReview({ ...config, sleep: async () => {}, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return response(results.shift());
  } });
  assert.equal(result.state, 'PENDING_REVIEW');
  assert.match(requests[2].url, /:fetchStatus$/);
  assert.deepEqual(JSON.parse(requests[3].options.body),
    { publishType: 'STAGED_PUBLISH', skipReview: false, blockOnWarnings: true });
  assert.equal(requests[1].options.body, archive);
});

test('failed uploads or mismatched versions cannot submit review', async () => {
  for (const upload of [{ uploadState: 'FAILED' }, { uploadState: 'SUCCEEDED', crxVersion: '9.0' }]) {
    let requests = 0;
    await assert.rejects(submitReview({ ...config, fetchImpl: async () =>
      response(++requests === 1 ? { access_token: 'token' } : upload) }));
    assert.equal(requests, 2);
  }
});

test('polling times out and HTTP failures never submit or leak response bodies', async () => {
  let requests = 0;
  await assert.rejects(submitReview({ ...config, sleep: async () => {}, fetchImpl: async () => {
    requests++;
    return response(requests === 1 ? { access_token: 'token' } : requests === 2
      ? { uploadState: 'IN_PROGRESS' } : { lastAsyncUploadState: 'IN_PROGRESS' });
  } }), /did not succeed/);
  assert.equal(requests, 32);
  await assert.rejects(submitReview({ ...config, fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
});
