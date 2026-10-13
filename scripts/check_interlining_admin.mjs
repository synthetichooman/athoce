import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminSessionCookie } from '../functions/_config.js';
import { onRequestGet } from '../functions/api/interlining/submissions.js';
import { onRequestGet as connect } from '../functions/api/interlining/connect.js';
import { csvCell, submissionsCsv } from '../interlining/admin/csv.js';

const env = { ADMIN_PASSWORD: 'local-test-only' };
async function request(query = '') {
  return new Request(`https://athoce.kr/api/interlining/submissions${query}`, { headers: { cookie: (await createAdminSessionCookie(env)).split(';')[0] } });
}
function localStorage() {
  const rows = Array.from({ length: 5 }, (_, i) => ({ code: `athoce-${i}`, submittedAt: `2026-10-13T00:00:0${5-i}Z`, fullName: `Local ${i}`, instagram: '@local', phone: '010-0000-0000', address: 'Sample', guests: '0', filmingConsent: '동의', answers: [], fingerprint: 'private' }));
  return { rows, kv: {
    get: async (key) => rows.find((_, i) => key === `interlining:submission:${i}`) || null,
    list: async ({ prefix, cursor }) => {
      assert.equal(prefix, 'interlining:submission:');
      const keys = rows.map((row, i) => ({ name: `interlining:submission:${i}`, metadata: { submittedAt: row.submittedAt } }));
      return cursor ? { keys: keys.slice(2), list_complete: true } : { keys: keys.slice(0, 2), list_complete: false, cursor: 'remaining' };
    },
  } };
}

test('unauthenticated listing does not read storage or contact an external service', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected external request'); });
  const response = await onRequestGet({ env: { ...env, ATHOCE_KV: { list: () => { throw new Error('unauthenticated storage read'); } } }, request: new Request('https://athoce.kr/api/interlining/submissions') });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('the retired connection URL never redirects to an external service', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected external request'); });
  const response = connect();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('location'), null);
  assert.equal((await response.json()).error.code, 'CONNECTION_NOT_NEEDED');
});
test('bad pagination is rejected before reading storage', async () => {
  const invalidEnv = { ...env, ATHOCE_KV: { list: () => { throw new Error('unexpected storage read'); } } };
  for (const query of ['?page=0', '?page=1.5', '?limit=101', '?page=9007199254740991&limit=100']) {
    assert.equal((await onRequestGet({ env: invalidEnv, request: await request(query) })).status, 400);
  }
});
test('local pagination and CSV enumeration include every record once without external credentials or requests', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected external request'); });
  const local = localStorage(); const localEnv = { ...env, ATHOCE_KV: local.kv };
  const codes = [];
  for (let page = 1; page <= 2; page++) {
    const response = await onRequestGet({ env: localEnv, request: await request(`?page=${page}&limit=3&formNo=999&unitCode=other`) });
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.totalCount, 5); assert.equal(data.totalPage, 2);
    assert.equal(data.list.length, page === 1 ? 3 : 2);
    assert.ok(data.list.every((item) => !('fingerprint' in item)));
    codes.push(...data.list.map((item) => item.code));
  }
  assert.deepEqual(codes, local.rows.map((item) => item.code));
  assert.equal(new Set(codes).size, 5);
});
test('an empty configured store is readable, but a missing store is not reported as an empty list', async () => {
  const empty = await onRequestGet({ env: { ...env, ATHOCE_KV: { list: async () => ({ keys: [], list_complete: true }) } }, request: await request() });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).data, { page: 1, limit: 50, totalCount: 0, totalPage: 0, list: [] });
  const missing = await onRequestGet({ env, request: await request() });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, 'STORAGE_UNAVAILABLE');
});
test('missing records and incomplete storage cursors are reported as failures', async () => {
  const local = localStorage();
  const missingRow = await onRequestGet({ env: { ...env, ATHOCE_KV: { ...local.kv, get: async () => null } }, request: await request() });
  assert.equal(missingRow.status, 503);
  const brokenCursor = await onRequestGet({ env: { ...env, ATHOCE_KV: { list: async () => ({ keys: [], list_complete: false }) } }, request: await request() });
  assert.equal(brokenCursor.status, 503);
});
test('CSV preserves Unicode, multiline quotes, complete answers and guards spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell(' \t@formula'), '"\' \t@formula"');
  assert.equal(csvCell('line\n"quoted"'), '"line\n""quoted"""');
  const row = { ...localStorage().rows[0], address: 'Sample road / Unit 2 / 00000', guests: '4', answers: [{ label: '현장 기록 촬영 동의', value: '동의' }] };
  const csv = submissionsCsv([row]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /Unit 2/);
  assert.match(csv, /동의/);
});
