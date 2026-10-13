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
  const response = await connect({ env: { ...env, ATHOCE_KV: { get: async () => ({ accessToken: 'mock', scope: 'order:read product:read' }) } }, request: await request() });
  assert.equal(response.status, 302);
  const scope = new URL(response.headers.get('location')).searchParams.get('scope').split(' ');
  assert.ok(scope.includes('community:read'));
  assert.ok(scope.includes('order:read'));
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
