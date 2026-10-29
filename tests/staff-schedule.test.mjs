import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { StaffSchedule } from '../workers/staff-schedule/index.js';
import { onRequest } from '../functions/api/staff/[[path]].js';
import { createAdminSessionCookie, isAdminAuthorized } from '../functions/_config.js';
import { recruitAccess } from '../functions/_recruit-access.js';
import { createRecruitViewerCookie } from '../functions/_recruit-access.js';
import { today, weekOf, nextMonth, tokenHash } from '../functions/_staff-schedule.js';

const week = '2026-11-02'; const month = '2026-11';
function setup(t, { staged = false } = {}) {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-29T15:00:00+09:00'));
  const state = new Map();
  // Existing untagged records retain the original flow; staged cases below start with empty storage.
  if (!staged) state.set(`week:${week}`, { week, version: 0, draft: {}, published: null, start: '13:00', end: '20:00', required: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-11-0${i + 2}`, 1])) });
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
  async function add(name = '테스트 직원', role = 'staff') { const id = randomUUID(); const token = randomBytes(32).toString('hex'); assert.equal((await admin({ op: 'employee.add', id, token, name, role })).status, 200); const session = await call('login', { token }); assert.equal(session.status, 200); return { id, token, cookie: session.cookie }; }
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
test('dedicated admin password grants only staff management and supports logout', async t => {
  const { env, call } = setup(t);
  env.STAFF_ADMIN_PASSWORD_SHA256 = await tokenHash('test-staff-only-password');
  assert.equal((await call('admin/login', { password: 'wrong-password' })).status, 401);
  const session = await call('admin/login', { password: 'test-staff-only-password' });
  assert.equal(session.status, 200);
  assert.ok(session.cookie.startsWith('athoce_staff_admin_session='));
  assert.equal((await call('admin', undefined, session.cookie)).status, 200);
  const added = await call('admin', { op: 'employee.add', id: randomUUID(), name: '전용 관리자 검증', token: randomBytes(32).toString('hex') }, session.cookie);
  assert.equal(added.status, 200);
  const request = new Request('https://athoce.kr/api/admin/session', { headers: { cookie: session.cookie } });
  assert.equal(await isAdminAuthorized(request, env), false);
  assert.equal(await recruitAccess(request, env), null);
  assert.equal((await call('me', undefined, session.cookie)).status, 401);
  const logout = await call('admin/logout', {}, session.cookie);
  assert.equal(logout.status, 200);
  assert.ok(logout.cookie.includes('athoce_staff_admin_session='));
  assert.equal((await call('admin', undefined, logout.cookie)).status, 401);
  assert.equal((await call('admin/login', { password: 'local-test-password' })).status, 200);
});
test('dedicated sessions reject tampering, expiration and password rotation', async t => {
  const { env, call } = setup(t);
  env.STAFF_ADMIN_PASSWORD_SHA256 = await tokenHash('test-staff-only-password');
  const session = await call('admin/login', { password: 'test-staff-only-password' });
  assert.equal((await call('admin', undefined, session.cookie + 'x')).status, 401);
  t.mock.method(Date, 'now', () => Date.parse('2026-10-31T15:00:00+09:00'));
  assert.equal((await call('admin', undefined, session.cookie)).status, 401);
  t.mock.method(Date, 'now', () => Date.parse('2026-10-29T15:00:00+09:00'));
  env.STAFF_ADMIN_PASSWORD_SHA256 = await tokenHash('replacement-password');
  assert.equal((await call('admin', undefined, session.cookie)).status, 401);
  assert.equal((await call('admin/login', { password: 'test-staff-only-password' })).status, 401);
});
test('dedicated login fails closed without configuration and limits repeated failures', async t => {
  const { env, call } = setup(t);
  assert.equal((await call('admin/login', { password: '' })).status, 401);
  assert.equal((await call('admin/login', { password: 'unconfigured' })).status, 401);
  const records = new Map();
  env.ATHOCE_KV = { get: async k => JSON.parse(records.get(k) || 'null'), put: async (k, v) => records.set(k, v), delete: async k => records.delete(k) };
  env.STAFF_ADMIN_PASSWORD_SHA256 = await tokenHash('test-staff-only-password');
  for (let i = 0; i < 8; i++) assert.equal((await call('admin/login', { password: 'wrong-password' })).status, 401);
  assert.equal((await call('admin/login', { password: 'test-staff-only-password' })).status, 429);
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

async function stagedSetup(t) {
  const h = setup(t, { staged: true });
  const core = [];
  for (const name of ['아토스 A', '아토스 B', '아토스 C']) core.push(await h.add(name, 'core'));
  const staff = await h.add('스태프 A');
  const submitCore = async () => { for (let i = 0; i < 3; i++) assert.equal((await h.save(core[i], [`2026-11-0${i + 2}`])).status, 200); };
  const open = version => h.admin({ op: 'week.open', week, version });
  return { ...h, core, staff, submitCore, open };
}
test('new workflow waits for all three core employees before opening staff applications', async t => {
  const h = await stagedSetup(t);
  const first = await h.admin(); assert.equal(first.data.schedule.workflow, 'staged'); assert.equal(first.data.workflow.ready, false);
  assert.equal((await h.save(h.staff, ['2026-11-05'])).status, 409);
  assert.equal((await h.open(0)).status, 409);
  await h.save(h.core[0]); await h.save(h.core[1], ['2026-11-03']);
  assert.equal((await h.open(0)).status, 409);
  await h.save(h.core[2], []);
  assert.equal((await h.admin()).data.workflow.ready, true);
  assert.equal((await h.open(0)).status, 200);
  assert.equal(h.state.get(`week:${week}`).draft[week][0], h.core[0].id);
  assert.equal((await h.admin({ op: 'employee.add', id: randomUUID(), token: randomBytes(32).toString('hex'), role: 'core', name: '네 번째 직원' })).status, 409);
});
test('staff only sees anonymous empty slots and cannot apply for core-covered or unopened dates', async t => {
  const h = await stagedSetup(t); await h.submitCore(); await h.open(0);
  const view = (await h.call('me?month=2026-11', undefined, h.staff.cookie)).data;
  assert.equal(view.slots[week].state, 'covered'); assert.equal(view.slots['2026-11-05'].state, 'open'); assert.equal(view.slots['2026-11-09'].state, 'waiting');
  for (const e of h.core) assert.ok(!JSON.stringify(view).includes(e.id));
  for (const dates of [[week], ['2026-11-09']]) assert.equal((await h.save(h.staff, dates)).status, 409);
  assert.equal((await h.save(h.staff, ['2026-11-05'])).status, 200);
  const other = await h.add('스태프 B'); assert.equal((await h.save(other, ['2026-11-05'])).status, 200);
  assert.deepEqual((await h.call('me?month=2026-11', undefined, h.staff.cookie)).data.confirmed, []);
  assert.deepEqual(h.state.get(`week:${week}`).draft['2026-11-05'], []);
});
test('core dates freeze while staff applications are open and closing preserves applications', async t => {
  const h = await stagedSetup(t); await h.submitCore(); await h.open(0); await h.save(h.staff, ['2026-11-05']);
  assert.equal((await h.save(h.core[0], ['2026-11-05'], 1)).status, 409);
  assert.equal((await h.admin({ op: 'employee.role', id: h.staff.id, role: 'core' })).status, 409);
  assert.equal((await h.admin({ op: 'employee.archive', id: h.core[0].id })).status, 409);
  assert.equal((await h.admin({ op: 'week.close', week, version: 0 })).status, 409);
  assert.equal((await h.admin({ op: 'week.close', week, version: 1 })).status, 200);
  assert.equal((await h.save(h.core[0], ['2026-11-05'], 1)).status, 200);
  assert.deepEqual(h.state.get(`month:${month}`)[h.staff.id].dates, ['2026-11-05']);
  assert.equal((await h.open(2)).status, 200);
  assert.equal((await h.save(h.staff, ['2026-11-05', '2026-11-06'], 1)).status, 200);
});
test('staff application requires manager assignment and explicit final publication', async t => {
  const h = await stagedSetup(t); await h.submitCore();
  assert.equal((await h.admin({ op: 'week.publish', week, version: 0 })).status, 409);
  await h.open(0); await h.save(h.staff, ['2026-11-05']);
  assert.equal((await h.admin({ op: 'week.publish', week, version: 1 })).status, 409);
  const schedule = (await h.admin()).data.schedule;
  schedule.draft['2026-11-05'] = [h.staff.id];
  for (const day of ['2026-11-06', '2026-11-07', '2026-11-08']) schedule.required[day] = 0;
  assert.equal((await h.admin({ op: 'week.save', week, version: 1, assignments: schedule.draft, required: schedule.required, start: '13:00', end: '20:00' })).status, 200);
  assert.equal((await h.call('me?month=2026-11', undefined, h.staff.cookie)).data.confirmed.length, 0);
  assert.equal((await h.admin({ op: 'week.publish', week, version: 2 })).status, 200);
  assert.equal((await h.call('me?month=2026-11', undefined, h.staff.cookie)).data.confirmed[0].date, '2026-11-05');
  assert.equal((await h.admin({ op: 'week.close', week, version: 3 })).status, 409);
});
test('core attendance stays automatic and multiple core employees can work the same day', async t => {
  const h = await stagedSetup(t); for (const e of h.core) await h.save(e);
  await h.open(0); const schedule = (await h.admin()).data.schedule;
  assert.equal(schedule.required[week], 3); assert.equal(schedule.draft[week].length, 3);
  schedule.draft[week] = [];
  assert.equal((await h.admin({ op: 'week.save', week, version: 1, assignments: schedule.draft, required: schedule.required, start: '13:00', end: '20:00' })).status, 409);
});
test('opening a week across months requires submissions for both months', async t => {
  const h = await stagedSetup(t); await h.submitCore();
  const boundary = '2026-11-30';
  assert.equal((await h.admin({ op: 'week.open', week: boundary, version: 0 })).status, 409);
  for (const e of h.core) assert.equal((await h.call('me', { op: 'availability.save', month: '2026-12', dates: [], version: 0 }, e.cookie)).status, 200);
  assert.equal((await h.admin({ op: 'week.open', week: boundary, version: 0 })).status, 200);
});

test('opening and closing the current week preserves past assignments', async t => {
  const h = await stagedSetup(t); await h.submitCore(); const currentWeek = '2026-10-26';
  h.state.set('month:2026-10', Object.fromEntries(h.core.map(e => [e.id, {dates:['2026-10-26','2026-10-30'],version:1,submittedAt:'2026-10-20T00:00:00Z',note:''}])));
  const before = (await h.call('admin?week=' + currentWeek, undefined, (await createAdminSessionCookie(h.env)).split(';')[0])).data.schedule;
  assert.deepEqual(before.draft['2026-10-26'], []);
  assert.equal((await h.admin({op:'week.open',week:currentWeek,version:0})).status,200);
  let saved = h.state.get('week:' + currentWeek);
  assert.deepEqual(saved.draft['2026-10-26'], []); assert.equal(saved.required['2026-10-26'],1);
  saved.draft['2026-10-26'] = [h.staff.id]; h.state.set('week:' + currentWeek, saved);
  assert.equal((await h.admin({op:'week.close',week:currentWeek,version:1})).status,200);
  assert.deepEqual(h.state.get('week:' + currentWeek).draft['2026-10-26'], [h.staff.id]);
});
test('approved extra core availability can be assigned manually after publication', async t => {
  const h = await stagedSetup(t); await h.submitCore(); await h.open(0);
  const schedule = (await h.admin()).data.schedule;
  for (const d of Object.keys(schedule.required)) schedule.required[d] = schedule.draft[d].length;
  assert.equal((await h.admin({op:'week.save',week,version:1,assignments:schedule.draft,required:schedule.required,start:'13:00',end:'20:00'})).status,200);
  assert.equal((await h.admin({op:'week.publish',week,version:2})).status,200);
  const id = randomUUID();
  assert.equal((await h.call('me',{op:'request.add',id,date:week,available:true,reason:'추가 근무 가능'},h.core[1].cookie)).status,200);
  assert.equal((await h.admin({op:'request.resolve',id,decision:'approved'})).status,200);
  const current = (await h.admin()).data.schedule;
  assert.deepEqual(current.draft[week],[h.core[0].id]);
  current.draft[week].push(h.core[1].id); current.required[week] = 2;
  assert.equal((await h.admin({op:'week.save',week,version:3,assignments:current.draft,required:current.required,start:'13:00',end:'20:00'})).status,200);
  assert.equal((await h.admin({op:'week.publish',week,version:4})).status,200);
  assert.equal(h.state.get('week:'+week).published.assignments[week].length,2);
});
