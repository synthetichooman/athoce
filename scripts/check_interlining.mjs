import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { onRequestPost } from '../functions/api/interlining.js';

const input = {
  fullName: 'Sample', instagram: '@example', phoneFirst: '010', phoneMiddle: '0000',
  phoneLast: '0000', address: 'Sample address', addressDetail: 'Sample detail', postcode: '00000', guests: '0', filmingConsent: '동의', guestsDetail: '', website: '',
};
function request(body = input, origin = 'https://athoce.kr') {
  return new Request('https://athoce.kr/api/interlining', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('invalid requests never reach the original form', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream call'); });
  for (const [body, origin, expected] of [
    [input, 'https://elsewhere.example', 403], [null, 'https://athoce.kr', 400],
    [{ ...input, fullName: '' }, 'https://athoce.kr', 400],
    [{ ...input, website: 'spam' }, 'https://athoce.kr', 400],
    [{ ...input, phoneLast: 'abc' }, 'https://athoce.kr', 400],
    [{ ...input, postcode: '1234' }, 'https://athoce.kr', 400],
    [{ ...input, filmingConsent: '' }, 'https://athoce.kr', 400],
    [{ ...input, guests: '4' }, 'https://athoce.kr', 400],
    [{ ...input, guests: 'etc', guestsDetail: '' }, 'https://athoce.kr', 400],
    [{ ...input, address: 'x'.repeat(9000) }, 'https://athoce.kr', 413],
  ]) {
    const response = await onRequestPost({ request: request(body, origin) });
    assert.equal(response.status, expected);
    assert.equal((await response.json()).ok, false);
  }
});

function storage() {
  const rows = new Map();
  return { rows, get: async (key) => rows.has(key) ? JSON.parse(rows.get(key).value) : null,
    put: async (key, value, options) => rows.set(key, { value, options }), delete: async (key) => rows.delete(key),
    list: async ({ prefix }) => ({ keys: [...rows].filter(([key]) => key.startsWith(prefix)).map(([name, row]) => ({ name, metadata: row.options?.metadata })), list_complete: true }),
  };
}
const id = '74c02f48-d126-4c49-92cb-61fd72ae21f9';

test('valid submissions persist complete answers without calling Imweb', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream call'); });
  const kv = storage();
  const response = await onRequestPost({ env: { ATHOCE_KV: kv }, request: request({ ...input, submissionId: id, guests: 'etc', guestsDetail: '4' }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  const row = await kv.get(`interlining:submission:${id}`);
  assert.equal(result.ok, true);
  assert.equal(row.code, result.code);
  assert.equal(row.fullName, input.fullName);
  assert.equal(row.phone, '010-0000-0000');
  assert.match(row.address, /Sample detail \/ 00000/);
  assert.equal(row.guests, '4');
  assert.equal(row.filmingConsent, '동의');
  assert.equal(row.answers.length, 6);
  assert.deepEqual(kv.rows.get(`interlining:submission:${id}`).options.metadata, { submittedAt: row.submittedAt });
});

test('a retry after a lost response reuses the saved record and never overwrites different input', async () => {
  const kv = storage(); const env = { ATHOCE_KV: kv };
  const first = await (await onRequestPost({ env, request: request({ ...input, submissionId: id }) })).json();
  const again = await (await onRequestPost({ env, request: request({ ...input, submissionId: id }) })).json();
  assert.equal(again.code, first.code);
  assert.equal(kv.rows.size, 1);
  const conflict = await onRequestPost({ env, request: request({ ...input, submissionId: id, fullName: 'Changed' }) });
  assert.equal(conflict.status, 409);
  assert.equal((await kv.get(`interlining:submission:${id}`)).fullName, input.fullName);
});

test('simultaneous applicants use separate keys and missing storage is never reported as success', async () => {
  const kv = storage(); const env = { ATHOCE_KV: kv };
  const responses = await Promise.all([id, crypto.randomUUID()].map((submissionId) => onRequestPost({ env, request: request({ ...input, submissionId }) })));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(kv.rows.size, 2);
  assert.equal((await onRequestPost({ env: {}, request: request() })).status, 503);
  const failed = await onRequestPost({ env: { ATHOCE_KV: { get: async () => null, put: async () => { throw new Error('write failed'); } } }, request: request() });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).ok, false);
});

test('health checks use the deployed write path, remove temporary records, and require authentication', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ statusCode: 403 }, { status: 403 }));
  const { onRequestGet: health } = await import('../functions/api/interlining/health.js');
  const { createAdminSessionCookie } = await import('../functions/_config.js');
  const kv = storage(); const env = { ATHOCE_KV: kv, ADMIN_PASSWORD: 'test-only' };
  const unauthorized = await health({ env, request: new Request('https://athoce.kr/api/interlining/health') });
  assert.equal(unauthorized.status, 401);
  assert.equal(kv.rows.size, 0);
  const cookie = (await createAdminSessionCookie(env)).split(';')[0];
  const response = await health({ env, request: new Request('https://athoce.kr/api/interlining/health', { headers: { cookie } }) });
  assert.deepEqual(await response.json(), { ok: true, storage: 'ready', saveVerified: true, repeatVerified: true, listVerified: true });
  assert.equal(kv.rows.size, 0);
});

test('both direct URL variants and required input names are present', async () => {
  const redirects = await readFile(new URL('../_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/interlining \/interlining\/index.html 200$/m);
  assert.match(redirects, /^\/interlining\/ \/interlining\/index.html 200$/m);
  const html = await readFile(new URL('../interlining/index.html', import.meta.url), 'utf8');
  for (const name of Object.keys(input)) assert.ok(html.includes(`name="${name}"`));
});
