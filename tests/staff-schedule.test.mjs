import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { StaffSchedule } from '../workers/staff-schedule/index.js';
import { onRequest } from '../functions/api/staff/[[path]].js';
import { createAdminSessionCookie } from '../functions/_config.js';
import { createRecruitViewerCookie } from '../functions/_recruit-access.js';
import { today, weekOf, nextMonth } from '../functions/_staff-schedule.js';

const week = '2026-11-02'; const month = '2026-11';
function setup(t) {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-29T15:00:00+09:00'));
  const state = new Map();
  const storage = { get: async key => structuredClone(state.get(key)), put: async (key, value) => { state.set(key, structuredClone(value)); }, list: async ({ prefix }) => new Map([...state].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])), transaction: async fn => fn(storage) };
  const object = new StaffSchedule({ storage });
  const env = { ADMIN_PASSWORD: 'local-test-password', STAFF_SCHEDULE: { idFromName: name => name, get: () => ({ fetch: (url, options) => object.fetch(new Request(url, options)) }) } };
  const owner = createAdminSessionCookie(env).then(c => c.split(';')[0]);
  async function call(path = '', body, cookie = '', headers = {}) {
    const req = new Request(`https://athoce.kr/api/staff/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, ...(body === undefined ? {} : { origin: 'https://athoce.kr', 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await onRequest({ request: req, env, params: { path: path.split('?')[0] } });
    return { status: result.status, data: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = async body => call('admin', body, await owner);
  async function add(name = '테스트 직원') { const id = randomUUID(); const token = randomBytes(32).toString('hex'); assert.equal((await admin({ op: 'employee.add', id, token, name })).status, 200); const session = await call('login', { token }); assert.equal(session.status, 200); return { id, token, cookie: session.cookie }; }
  async function save(e, dates = [week], version = 0) { return call('me', { op: 'availability.save', month, dates, note: '테스트 메모', version }, e.cookie); }
  async function draft(e, overrides = {}) { return admin({ op: 'week.save', week, version: 0, start: '13:00', end: '20:00', assignments: { [week]: [e.id] }, required: { '2026-11-02': 1, '2026-11-03': 0, '2026-11-04': 0, '2026-11-05': 0, '2026-11-06': 0, '2026-11-07': 0, '2026-11-08': 0 }, ...overrides }); }
  return { state, env, call, admin, add, save, draft };
}
test('Korea date, Monday week and end-of-month next month are correct', () => {
  assert.equal(today(Date.parse('2026-10-31T16:00:00Z')), '2026-11-01'); assert.equal(weekOf('2026-11-01'), '2026-10-26'); assert.equal(nextMonth('2026-10-30'), '2026-11'); assert.equal(nextMonth('2026-12-31'), '2027-01');
});
test('anonymous, recruitment viewer and employee cannot access staff management', async t => {
  const { env, call, add } = setup(t); const e = await add();
  for (const cookie of ['', e.cookie, (await createRecruitViewerCookie(env)).split(';')[0]]) assert.equal((await call('admin', undefined, cookie)).status, 401);
  assert.equal((await call('me')).status, 401);
});
test('employee only sees own dates, requests and assignments; no invite hashes leak', async t => {
  const { call, add, save, admin } = setup(t); const a = await add('직원 A'); const b = await add('비공개 직원 B'); await save(a); await save(b, ['2026-11-03']);
  const result = await call('me?month=2026-11', undefined, a.cookie);
  assert.equal(result.status, 200); assert.deepEqual(result.data.availability.dates, [week]);
  for (const value of [b.id, '비공개 직원 B', a.token, b.token, 'credential']) assert.ok(!JSON.stringify(result.data).includes(value));
  assert.ok(!JSON.stringify((await admin()).data).includes('credential'));
});
test('concurrent monthly edits cannot silently overwrite each other', async t => {
  const { add, save, state } = setup(t); const e = await add();
  const results = await Promise.all([save(e, [week]), save(e, ['2026-11-03'])]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(state.get(`month:${month}`)[e.id].version, 1);
});
test('empty availability is a real submission, distinct from no response', async t => { const { add, save, state } = setup(t); const e = await add(); assert.equal((await save(e, [])).status, 200); assert.ok(state.get(`month:${month}`)[e.id].submittedAt); });
test('draft is invisible to staff until published; publishing locks dates', async t => {
  const { add, save, draft, admin, call } = setup(t); const e = await add(); await save(e); assert.equal((await draft(e)).status, 200);
  assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.confirmed.length, 0);
  assert.equal((await admin({ op: 'week.publish', week, version: 1 })).status, 200);
  const result = (await call('me?month=2026-11', undefined, e.cookie)).data;
  assert.equal(result.confirmed[0].date, week); assert.equal(result.locked.length, 7);
  assert.equal((await save(e, [], 1)).status, 409);
});
test('publishing rejects understaffed days and stale employee availability', async t => {
  const { add, save, draft, admin } = setup(t); const e = await add(); await save(e); await draft(e);
  await save(e, [], 1); assert.equal((await admin({ op: 'week.publish', week, version: 1 })).status, 409);
  await save(e, [week], 2); const required = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-11-0${i + 2}`, 1]));
  assert.equal((await draft(e, { version: 1, required })).status, 200); assert.equal((await admin({ op: 'week.publish', week, version: 2 })).status, 409);
});
test('editing a published week preserves the current published assignment until reconfirmation', async t => {
  const { add, save, draft, admin, call } = setup(t); const e = await add(); await save(e); await draft(e); await admin({ op: 'week.publish', week, version: 1 });
  const required = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-11-0${i + 2}`, 0]));
  assert.equal((await draft(e, { version: 2, assignments: {}, required })).status, 200);
  assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.confirmed.length, 1);
  await admin({ op: 'week.publish', week, version: 3 }); assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.confirmed.length, 0);
});
test('approved change removes only that employee assignment and leaves shortage visible', async t => {
  const { add, save, draft, admin, call, state } = setup(t); const e = await add(); await save(e); await draft(e); await admin({ op: 'week.publish', week, version: 1 });
  const id = randomUUID(); const request = { op: 'request.add', id, date: week, available: false, reason: '개인 일정' };
  assert.equal((await call('me', request, e.cookie)).status, 200); assert.equal((await call('me', request, e.cookie)).status, 200);
  assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.confirmed.length, 1);
  assert.equal((await admin({ op: 'request.resolve', id, decision: 'approved' })).status, 200);
  assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.confirmed.length, 0);
  assert.deepEqual(state.get(`week:${week}`).published.assignments[week], []); assert.equal(state.get(`week:${week}`).required[week], 1);
  assert.equal((await admin({ op: 'request.resolve', id, decision: 'rejected' })).status, 409);
});
test('rejected changes preserve published work and cannot be forged for another employee', async t => {
  const { add, save, draft, admin, call } = setup(t); const e = await add(); const other = await add(); await save(e); await draft(e); await admin({ op: 'week.publish', week, version: 1 });
  const id = randomUUID(); await call('me', { op: 'request.add', id, employeeId: e.id, date: week, available: false, reason: '요청' }, other.cookie);
  assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.requests.length, 0);
  await admin({ op: 'request.resolve', id, decision: 'rejected' }); assert.equal((await call('me?month=2026-11', undefined, e.cookie)).data.confirmed.length, 1);
});
test('rotated and archived links invalidate existing employee cookies immediately', async t => {
  const { add, admin, call } = setup(t); const e = await add(); const token = randomBytes(32).toString('hex');
  await admin({ op: 'employee.rotate', id: e.id, token }); assert.equal((await call('me', undefined, e.cookie)).status, 401); assert.equal((await call('login', { token: e.token })).status, 401);
  const session = await call('login', { token }); assert.equal(session.status, 200); await admin({ op: 'employee.archive', id: e.id }); assert.equal((await call('me', undefined, session.cookie)).status, 401);
});
test('future confirmed assignment blocks staff archive; confirmed history blocks deletion', async t => {
  const { add, save, draft, admin } = setup(t); const e = await add(); await save(e); await draft(e); await admin({ op: 'week.publish', week, version: 1 });
  for (const op of ['employee.archive', 'employee.delete']) assert.equal((await admin({ op, id: e.id })).status, 409);
});
test('deleting unassigned employee cleans personal notes, requests and draft references', async t => {
  const { add, save, draft, admin, state, call } = setup(t); const e = await add(); await save(e); await draft(e);
  assert.equal((await admin({ op: 'employee.delete', id: e.id })).status, 200); assert.equal(state.get('employees').length, 0); assert.equal(state.get(`month:${month}`)[e.id], undefined); assert.deepEqual(state.get(`week:${week}`).draft[week], []); assert.equal((await call('me', undefined, e.cookie)).status, 401);
});
test('invalid dates, oversized notes, forged operations and cross-origin writes fail', async t => {
  const { add, call, save, env } = setup(t); const e = await add();
  for (const fields of [{ dates: ['2026-11-31'] }, { dates: [week, week] }, { note: 'x'.repeat(301) }, { month: '2029-01' }]) assert.equal((await call('me', { op: 'availability.save', month, dates: [week], note: '', version: 0, ...fields }, e.cookie)).status, 400);
  assert.equal((await call('me', { op: 'employee.delete', id: e.id }, e.cookie)).status, 400);
  assert.equal((await call('me', { op: 'availability.save' }, e.cookie, { origin: 'https://other.example' })).status, 403);
  assert.equal((await call('me', { op: 'availability.save' }, e.cookie, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call('me', { note: 'x'.repeat(25000) }, e.cookie)).status, 413);
  const malformed = await onRequest({ env, params: { path: 'me' }, request: new Request('https://athoce.kr/api/staff/me', { method: 'POST', body: '{', headers: { origin: 'https://athoce.kr', 'content-type': 'application/json' } }) }); assert.equal(malformed.status, 400);
  assert.equal((await save(e)).status, 200);
});
test('missing schedule binding fails closed', async () => { const response = await onRequest({ env: {}, params: { path: 'login' }, request: new Request('https://athoce.kr/api/staff/login', { method: 'POST', headers: { origin: 'https://athoce.kr', 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(64) }) }) }); assert.equal(response.status, 503); });

test('obsolete pending requests can be rejected but cannot change past work', async t => {
  const { state, add, admin } = setup(t); const e = await add(); const id = randomUUID();
  state.set('requests', [{ id, employeeId: e.id, date: '2026-10-28', available: false, reason: '지난 요청', status: 'pending' }]);
  assert.equal((await admin({ op: 'request.resolve', id, decision: 'approved' })).status, 400);
  assert.equal((await admin({ op: 'request.resolve', id, decision: 'rejected' })).status, 200);
});
