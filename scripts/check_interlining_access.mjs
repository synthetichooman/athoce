import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { isAdminAuthorized, createAdminSessionCookie } from '../functions/_config.js';
import { interliningAccess, createInterliningViewerCookie } from '../functions/_interlining-access.js';
import { onRequestPost as login } from '../functions/api/interlining/login.js';
import { onRequestGet as session } from '../functions/api/interlining/session.js';
import { onRequestPost as logout } from '../functions/api/interlining/logout.js';
import { onRequestGet as submissions } from '../functions/api/interlining/submissions.js';
import { onRequestGet as config } from '../functions/api/admin/config.js';
import { onRequestGet as rentalKeys } from '../functions/api/admin/rental-keys.js';
import { onRequestPost as generalLogin } from '../functions/api/admin/login.js';

const viewerPassword = 'test-only-viewer-password';
const env = { ADMIN_PASSWORD: 'test-only-owner', INTERLINING_VIEWER_PASSWORD_SHA256: createHash('sha256').update(viewerPassword).digest('hex') };
const req = (cookie = '', body) => new Request('https://athoce.kr/api/interlining/login', { headers: { cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
const cookieValue = (cookie) => cookie.split(';')[0];

test('viewer login grants only scoped interlining access and clears an old owner session', async () => {
  const response = await login({ env, request: req(cookieValue(await createAdminSessionCookie(env)), { password: viewerPassword }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access, 'viewer');
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.find((value) => value.startsWith('athoce_interlining_session='));
  assert.match(cookie, /Path=\/api\/interlining; HttpOnly; Secure; SameSite=Lax/);
  assert.ok(cookies.some((value) => /athoce_admin_session=;.*Max-Age=0/.test(value)));
  const request = req(cookieValue(cookie));
  assert.equal(await interliningAccess(request, env), 'viewer');
  assert.equal(await isAdminAuthorized(request, env), false);
  assert.equal((await (await session({ env, request })).json()).access, 'viewer');
  for (const handler of [config, rentalKeys]) assert.equal((await handler({ env, request })).status, 401);
  assert.equal((await generalLogin({ env, request: req('', { password: viewerPassword }) })).status, 401);
});

test('viewer cannot gain owner access by renaming the signed cookie', async () => {
  const cookie = cookieValue(await createInterliningViewerCookie(env)).replace('athoce_interlining_session=', 'athoce_admin_session=');
  assert.equal(await isAdminAuthorized(req(cookie), env), false);
  assert.equal(await interliningAccess(req(cookie), env), null);
});

test('owner login retains general admin access and clears the viewer cookie', async () => {
  const response = await login({ env, request: req('', { password: env.ADMIN_PASSWORD }) });
  assert.equal((await response.json()).access, 'owner');
  const cookies = response.headers.getSetCookie();
  const ownerCookie = cookies.find((value) => value.startsWith('athoce_admin_session='));
  assert.equal(await isAdminAuthorized(req(cookieValue(ownerCookie)), env), true);
  assert.ok(cookies.some((value) => /athoce_interlining_session=;.*Max-Age=0/.test(value)));
});

test('viewer sessions reject tampering, expiration and password rotation', async (t) => {
  const cookie = cookieValue(await createInterliningViewerCookie(env));
  assert.equal(await interliningAccess(req(`${cookie}x`), env), null);
  assert.equal(await interliningAccess(req(cookie), { ...env, INTERLINING_VIEWER_PASSWORD_SHA256: '0'.repeat(64) }), null);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 86401000);
  assert.equal(await interliningAccess(req(cookie), env), null);
});

test('viewer can retrieve the local submissions without any external request', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected external request'); });
  const localEnv = { ...env, ATHOCE_KV: { list: async ({ prefix }) => {
    assert.equal(prefix, 'interlining:submission:');
    return { keys: [], list_complete: true };
  } } };
  const request = req(cookieValue(await createInterliningViewerCookie(env)));
  const response = await submissions({ env: localEnv, request });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.totalCount, 0);
});

test('invalid passwords are limited and successful logins reset attempts', async () => {
  const data = new Map();
  const limitedEnv = { ...env, ATHOCE_KV: { get: async (key) => data.get(key), put: async (key, value) => data.set(key, JSON.parse(value)), delete: async (key) => data.delete(key) } };
  for (let i = 0; i < 8; i++) assert.equal((await login({ env: limitedEnv, request: req('', { password: 'wrong' }) })).status, 401);
  assert.equal((await login({ env: limitedEnv, request: req('', { password: viewerPassword }) })).status, 429);
  data.clear();
  await login({ env: limitedEnv, request: req('', { password: 'wrong' }) });
  assert.equal((await login({ env: limitedEnv, request: req('', { password: viewerPassword }) })).status, 200);
  assert.equal(data.size, 0);
});

test('logout clears both scoped and owner cookies', () => {
  const cookies = logout().headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((value) => value.includes('Max-Age=0')));
});
