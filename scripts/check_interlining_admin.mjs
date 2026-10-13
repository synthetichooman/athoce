import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminSessionCookie } from '../functions/_config.js';
import { onRequestGet } from '../functions/api/interlining/submissions.js';
import { onRequestGet as connect } from '../functions/api/interlining/connect.js';
import { INTERLINING_FORM, INTERLINING_UNIT, normalizeSubmission } from '../functions/_interlining-admin.js';
import { csvCell, submissionsCsv } from '../interlining/admin/csv.js';

const env = { ADMIN_PASSWORD: 'local-test-only', IMWEB_ACCESS_TOKEN: 'mock-token' };
const form = { formCode: INTERLINING_FORM, unitCode: INTERLINING_UNIT, formNo: 42 };
const row = {
  ...form, submitCode: 'sample-submission', wtime: '2026-10-13T00:00:00Z',
  item: [
    { itemCode: '39c93ffaf43e1', itemSubject: '성함', value: 'Sample' },
    { itemSubject: 'instagram', value: '@sample' },
    { itemCode: '9074cf8680318', itemType: 'phonenumber', valueList: ['010','0000','1111'] },
    { itemSubject: '주소', value: 'Sample road', valueList: ['Sample road','Unit 2','00000'] },
    { itemSubject: '동반인원 수', value: 'etc', etcValue: '4' },
    { itemCode: '17vc6yN7V6', value: '동의' },
  ],
};
async function request(query = '') {
  return new Request(`https://athoce.kr/api/interlining/submissions${query}`, { headers: { cookie: (await createAdminSessionCookie(env)).split(';')[0] } });
}
function result(list, page = 1, totalPage = 1, totalCount = list.length) {
  return Response.json({ statusCode: 200, data: { list, currentPage: page, totalPage, totalCount } });
}

test('unauthenticated listing and authorization never contact Imweb', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream call'); });
  for (const handler of [onRequestGet, connect]) {
    const response = await handler({ env, request: new Request('https://athoce.kr/api/interlining/submissions') });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});
test('form discovery paginates and only requests the pinned interlining form', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('unitCode'), INTERLINING_UNIT);
    if (calls === 1) return result([{ ...form, formCode: 'other' }], 1, 2, 101);
    if (calls === 2) { assert.equal(parsed.searchParams.get('page'), '2'); return result([form], 2, 2, 101); }
    assert.equal(parsed.pathname, '/community/form-submissions');
    assert.equal(parsed.searchParams.get('formNo'), '42');
    return result([row]);
  });
  const response = await onRequestGet({ env, request: await request('?formNo=999&unitCode=other') });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.list[0].fullName, 'Sample');
  assert.equal(data.list[0].phone, '010-0000-1111');
  assert.match(data.list[0].address, /Unit 2/);
  assert.equal(calls, 3);
});
test('an upstream response containing another form is never exposed', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? result([form]) : result([{ ...row, formCode: 'other' }]));
  const response = await onRequestGet({ env, request: await request() });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'FORM_MISMATCH');
});
test('missing community permission is actionable and does not resemble an empty list', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ statusCode: 403, errorCode: 30103 }, { status: 403 }));
  const response = await onRequestGet({ env, request: await request() });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'COMMUNITY_PERMISSION_REQUIRED');
});
test('bad pagination is rejected before fetching', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream call'); });
  for (const query of ['?page=0', '?page=1.5', '?limit=101']) {
    assert.equal((await onRequestGet({ env, request: await request(query) })).status, 400);
  }
});
test('a malformed page cannot be silently exported', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? result([form]) : result([{ ...row, submitCode: '' }]));
  assert.equal((await onRequestGet({ env, request: await request() })).status, 502);
});
test('authorization retains existing scopes and requests only read access for community', async () => {
  const response = await connect({ env: { ...env, ATHOCE_KV: { get: async () => ({ accessToken: 'mock', scope: 'order:read,product:read, community:read' }) } }, request: await request() });
  assert.equal(response.status, 302);
  const scope = new URL(response.headers.get('location')).searchParams.get('scope').split(' ');
  assert.ok(scope.includes('community:read'));
  assert.ok(scope.includes('order:read'));
  assert.ok(scope.every((value) => !value.includes(',')));
  assert.equal(scope.filter((value) => value === 'community:read').length, 1);
  assert.ok(!scope.includes('community:write'));
});
test('CSV preserves Unicode, multiline quotes, complete answers and guards spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell(' \t@formula'), '"\' \t@formula"');
  assert.equal(csvCell('line\n"quoted"'), '"line\n""quoted"""');
  const csv = submissionsCsv([normalizeSubmission(row)]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /Unit 2/);
  assert.match(csv, /etc \/ 4/);
  assert.match(csv, /동의/);
});

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

test('combined pages contain each local and Imweb record exactly once across a source boundary', async (t) => {
  const local = localStorage(); const combinedEnv = { ...env, ATHOCE_KV: local.kv };
  const remote = Array.from({ length: 4 }, (_, i) => ({ ...row, submitCode: `remote-${i}` }));
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/community/forms') return result([form]);
    const page = Number(parsed.searchParams.get('page')); const limit = Number(parsed.searchParams.get('limit'));
    return result(remote.slice((page-1)*limit, page*limit), page, Math.ceil(remote.length/limit), remote.length);
  });
  const codes = [];
  for (let page = 1; page <= 3; page++) {
    const response = await onRequestGet({ env: combinedEnv, request: await request(`?page=${page}&limit=3`) });
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.totalCount, 9); assert.equal(data.totalPage, 3); assert.equal(data.list.length, 3);
    assert.ok(data.list.every((item) => !('fingerprint' in item)));
    codes.push(...data.list.map((item) => item.code));
  }
  assert.deepEqual(codes, [...local.rows.map((item) => item.code), ...remote.map((item) => item.submitCode)]);
  assert.equal(new Set(codes).size, 9);
});

test('local responses stay readable when Imweb is unavailable and partial results are clearly marked', async (t) => {
  const local = localStorage();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ statusCode: 403, errorCode: 30103 }, { status: 403 }));
  const response = await onRequestGet({ env: { ...env, ATHOCE_KV: local.kv }, request: await request('?page=2&limit=3') });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.incomplete, true);
  assert.equal(data.totalCount, 5);
  assert.match(data.warning, /아임웹/);
  assert.deepEqual(data.list.map((item) => item.code), ['athoce-3', 'athoce-4']);
});
