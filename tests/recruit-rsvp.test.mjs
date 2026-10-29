import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { RecruitRsvp } from '../workers/recruit-rsvp/index.js';
import { EVENT, SLOTS, validateBooking } from '../functions/_recruit-rsvp.js';
import { onRequestGet as availability, onRequestPost as submit } from '../functions/api/recruit/rsvp.js';
import { onRequestGet as list, onRequestDelete as cancel } from '../functions/api/recruit/rsvp/submissions.js';
import { createRecruitViewerCookie } from '../functions/_recruit-access.js';
import { createAdminSessionCookie } from '../functions/_config.js';

function setup(t) {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-29T12:00:00+09:00'));
  const state = new Map();
  const storage = {
    get: async key => structuredClone(state.get(key)),
    put: async (key, value) => { await new Promise(resolve => setTimeout(resolve, 1)); state.set(key, structuredClone(value)); },
    transaction: async callback => callback(storage),
  };
  const object = new RecruitRsvp({ storage });
  const env = { ADMIN_PASSWORD: 'test-only', RECRUIT_RSVP: { idFromName: name => { assert.equal(name, EVENT.id); return name; }, get: () => ({ fetch: (url, options) => object.fetch(new Request(url, options)) }) } };
  return { env, state, object };
}
const fields = (overrides = {}) => ({ fullName: '테스트 지원자', phone: '010-1234-5678', slot: '13:00', submissionId: randomUUID(), ...overrides });
function request(body, path = '/api/recruit/rsvp', headers = {}, method = 'POST') {
  return new Request(`https://athoce.kr${path}`, { method, headers: { origin: 'https://athoce.kr', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const get = (cookie = '') => new Request('https://athoce.kr/api/recruit/rsvp/submissions', { headers: { cookie } });
const cookie = value => value.split(';')[0];

test('Friday has exactly 14 half-hour slots ending at 20:00 Korean time', () => {
  assert.equal(EVENT.date, '2026-10-30'); assert.equal(SLOTS.length, 14);
  assert.deepEqual([SLOTS[0].time, SLOTS.at(-1).time, SLOTS.at(-1).end], ['13:00', '19:30', '20:00']);
  for (let i = 1; i < SLOTS.length; i++) assert.equal(Date.parse(SLOTS[i].startsAt) - Date.parse(SLOTS[i - 1].startsAt), 1800000);
});
test('rejects invalid time, name, phone, identifier and honeypot without storage access', async () => {
  for (const override of [{ slot: '20:00' }, { fullName: ' ' }, { fullName: 'a\n' + 'b' }, { phone: '+1test1234' }, { phone: '1234567890' }, { submissionId: 'not-a-uuid' }, { website: 'bot' }]) {
    assert.equal(validateBooking(fields(override)), null);
    assert.equal((await submit({ env: {}, request: request(fields(override)) })).status, 400);
  }
});
test('booking normalizes phone and public availability never exposes personal information', async t => {
  const { env } = setup(t);
  const body = fields();
  assert.equal((await submit({ env, request: request(body) })).status, 200);
  const result = await availability({ env }); const text = await result.text();
  for (const sensitive of [body.fullName, '01012345678', body.submissionId, 'submittedAt']) assert.ok(!text.includes(sensitive));
  assert.equal(JSON.parse(text).slots.find(slot => slot.time === '13:00').available, false);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
test('twenty simultaneous bookings for one time produce exactly one success', async t => {
  const { env, state } = setup(t);
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => submit({ env, request: request(fields({ phone: `0101000${String(i).padStart(4, '0')}` })) })));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 19);
  assert.equal(state.get('reservations').length, 1);
});
test('retry after an uncertain response is idempotent, even after the interview starts', async t => {
  const { env, state } = setup(t); const body = fields();
  const first = await (await submit({ env, request: request(body) })).json();
  t.mock.method(Date, 'now', () => Date.parse('2026-10-30T13:10:00+09:00'));
  const second = await (await submit({ env, request: request(body) })).json();
  assert.equal(second.reservation.code, first.reservation.code); assert.equal(state.get('reservations').length, 1);
  assert.equal((await submit({ env, request: request({ ...body, slot: '14:00' }) })).status, 409);
});
test('same phone cannot reserve a second slot, including simultaneous requests', async t => {
  const { env, state } = setup(t);
  const responses = await Promise.all(['13:00', '13:30'].map(slot => submit({ env, request: request(fields({ slot })) })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(state.get('reservations').length, 1);
});
test('past time is unavailable and cannot be booked using a stale page', async t => {
  const { env } = setup(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-10-30T13:00:00+09:00'));
  const result = await (await availability({ env })).json();
  assert.equal(result.slots[0].available, false); assert.equal(result.slots[1].available, true);
  assert.equal((await submit({ env, request: request(fields()) })).status, 409);
});
test('all fourteen slots can fill and then show no availability', async t => {
  const { env } = setup(t);
  const results = await Promise.all(SLOTS.map((slot, i) => submit({ env, request: request(fields({ slot: slot.time, phone: `0101234${String(i).padStart(4, '0')}` })) })));
  assert.ok(results.every(result => result.status === 200));
  assert.ok((await (await availability({ env })).json()).slots.every(slot => !slot.available));
});
test('reservation names and phones require recruitment viewer or owner session', async t => {
  const { env } = setup(t);
  assert.equal((await list({ env, request: get() })).status, 401);
  for (const value of [await createRecruitViewerCookie(env), await createAdminSessionCookie(env)]) assert.equal((await list({ env, request: get(cookie(value)) })).status, 200);
});
test('authenticated cancellation removes personal data and reopens only that slot', async t => {
  const { env, state } = setup(t); const body = fields();
  await submit({ env, request: request(body) });
  const path = '/api/recruit/rsvp/submissions';
  const headers = { cookie: cookie(await createRecruitViewerCookie(env)) };
  assert.equal((await cancel({ env, request: request({ id: body.submissionId }, path, {}, 'DELETE') })).status, 401);
  assert.equal((await cancel({ env, request: request({ id: body.submissionId }, path, { ...headers, origin: 'https://evil.example' }, 'DELETE') })).status, 403);
  assert.equal((await cancel({ env, request: request({ id: body.submissionId }, path, headers, 'DELETE') })).status, 200);
  assert.equal(state.get('reservations').length, 0);
  assert.equal((await (await availability({ env })).json()).slots[0].available, true);
});
test('cross-origin and malformed requests fail without touching storage', async () => {
  assert.equal((await submit({ env: {}, request: request(fields(), undefined, { origin: 'https://evil.example' }) })).status, 403);
  assert.equal((await submit({ env: {}, request: request(fields(), undefined, { 'content-type': 'text/plain' }) })).status, 415);
  assert.equal((await submit({ env: {}, request: new Request('https://athoce.kr/api/recruit/rsvp', { method: 'POST', headers: { origin: 'https://athoce.kr', 'content-type': 'application/json' }, body: '{bad' }) })).status, 400);
});
test('missing or failed binding fails closed and cannot claim a successful booking', async () => {
  assert.equal((await availability({ env: {} })).status, 503);
  assert.equal((await submit({ env: {}, request: request(fields()) })).status, 503);
  const env = { RECRUIT_RSVP: { idFromName: () => 'id', get: () => { throw new Error('outage'); } } };
  assert.equal((await availability({ env })).status, 503);
});
