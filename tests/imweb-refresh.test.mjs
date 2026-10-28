import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ImwebTokenManager, default as worker } from '../workers/imweb-token-manager/index.js';
import { getStoredImwebTokens, refreshImwebToken, fetchImwebJson, getImwebTokenHealth } from '../functions/_imweb.js';
import { getTokenExpiresAt } from '../functions/_imweb-policy.js';
import { onRequestPost as publicRefresh } from '../functions/api/oauth/refresh-public.js';
import { onRequestGet as ownerRefresh } from '../functions/api/oauth/refresh.js';

const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
const oldTokens = () => ({ accessToken: 'old-access', refreshToken: 'old-refresh',
  updatedAt: new Date(Date.now() - 7200000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });

function service({ kvFailure = false } = {}) {
  const entries = new Map();
  let alarm = null;
  const storage = {
    async get(key) { return structuredClone(entries.get(key)); },
    async put(key, value) { entries.set(key, structuredClone(value)); },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; },
  };
  const kv = new Map([['imweb_tokens', JSON.stringify(oldTokens())]]);
  const env = {
    IMWEB_CLIENT_SECRET: 'test-secret',
    ATHOCE_KV: {
      async get(key, type) { const value = kv.get(key); return type === 'json' ? (value ? JSON.parse(value) : null) : value; },
      async put(key, value) { if (kvFailure) throw new Error('unavailable'); kv.set(key, value); },
    },
  };
  const manager = new ImwebTokenManager({ storage }, env);
  const call = (path, body = {}) => manager.fetch(new Request(`https://internal${path}`, { method: 'POST', body: JSON.stringify(body) }));
  const init = () => call('/initialize', { config: { clientId: 'test-client', clientSecret: 'test-secret' }, tokens: oldTokens() });
  env.IMWEB_TOKEN_MANAGER = { idFromName: (name) => name, get: () => ({ fetch: (url, input) => manager.fetch(new Request(url, input)) }) };
  return { manager, storage, env, call, init, kv };
}

function successfulRefresh() {
  return Response.json({ accessToken: 'new-access', refreshToken: 'new-refresh', expires_in: 86400, scope: 'product:read' });
}

test('20 concurrent renewals rotate once and all callers receive the same token pair', async () => {
  const s = service(); await s.init(); let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++; assert.equal(init.body.get('refreshToken'), 'old-refresh'); assert.ok(init.signal);
    return successfulRefresh();
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => refreshImwebToken(s.env, { expectedAccessToken: 'old-access' })));
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.ok && r.accessToken === 'new-access' && r.refreshToken === 'new-refresh'));
});

test('scheduled alarm refreshes with zero visitor requests and schedules another check', async () => {
  const s = service(); await s.init(); let calls = 0;
  globalThis.fetch = async () => { calls++; return successfulRefresh(); };
  await s.manager.alarm();
  assert.equal(calls, 1);
  assert.equal((await s.storage.get('state')).tokens.accessToken, 'new-access');
  assert.ok((await s.storage.get('state')).lastScheduledCheckAt);
  assert.ok(await s.storage.getAlarm() > Date.now());
});

test('restart reads the rotated pair from durable storage', async () => {
  const s = service(); await s.init(); globalThis.fetch = async () => successfulRefresh();
  await s.manager.alarm();
  const restarted = new ImwebTokenManager({ storage: s.storage }, s.env);
  const response = await restarted.fetch(new Request('https://internal/read'));
  assert.equal((await response.json()).tokens.refreshToken, 'new-refresh');
});

test('repeated initialization never replaces a newer token pair with the KV seed', async () => {
  const s = service(); await s.init(); globalThis.fetch = async () => successfulRefresh();
  await s.manager.alarm(); await s.init();
  assert.equal((await s.storage.get('state')).tokens.refreshToken, 'new-refresh');
});

test('OAuth callback storage and refresh are serialized without losing the new authorization', async () => {
  const s = service(); await s.init(); let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(successfulRefresh()); });
  const renewing = s.call('/refresh', { force: true });
  while (!release) await new Promise(setImmediate);
  const storing = s.call('/store', { tokens: { accessToken: 'authorized-access', refreshToken: 'authorized-refresh' } });
  release(); await renewing; await storing;
  assert.equal((await s.storage.get('state')).tokens.refreshToken, 'authorized-refresh');
});

test('transient failure keeps both tokens and defers concurrent retries', async () => {
  const s = service(); await s.init(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('network'); };
  const first = await refreshImwebToken(s.env, { notifyFailure: false });
  const second = await refreshImwebToken(s.env, { notifyFailure: false });
  assert.equal(first.error.code, 'REFRESH_UNAVAILABLE'); assert.equal(second.ok, false); assert.equal(calls, 1);
  const state = await s.storage.get('state');
  assert.equal(state.tokens.refreshToken, 'old-refresh'); assert.ok(Date.parse(state.retryAt) > Date.now());
  assert.ok(await s.storage.getAlarm() < Date.now() + 6 * 60000);
});

test('alarm retries successfully after the backoff window', async () => {
  const s = service(); await s.init(); globalThis.fetch = async () => { throw new TypeError(); };
  await s.manager.alarm();
  const state = await s.storage.get('state'); state.retryAt = new Date(0).toISOString(); await s.storage.put('state', state);
  globalThis.fetch = async () => successfulRefresh(); await s.manager.alarm();
  assert.equal((await s.storage.get('state')).tokens.lastRefreshError, null);
});

