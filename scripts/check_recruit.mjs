import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createAdminSessionCookie } from '../functions/_config.js';
import { createInterliningViewerCookie } from '../functions/_interlining-access.js';
import { onRequestPost as submit } from '../functions/api/recruit.js';
import { onRequestGet as list } from '../functions/api/recruit/submissions.js';
import { onRequestGet as health } from '../functions/api/recruit/health.js';
import { submissionsCsv } from '../recruit/admin/csv.js';

const owner = { ADMIN_PASSWORD: 'test-only-owner', INTERLINING_VIEWER_PASSWORD_SHA256: createHash('sha256').update('test-only-viewer').digest('hex') };
const sample = () => ({ submissionId: crypto.randomUUID(), fullName: 'Local test', instagram: '@local', phoneFirst: '010', phoneMiddle: '0000', phoneLast: '0000', availableDays: ['금요일', '월요일'], introduction: 'First line\n"Second line"' });
const request = body => new Request('https://athoce.kr/api/recruit', { method: 'POST', headers: { origin: 'https://athoce.kr', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ownerRequest = async (query = '', path = 'submissions') => new Request(`https://athoce.kr/api/recruit/${path}${query}`, { headers: { cookie: (await createAdminSessionCookie(owner)).split(';')[0] } });
function storage() {
  const rows = new Map(); const writes = [];
  const kv = {
    get: async key => rows.get(key) || null,
    put: async (key, value, options) => { rows.set(key, JSON.parse(value)); writes.push({ key, options }); },
    delete: async key => rows.delete(key),
    list: async ({ prefix, cursor }) => {
      const all = [...rows].filter(([key]) => key.startsWith(prefix)).map(([name, row]) => ({ name, metadata: { submittedAt: row.submittedAt } }));
      const offset = Number(cursor || 0); const keys = all.slice(offset, offset + 2);
      return { keys, list_complete: offset + 2 >= all.length, cursor: String(offset + 2) };
    },
  };
  return { rows, writes, env: { ...owner, ATHOCE_KV: kv } };
}

test('five answers save in the recruitment namespace without external calls; repeat IDs do not duplicate', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('external request'); });
  const local = storage(); const body = sample();
  local.rows.set('interlining:submission:unrelated', { code: 'old', answers: [] });
  for (let i = 0; i < 2; i++) {
    const response = await submit({ env: local.env, request: request(body) });
    assert.equal(response.status, 200); assert.equal((await response.json()).code, `recruit-${body.submissionId}`);
  }
  assert.equal(local.writes.length, 1);
  const stored = local.rows.get(`recruit:submission:${body.submissionId}`);
  assert.equal(stored.answers.length, 5); assert.equal(stored.availableDays, '월요일, 금요일');
  assert.equal(stored.introduction, body.introduction); assert.equal(stored.phone, '010-0000-0000');
  assert.equal((await submit({ env: local.env, request: request({ ...body, fullName: 'Changed' }) })).status, 409);
  assert.equal(local.writes.length, 1);
});

test('invalid input never reaches storage', async () => {
  const env = { ATHOCE_KV: { get: () => { throw new Error('unexpected storage'); } } };
  const invalid = [null, [], { website: 'bot' }, { availableDays: [] }, { availableDays: '월요일' }, { availableDays: ['매일'] }, { introduction: 'x'.repeat(5001) }, { phoneLast: 'nope' }, { submissionId: 'invalid' }, { fullName: '' }];
  for (const fields of invalid) {
    const body = fields === null || Array.isArray(fields) ? fields : { ...sample(), ...fields };
    assert.equal((await submit({ env, request: request(body) })).status, 400);
  }
  const malformed = request({}); malformed.headers.set('origin', 'https://other.example');
  assert.equal((await submit({ env, request: malformed })).status, 403);
  assert.equal((await submit({ env, request: new Request('https://athoce.kr/api/recruit', { method: 'POST', headers: { origin: 'https://athoce.kr', 'content-type': 'application/json' }, body: '{' }) })).status, 400);
});

test('different applicants saving together remain independent; storage failures cannot report success', async () => {
  const local = storage();
  const responses = await Promise.all(Array.from({ length: 4 }, () => submit({ env: local.env, request: request(sample()) })));
  assert.ok(responses.every(response => response.status === 200)); assert.equal(local.rows.size, 4);
  for (const env of [{}, { ATHOCE_KV: { get: async () => null, put: async () => { throw new Error('offline'); } } }]) {
    const response = await submit({ env, request: request(sample()) });
    assert.equal(response.status, 503); assert.equal((await response.json()).ok, false);
  }
});

test('owner can list recruitment data; anonymous and old interlining viewer access are rejected', async () => {
  const env = { ...owner, ATHOCE_KV: { list: () => { throw new Error('unauthorized read'); } } };
  for (const cookie of ['', (await createInterliningViewerCookie(owner)).split(';')[0]]) {
    const response = await list({ env, request: new Request('https://athoce.kr/api/recruit/submissions', { headers: { cookie } }) });
    assert.equal(response.status, 401); assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const local = storage(); local.rows.set('interlining:submission:private', { code: 'old', answers: [] });
  await Promise.all(Array.from({ length: 5 }, () => submit({ env: local.env, request: request(sample()) })));
  const found = [];
  for (const page of [1, 2]) {
    const result = await (await list({ env: local.env, request: await ownerRequest(`?page=${page}&limit=3`) })).json();
    assert.equal(result.data.totalCount, 5); found.push(...result.data.list);
  }
  assert.equal(new Set(found.map(row => row.code)).size, 5);
  assert.ok(found.every(row => !('fingerprint' in row) && row.code.startsWith('recruit-')));
  for (const query of ['?page=0', '?limit=101', '?page=1.5']) assert.equal((await list({ env, request: await ownerRequest(query) })).status, 400);
});

test('health checks use expiring isolated records and remove them even when writes fail', async () => {
  const local = storage();
  assert.equal((await health({ env: local.env, request: new Request('https://athoce.kr/api/recruit/health') })).status, 401);
  const response = await health({ env: local.env, request: await ownerRequest('', 'health') });
  assert.deepEqual(await response.json(), { ok: true, saveVerified: true, repeatVerified: true, listVerified: true });
  assert.equal(local.rows.size, 0); assert.equal(local.writes.length, 1);
  assert.ok(local.writes[0].key.startsWith('recruit:health:')); assert.equal(local.writes[0].options.expirationTtl, 60);
  local.env.ATHOCE_KV.put = async () => { throw new Error('offline'); };
  assert.equal((await health({ env: local.env, request: await ownerRequest('', 'health') })).status, 503);
  assert.equal(local.rows.size, 0);
});

test('CSV exports all five fields, multiline introductions and formula guards', () => {
  const csv = submissionsCsv([{ code: 'recruit-test', submittedAt: '2026-10-28T00:00:00Z', fullName: '=1+1', instagram: '@local', phone: '010-0000-0000', availableDays: '월요일, 금요일', introduction: 'First\n"Second"' }]);
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /자기소개/); assert.ok(csv.includes('"First\n""Second"""')); assert.ok(csv.includes('"\'=1+1"'));
});
