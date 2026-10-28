import { sendThrottledTelegramAlert } from './_telegram.js';
import {
  getTokenExpiresAt, shouldRefreshBeforeRequest, TOKEN_REFRESH_INTERVAL_SECONDS,
  TOKEN_REQUEST_TIMEOUT_MS,
} from './_imweb-policy.js';
export { getTokenExpiresAt } from './_imweb-policy.js';

export const DEFAULT_CLIENT_ID = '41b37086-2076-4edd-ade4-b447c22544ea';
export const DEFAULT_UNIT_CODE = 'u20251229236e9cd97a160';
export const TOKEN_STORAGE_KEY = 'imweb_tokens';
const TOKEN_REFRESH_LOCK_KEY = 'imweb_refresh_lock';
const TOKEN_REFRESH_LOCK_SECONDS = 60;

export function clean(value, fallback = '') {
  return String(value || fallback).trim();
}

function getAuthErrorCode(payload) {
  return String(
    payload?.error?.errorCode ||
      payload?.error?.code ||
      payload?.errorCode ||
      payload?.code ||
      payload?.statusCode ||
      '',
  );
}

export function isAuthTokenError(payload, response) {
  const code = getAuthErrorCode(payload);
  return response?.status === 401 || code === '30101' || code === '30102';
}

export async function parseJsonResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

async function getLegacyTokens(env) {
  let stored = null;

  if (env.ATHOCE_KV) {
    stored = await env.ATHOCE_KV.get(TOKEN_STORAGE_KEY, 'json');
  }

  return {
    accessToken: clean(stored?.accessToken ? stored.accessToken : env.IMWEB_ACCESS_TOKEN),
    refreshToken: clean(stored?.accessToken ? stored.refreshToken : env.IMWEB_REFRESH_TOKEN),
    scope: stored?.scope || '',
    updatedAt: stored?.updatedAt || '',
    expiresAt: stored?.expiresAt || '',
    lastRefreshFailedAt: stored?.lastRefreshFailedAt || '',
    lastRefreshError: stored?.lastRefreshError || null,
    source: stored?.accessToken ? 'kv' : 'env',
  };
}

