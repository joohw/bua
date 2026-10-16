import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { submitEdgeReview } from '../scripts/submit-edge-review.mjs';

const env = { EDGE_PRODUCT_ID: '11111111-1111-1111-1111-111111111111',
  EDGE_CLIENT_ID: '22222222-2222-2222-2222-222222222222', EDGE_API_KEY: 'secret' };
const archive = Buffer.from('test zip');
const config = { env, archive, version: '0.1.1', checksum: createHash('sha256').update(archive).digest('hex'), sleep: async () => {} };
const accepted = location => ({ ok: true, status: 202, headers: new Headers({ location }) });
const status = (value, errorCode) => ({ ok: true, json: async () => ({ status: value, errorCode }) });

test('Edge uploads and waits before submitting, using v1.1 API key headers', async () => {
  const calls = [];
  const results = [accepted('upload-id'), status('InProgress'), status('Succeeded'), accepted('submit-id'), status('Succeeded')];
  const result = await submitEdgeReview({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return results.shift();
  } });
  assert.equal(result.state, 'SUBMITTED');
  assert.equal(calls[0].options.body, archive);
  assert.equal(calls[0].options.headers.Authorization, 'ApiKey secret');
  assert.equal(calls[0].options.headers['X-ClientID'], env.EDGE_CLIENT_ID);
  assert.match(calls[3].url, /\/submissions$/);
  assert.match(JSON.parse(calls[3].options.body).notes, /0\.1\.1/);
});

test('missing credentials and checksum mismatch do not contact Edge', async () => {
  let count = 0;
  const fetchImpl = async () => { count++; throw Error('Unexpected request'); };
  await assert.rejects(submitEdgeReview({ ...config, env: {}, fetchImpl }), /EDGE_API_KEY/);
  await assert.rejects(submitEdgeReview({ ...config, checksum: 'wrong', fetchImpl }), /checksum/);
  assert.equal(count, 0);
});

test('failed uploads, bad status, and API redirects never trigger submission', async () => {
  for (const result of [status('Failed'), status('Unknown')]) {
    let count = 0;
    await assert.rejects(submitEdgeReview({ ...config, fetchImpl: async () => ++count === 1 ? accepted('upload') : result }));
    assert.equal(count, 2);
  }
  for (const location of ['https://attacker.test/steal', '/unexpected/operation', '../escape']) {
    let count = 0;
    await assert.rejects(submitEdgeReview({ ...config, fetchImpl: async () => { count++; return accepted(location); } }), /operation URL/);
    assert.equal(count, 1);
  }
});

test('Edge reports in-review conflicts and bounds upload polling', async () => {
  const results = [accepted('upload'), status('Succeeded'), accepted('submission'), status('Failed', 'InProgressSubmission')];
  await assert.rejects(submitEdgeReview({ ...config, fetchImpl: async () => results.shift() }), /InProgressSubmission/);
  let count = 0;
  await assert.rejects(submitEdgeReview({ ...config, fetchImpl: async () => ++count === 1 ? accepted('upload') : status('InProgress') }), /timed out/);
  assert.equal(count, 61);
});