test('timeout and malformed responses become bounded, sanitized errors', async () => {
  for (const timeout of [true, false]) {
    const s = service(); await s.init();
    globalThis.fetch = async () => { if (timeout) throw new DOMException('secret', 'TimeoutError'); return new Response('not json'); };
    const result = await refreshImwebToken(s.env, { notifyFailure: false });
    assert.equal(result.ok, false); assert.equal(result.error.code, timeout ? 'REFRESH_TIMEOUT' : 'REFRESH_UNAVAILABLE');
    assert.ok(!JSON.stringify(result).includes('test-secret'));
  }
});

test('Imweb root errorCode is preserved without storing raw upstream response', async () => {
  const s = service(); await s.init();
  globalThis.fetch = async () => Response.json({ errorCode: 30098, message: 'secret echoed by upstream', clientSecret: 'test-secret' });
  const result = await refreshImwebToken(s.env, { notifyFailure: false });
  assert.equal(result.error.code, '30098'); assert.ok(!JSON.stringify(result).includes('secret'));
});

test('KV mirror failure cannot undo a successful durable token rotation', async () => {
  const s = service({ kvFailure: true }); await s.init(); globalThis.fetch = async () => successfulRefresh();
  const result = await refreshImwebToken(s.env);
  assert.equal(result.ok, true); assert.equal(result.storedInKv, false); assert.equal(result.storedInManager, true);
  assert.equal((await getStoredImwebTokens(s.env)).refreshToken, 'new-refresh');
});

test('Pages bootstraps the existing KV pair into an uninitialized manager', async () => {
  const s = service(); const tokens = await getStoredImwebTokens(s.env);
  assert.equal(tokens.source, 'durable-object'); assert.equal(tokens.refreshToken, 'old-refresh');
  assert.ok(tokens.scheduler.enabled); assert.ok(await s.storage.getAlarm());
});

test('manager outage never falls back to an obsolete KV refresh token', async () => {
  const s = service(); s.env.IMWEB_TOKEN_MANAGER.get = () => ({ fetch: async () => { throw new Error('down'); } });
  await assert.rejects(() => getStoredImwebTokens(s.env), /down/);
  assert.equal((await refreshImwebToken(s.env)).error.code, 'TOKEN_MANAGER_UNAVAILABLE');
});

test('preemptive refresh failure still allows an unexpired access token to load products', async () => {
  const s = service(); await s.init(); let renewals = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/oauth2/token')) { renewals++; throw new TypeError(); }
    assert.equal(init.headers.authorization, 'Bearer old-access');
    return Response.json({ data: [{ productNo: 1 }] });
  };
  const result = await fetchImwebJson(s.env, 'https://openapi.imweb.me/products');
  assert.equal(result.response.status, 200); assert.equal(renewals, 1); assert.equal(result.payload.data.length, 1);
});

test('one failed preemptive refresh does not cause a second rotation on the same 401', async () => {
  const s = service(); await s.init(); let renewals = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/token')) { renewals++; throw new TypeError(); }
    return Response.json({ errorCode: 30101 }, { status: 401 });
  };
  const result = await fetchImwebJson(s.env, 'https://openapi.imweb.me/products');
  assert.equal(result.response.status, 401); assert.equal(renewals, 1);
});

test('public retry succeeds even if Telegram delivery throws and never exposes tokens', async () => {
  const s = service(); await s.init(); s.env.TELEGRAM_BOT_TOKEN = 'test-bot'; s.env.TELEGRAM_CHAT_ID = 'test-chat';
  globalThis.fetch = async (url) => { if (String(url).includes('telegram')) throw new TypeError(); return successfulRefresh(); };
  const pending = [];
  const response = await publicRefresh({ env: s.env, request: new Request('https://athoce.kr/api/oauth/refresh-public'), waitUntil: (p) => pending.push(p) });
  const result = await response.json(); await Promise.all(pending);
  assert.equal(response.status, 200); assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result).includes('new-access')); assert.ok(!JSON.stringify(result).includes('new-refresh'));
});

test('health reports scheduling metadata without token or credential values', async () => {
  const s = service(); await s.init(); const health = await getImwebTokenHealth(s.env);
  assert.equal(health.scheduler.enabled, true); assert.ok(health.scheduler.nextCheckAt);
  assert.ok(!JSON.stringify(health).includes('old-access')); assert.ok(!JSON.stringify(health).includes('test-secret'));
});

test('initial authorization expires_in is retained with the correct units', () => {
  assert.equal(getTokenExpiresAt({ data: { expires_in: 86400 } }, 0), '1970-01-02T00:00:00.000Z');
});

test('the scheduler Worker has no public token endpoint', async () => {
  const response = await worker.fetch(new Request('https://public/read'));
  assert.equal(response.status, 404); assert.equal(await response.text(), 'Not found');
});

test('owner refresh rejects anonymous requests before accessing the token manager', async () => {
  const response = await ownerRefresh({ env: { ADMIN_PASSWORD: 'test-owner' }, request: new Request('https://athoce.kr/api/oauth/refresh') });
  assert.equal(response.status, 401);
});