async function tokenManagerRequest(env, path, input = {}) {
  const namespace = env.IMWEB_TOKEN_MANAGER;
  const stub = namespace.get(namespace.idFromName('athoce-imweb'));
  const config = {
    clientId: clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID),
    clientSecret: clean(env.IMWEB_CLIENT_SECRET),
  };
  const call = (route, body) => stub.fetch(`https://token.internal${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, config }),
  });
  let response = await call(path, input);
  if (response.status === 428) {
    const seeded = await call('/initialize', { tokens: await getLegacyTokens(env) });
    if (!seeded.ok) throw new Error('Imweb token manager initialization failed');
    response = await call(path, input);
  }
  if (!response.ok) throw new Error('Imweb token manager unavailable');
  return response.json();
}

export async function getStoredImwebTokens(env) {
  if (env.IMWEB_TOKEN_MANAGER) {
    // Never fall back to a stale KV refresh token after the manager becomes authoritative.
    const state = await tokenManagerRequest(env, '/read');
    return { ...state.tokens, scheduler: state.scheduler };
  }
  return getLegacyTokens(env);
}

function sanitizeRefreshError(error = {}) {
  return {
    code: String(error?.code || error?.errorCode || error?.statusCode || 'REFRESH_FAILED'),
    message: String(error?.message || 'Imweb accessToken 재발급에 실패했습니다.').slice(0, 240),
  };
}

async function recordRefreshFailure(env, error, options = {}) {
  const shouldNotify = options.notify !== false;
  const sanitizedError = sanitizeRefreshError(error);
  const failedAt = new Date().toISOString();

  if (!env.ATHOCE_KV) {
    if (shouldNotify) {
      await notifyRefreshFailure(env, sanitizedError, failedAt);
    }
    return false;
  }

  const current = (await env.ATHOCE_KV.get(TOKEN_STORAGE_KEY, 'json')) || {};

  await env.ATHOCE_KV.put(
    TOKEN_STORAGE_KEY,
    JSON.stringify({
      ...current,
      lastRefreshFailedAt: failedAt,
      lastRefreshError: sanitizedError,
    }),
  );

  if (shouldNotify) {
    await notifyRefreshFailure(env, sanitizedError, failedAt);
  }

  return true;
}

async function notifyRefreshFailure(env, error, failedAt) {
  try {
    await sendThrottledTelegramAlert(
      env,
      `imweb_refresh:${error.code}`,
      [
        '[athoce] imweb token refresh failed',
        `time: ${failedAt}`,
        `code: ${error.code}`,
        `message: ${error.message}`,
        '',
        'admin: https://athoce.kr/admin.html',
        'reauthorize: https://athoce.kr/api/oauth/start',
      ].join('\n'),
    );
  } catch {
    // Alert delivery must never break product loading or token recovery flows.
  }
}

async function reuseUpdatedTokensAfterRefreshRace(env, previousTokens) {
  if (!env.ATHOCE_KV) {
    return null;
  }

  const latestTokens = await getStoredImwebTokens(env);
  const tokenChanged =
    latestTokens.updatedAt &&
    latestTokens.updatedAt !== previousTokens.updatedAt &&
    latestTokens.accessToken &&
    latestTokens.refreshToken;

  if (!tokenChanged) {
    return null;
  }

  return {
    ok: true,
    accessToken: latestTokens.accessToken,
    refreshToken: latestTokens.refreshToken,
    scope: latestTokens.scope,
    expiresAt: latestTokens.expiresAt,
    storedInKv: true,
    reusedConcurrentRefresh: true,
  };
}

async function acquireRefreshLock(env) {
  if (!env.ATHOCE_KV) {
    return '';
  }

  const existingLock = await env.ATHOCE_KV.get(TOKEN_REFRESH_LOCK_KEY);

  if (existingLock) {
    return '';
  }

  const lockValue = crypto.randomUUID();
  await env.ATHOCE_KV.put(TOKEN_REFRESH_LOCK_KEY, lockValue, {
    expirationTtl: TOKEN_REFRESH_LOCK_SECONDS,
  });

  return lockValue;
}

async function releaseRefreshLock(env, lockValue) {
  if (!env.ATHOCE_KV || !lockValue) {
    return;
  }

  const currentLock = await env.ATHOCE_KV.get(TOKEN_REFRESH_LOCK_KEY);

  if (currentLock === lockValue) {
    await env.ATHOCE_KV.delete(TOKEN_REFRESH_LOCK_KEY);
  }
}

export async function storeImwebTokens(env, tokens) {
  if (env.IMWEB_TOKEN_MANAGER) {
    const result = await tokenManagerRequest(env, '/store', { tokens });
    return result.ok && result.storedInManager;
  }
  if (!env.ATHOCE_KV) {
    return false;
  }

  const current = (await env.ATHOCE_KV.get(TOKEN_STORAGE_KEY, 'json')) || {};
  const hasExpiresAt = Object.prototype.hasOwnProperty.call(tokens, 'expiresAt');
  const next = {
    ...current,
    accessToken: clean(tokens.accessToken, current.accessToken),
    refreshToken: clean(tokens.refreshToken, current.refreshToken),
    scope: tokens.scope || current.scope || '',
    expiresAt: hasExpiresAt ? tokens.expiresAt || '' : current.expiresAt || '',
    updatedAt: new Date().toISOString(),
    lastRefreshFailedAt: '',
    lastRefreshError: null,
  };

  await env.ATHOCE_KV.put(TOKEN_STORAGE_KEY, JSON.stringify(next));
  return true;
}

export async function refreshImwebToken(env, options = {}) {
  if (env.IMWEB_TOKEN_MANAGER) {
    try {
      const result = await tokenManagerRequest(env, '/refresh', {
        force: options.force !== false,
        expectedAccessToken: options.expectedAccessToken,
      });
      if (!result.ok && options.notifyFailure !== false) {
        await notifyRefreshFailure(env, result.error || {}, new Date().toISOString());
      }
      return result;
    } catch {
      return { ok: false, error: { code: 'TOKEN_MANAGER_UNAVAILABLE', message: '연결 복구 중입니다. 잠시 후 다시 시도해주세요.' } };
    }
  }
  const shouldNotifyFailure = options.notifyFailure !== false;
  const clientId = clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID);
  const clientSecret = clean(env.IMWEB_CLIENT_SECRET);
  const storedTokens = await getStoredImwebTokens(env);
  const refreshToken = storedTokens.refreshToken;
  const lockValue = await acquireRefreshLock(env);

  if (env.ATHOCE_KV && !lockValue) {
    const reusedTokens = await reuseUpdatedTokensAfterRefreshRace(env, storedTokens);

    if (reusedTokens) {
      return reusedTokens;
    }

    return {
      ok: false,
      error: {
        code: 'REFRESH_IN_PROGRESS',
        message: '다른 요청이 Imweb 토큰을 갱신하는 중입니다.',
      },
    };
  }

  if (!clientSecret || !refreshToken) {
    const error = {
      code: 'MISSING_REFRESH_CONFIG',
      message: 'IMWEB_CLIENT_SECRET 또는 IMWEB_REFRESH_TOKEN 환경변수가 없습니다.',
    };
    await recordRefreshFailure(env, error, { notify: shouldNotifyFailure });
    await releaseRefreshLock(env, lockValue);

    return {
      ok: false,
      error,
    };
  }

  const form = new URLSearchParams();
  form.set('clientId', clientId);
  form.set('clientSecret', clientSecret);
  form.set('refreshToken', refreshToken);
  form.set('grantType', 'refresh_token');

  try {
    const response = await fetch('https://openapi.imweb.me/oauth2/token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    const payload = await parseJsonResponse(response);
    const accessToken = payload?.data?.accessToken || payload?.accessToken;

    if (!response.ok || !accessToken) {
      const reusedTokens = await reuseUpdatedTokensAfterRefreshRace(env, storedTokens);

      if (reusedTokens) {
        return reusedTokens;
      }

      const error = payload?.error || {
        code: payload?.errorCode || payload?.code || payload?.statusCode || response.status,
        message: payload?.message || 'Imweb accessToken 재발급에 실패했습니다.',
      };
      await recordRefreshFailure(env, error, { notify: shouldNotifyFailure });

      return {
        ok: false,
        error,
        payload,
      };
    }

    const nextTokens = {
      ok: true,
      accessToken,
      refreshToken: payload?.data?.refreshToken || payload?.refreshToken || refreshToken,
      scope: payload?.data?.scope || payload?.scope,
      expiresAt: getTokenExpiresAt(payload),
    };

    nextTokens.storedInKv = await storeImwebTokens(env, nextTokens);

    return nextTokens;
  } catch (cause) {
    const error = {
      code: cause?.name === 'TimeoutError' ? 'REFRESH_TIMEOUT' : 'REFRESH_UNAVAILABLE',
      message: '아임웹 갱신 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
    };
    await recordRefreshFailure(env, error, { notify: shouldNotifyFailure });
    return { ok: false, error };
  } finally {
    await releaseRefreshLock(env, lockValue).catch(() => {});
  }
}

export async function fetchImwebJson(env, url, init = {}) {
  let storedTokens = await getStoredImwebTokens(env);
  let accessToken = storedTokens.accessToken;
  let preemptiveRefresh = null;

  if (shouldRefreshBeforeRequest(storedTokens)) {
    preemptiveRefresh = await refreshImwebToken(env, { notifyFailure: false, force: false });

    if (preemptiveRefresh.ok) {
      storedTokens = await getStoredImwebTokens(env);
      accessToken = preemptiveRefresh.accessToken;
    }
  }

  if (!accessToken) {
    return {
      response: new Response(null, { status: 500 }),
      payload: {
        error: {
          code: 'MISSING_IMWEB_ACCESS_TOKEN',
          message: 'Cloudflare Pages 환경 변수 IMWEB_ACCESS_TOKEN이 설정되지 않았습니다.',
        },
      },
      tokenRefreshed: false,
      tokenPreemptivelyRefreshed: false,
      tokenSource: storedTokens.source,
      refreshError: preemptiveRefresh?.error,
    };
  }

  const headers = {
    accept: 'application/json',
    ...(init.headers || {}),
    authorization: `Bearer ${accessToken}`,
  };
  let response = await fetch(url, { ...init, headers });
  let payload = await parseJsonResponse(response);

  if (!isAuthTokenError(payload, response)) {
    return {
      response,
      payload,
      tokenRefreshed: Boolean(preemptiveRefresh?.ok),
      tokenPreemptivelyRefreshed: Boolean(preemptiveRefresh?.ok),
      tokenSource: preemptiveRefresh?.ok ? 'refresh' : storedTokens.source,
      refreshed: preemptiveRefresh?.ok ? preemptiveRefresh : undefined,
      refreshError: preemptiveRefresh?.error,
    };
  }

  const refreshed = preemptiveRefresh?.ok === false ? preemptiveRefresh :
    await refreshImwebToken(env, { expectedAccessToken: accessToken });

  if (!refreshed.ok) {
    return {
      response,
      payload,
      tokenRefreshed: false,
      tokenPreemptivelyRefreshed: false,
      tokenSource: storedTokens.source,
      refreshError: refreshed.error,
    };
  }

  response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      authorization: `Bearer ${refreshed.accessToken}`,
    },
  });
  payload = await parseJsonResponse(response);

  return {
    response,
    payload,
    tokenRefreshed: true,
    tokenPreemptivelyRefreshed: false,
    tokenSource: 'refresh',
    refreshed,
  };
}

export async function getImwebTokenHealth(env) {
  const storedTokens = await getStoredImwebTokens(env);
  const expiresAtTime = storedTokens.expiresAt ? new Date(storedTokens.expiresAt).getTime() : 0;
  const updatedAtTime = storedTokens.updatedAt ? new Date(storedTokens.updatedAt).getTime() : 0;
  const expiresInSeconds = storedTokens.expiresAt && Number.isFinite(expiresAtTime)
    ? Math.floor((expiresAtTime - Date.now()) / 1000)
    : null;
  const refreshedAgoSeconds = storedTokens.updatedAt && Number.isFinite(updatedAtTime)
    ? Math.floor((Date.now() - updatedAtTime) / 1000)
    : null;

  return {
    kvConfigured: Boolean(env.ATHOCE_KV),
    clientSecretConfigured: Boolean(clean(env.IMWEB_CLIENT_SECRET)),
    hasAccessToken: Boolean(storedTokens.accessToken),
    hasRefreshToken: Boolean(storedTokens.refreshToken),
    tokenSource: storedTokens.source,
    updatedAt: storedTokens.updatedAt,
    refreshedAgoSeconds,
    refreshIntervalSeconds: TOKEN_REFRESH_INTERVAL_SECONDS,
    expiresAt: storedTokens.expiresAt,
    expiresInSeconds,
    refreshRecommended: shouldRefreshBeforeRequest(storedTokens),
    lastRefreshFailedAt: storedTokens.lastRefreshFailedAt,
    lastRefreshError: storedTokens.lastRefreshError,
    scheduler: storedTokens.scheduler || { enabled: false },
  };
}
