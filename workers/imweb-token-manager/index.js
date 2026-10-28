import {
  getTokenExpiresAt, shouldRefreshBeforeRequest, TOKEN_CHECK_INTERVAL_MS,
  TOKEN_REQUEST_TIMEOUT_MS,
} from '../../functions/_imweb-policy.js';

const STATE_KEY = 'state';
const RETRY_DELAY_MS = 5 * 60 * 1000;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// This class is reachable only through a Cloudflare binding. The Worker exposes no HTTP API.
export class ImwebTokenManager {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = Promise.resolve();
  }

  serialize(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  fetch(request) {
    return this.serialize(async () => {
      const command = new URL(request.url).pathname;
      const input = request.method === 'POST' ? await request.json() : {};
      let state = await this.ctx.storage.get(STATE_KEY);
      if (!state) {
        if (command !== '/initialize') return json({ ok: false, error: { code: 'NOT_INITIALIZED' } }, 428);
        state = { config: input.config, tokens: input.tokens || {}, lastCheckedAt: '' };
        if (!state.config?.clientSecret) return json({ ok: false, error: { code: 'MISSING_REFRESH_CONFIG' } }, 400);
        await this.ctx.storage.put(STATE_KEY, state);
        await this.ctx.storage.setAlarm(Date.now() + 60000);
      }
      // Environment credential changes are adopted without replacing a newer token pair.
      if (input.config?.clientSecret && JSON.stringify(input.config) !== JSON.stringify(state.config)) {
        state.config = input.config;
        await this.ctx.storage.put(STATE_KEY, state);
      }
      await this.ensureAlarm();
      if (command === '/initialize' || command === '/read') {
        state.nextCheckAt = new Date(await this.ctx.storage.getAlarm()).toISOString();
        return json({ ok: true, ...this.readState(state) });
      }
      if (command === '/store') {
        state.tokens = {
          ...state.tokens, ...input.tokens, updatedAt: new Date().toISOString(),
          lastRefreshFailedAt: '', lastRefreshError: null,
        };
        state.retryAt = '';
        await this.ctx.storage.put(STATE_KEY, state);
        const storedInKv = await this.mirror(state);
        return json({ ok: true, storedInKv, storedInManager: true });
      }
      if (command === '/refresh' || command === '/maintain') {
        return json(await this.refresh(state, { ...input, force: command === '/refresh' && input.force }));
      }
      return json({ ok: false }, 404);
    });
  }

  readState(state) {
    return {
      tokens: { ...state.tokens, source: 'durable-object' },
      scheduler: {
        enabled: true, lastCheckedAt: state.lastCheckedAt || '',
        lastScheduledCheckAt: state.lastScheduledCheckAt || '',
        nextCheckAt: state.nextCheckAt || '', retryAt: state.retryAt || '',
        lastMirrorErrorAt: state.lastMirrorErrorAt || '',
      },
    };
  }

  async ensureAlarm() {
    if (!(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm(Date.now() + TOKEN_CHECK_INTERVAL_MS);
    }
  }

  async mirror(state) {
    if (!this.env.ATHOCE_KV) return false;
    try {
      await this.env.ATHOCE_KV.put('imweb_tokens', JSON.stringify(state.tokens));
      return true;
    } catch {
      state.lastMirrorErrorAt = new Date().toISOString();
      await this.ctx.storage.put(STATE_KEY, state);
      return false;
    }
  }

  async refresh(state, input = {}) {
    const now = Date.now();
    state.lastCheckedAt = new Date(now).toISOString();
    if (input.scheduled) state.lastScheduledCheckAt = state.lastCheckedAt;
    state.nextCheckAt = new Date(now + TOKEN_CHECK_INTERVAL_MS).toISOString();
    const tokens = state.tokens;
    const changed = input.expectedAccessToken && input.expectedAccessToken !== tokens.accessToken;
    const recentlyRefreshed = tokens.accessToken && now - Date.parse(tokens.updatedAt || '') < 60000;
    if (changed || recentlyRefreshed || (tokens.refreshToken && !input.force && !shouldRefreshBeforeRequest(tokens, now))) {
      await this.ctx.storage.put(STATE_KEY, state);
      return { ok: true, ...tokens, storedInManager: true, reusedConcurrentRefresh: true };
    }
    if (Date.parse(state.retryAt || '') > now) {
      await this.ctx.storage.put(STATE_KEY, state);
      return { ok: false, error: tokens.lastRefreshError, retryAt: state.retryAt };
    }
    let error;
    let rotated;
    if (!state.config?.clientSecret || !tokens.refreshToken) {
      error = { code: 'MISSING_REFRESH_CONFIG', message: '아임웹 연결 설정 또는 refresh token이 없습니다.' };
    } else {
      try {
        const body = new URLSearchParams({
          clientId: state.config.clientId, clientSecret: state.config.clientSecret,
          refreshToken: tokens.refreshToken, grantType: 'refresh_token',
        });
        const response = await fetch('https://openapi.imweb.me/oauth2/token', {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body, signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
        });
        const payload = await response.json();
        const data = payload.data || payload;
        if (response.ok && data.accessToken) {
          rotated = {
            accessToken: data.accessToken, refreshToken: data.refreshToken || tokens.refreshToken,
            scope: data.scope || tokens.scope || '', expiresAt: getTokenExpiresAt(payload),
            updatedAt: new Date().toISOString(), lastRefreshFailedAt: '', lastRefreshError: null,
          };
        } else {
          const upstream = payload.error || payload;
          error = {
            code: String(upstream.errorCode || upstream.code || upstream.statusCode || response.status),
            // Do not store arbitrary upstream bodies, which may contain credentials.
            message: '아임웹 토큰 갱신이 거절되었습니다. 연결 상태를 확인해주세요.',
          };
        }
      } catch (cause) {
        error = {
          code: cause?.name === 'TimeoutError' ? 'REFRESH_TIMEOUT' : 'REFRESH_UNAVAILABLE',
          message: '아임웹 갱신 서버에 연결하지 못했습니다. 자동으로 다시 시도합니다.',
        };
      }
    }
    if (rotated) {
      state.tokens = rotated;
      state.retryAt = '';
      // Storage errors must propagate, never overwrite a rotated pair with the old pair.
      await this.ctx.storage.put(STATE_KEY, state);
      const storedInKv = await this.mirror(state);
      return { ok: true, ...state.tokens, storedInManager: true, storedInKv };
    }
    state.tokens = { ...tokens, lastRefreshFailedAt: new Date().toISOString(), lastRefreshError: error };
    state.retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    state.nextCheckAt = state.retryAt;
    await this.ctx.storage.put(STATE_KEY, state);
    await this.ctx.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
    return { ok: false, error, retryAt: state.retryAt };
  }

  alarm() {
    return this.serialize(async () => {
      const state = await this.ctx.storage.get(STATE_KEY);
      if (!state) return;
      // Arm the next check before the network request so a temporary failure never stops scheduling.
      await this.ctx.storage.setAlarm(Date.now() + TOKEN_CHECK_INTERVAL_MS);
      const result = await this.refresh(state, { scheduled: true });
      console.info('Imweb automatic check', { source: 'alarm', ok: result.ok, rotated: result.ok && !result.reusedConcurrentRefresh });
      if (!result.ok) console.warn('Imweb scheduled refresh failed', result.error?.code);
    });
  }
}

export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env) {
    const stub = env.IMWEB_TOKEN_MANAGER.get(env.IMWEB_TOKEN_MANAGER.idFromName('athoce-imweb'));
    const response = await stub.fetch('https://token.internal/maintain', { method: 'POST', body: '{"scheduled":true}' });
    if (response.status === 428) return; // Pages seeds the existing token pair after the binding is deployed.
    const result = await response.json();
    console.info('Imweb automatic check', { source: 'cron', ok: result.ok, rotated: result.ok && !result.reusedConcurrentRefresh });
    if (!result.ok) console.warn('Imweb cron refresh failed', result.error?.code);
  },
};
