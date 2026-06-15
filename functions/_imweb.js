import { sendThrottledTelegramAlert } from './_telegram.js';

export const DEFAULT_CLIENT_ID = '41b37086-2076-4edd-ade4-b447c22544ea';
export const DEFAULT_UNIT_CODE = 'u20251229236e9cd97a160';
export const TOKEN_STORAGE_KEY = 'imweb_tokens';
const TOKEN_REFRESH_BUFFER_SECONDS = 60 * 10;

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

export async function getStoredImwebTokens(env) {
  let stored = null;

  if (env.ATHOCE_KV) {
    stored = await env.ATHOCE_KV.get(TOKEN_STORAGE_KEY, 'json');
  }

  return {
    accessToken: clean(stored?.accessToken || env.IMWEB_ACCESS_TOKEN),
    refreshToken: clean(stored?.refreshToken || env.IMWEB_REFRESH_TOKEN),
    scope: stored?.scope || '',
    updatedAt: stored?.updatedAt || '',
    expiresAt: stored?.expiresAt || '',
    lastRefreshFailedAt: stored?.lastRefreshFailedAt || '',
    lastRefreshError: stored?.lastRefreshError || null,
    source: stored?.accessToken ? 'kv' : 'env',
  };
}

function sanitizeRefreshError(error = {}) {
  return {
    code: String(error?.code || error?.errorCode || error?.statusCode || 'REFRESH_FAILED'),
    message: String(error?.message || 'Imweb accessToken 재발급에 실패했습니다.').slice(0, 240),
  };
}

function getTokenExpiresAt(payload) {
  const expiresIn = Number(
    payload?.data?.expiresIn ||
      payload?.data?.expires_in ||
      payload?.expiresIn ||
      payload?.expires_in ||
      0,
  );

  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return '';
  }

  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function shouldRefreshBeforeRequest(storedTokens) {
  if (!storedTokens.refreshToken || !storedTokens.expiresAt) {
    return false;
  }

  const expiresAt = new Date(storedTokens.expiresAt).getTime();

  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt - Date.now() <= TOKEN_REFRESH_BUFFER_SECONDS * 1000;
}

async function recordRefreshFailure(env, error) {
  const sanitizedError = sanitizeRefreshError(error);
  const failedAt = new Date().toISOString();

  if (!env.ATHOCE_KV) {
    await notifyRefreshFailure(env, sanitizedError, failedAt);
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

  await notifyRefreshFailure(env, sanitizedError, failedAt);

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

export async function storeImwebTokens(env, tokens) {
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

export async function refreshImwebToken(env) {
  const clientId = clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID);
  const clientSecret = clean(env.IMWEB_CLIENT_SECRET);
  const storedTokens = await getStoredImwebTokens(env);
  const refreshToken = storedTokens.refreshToken;

  if (!clientSecret || !refreshToken) {
    const error = {
      code: 'MISSING_REFRESH_CONFIG',
      message: 'IMWEB_CLIENT_SECRET 또는 IMWEB_REFRESH_TOKEN 환경변수가 없습니다.',
    };
    await recordRefreshFailure(env, error);

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

  const response = await fetch('https://openapi.imweb.me/oauth2/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const payload = await parseJsonResponse(response);
  const accessToken = payload?.data?.accessToken || payload?.accessToken;

  if (!response.ok || !accessToken) {
    const reusedTokens = await reuseUpdatedTokensAfterRefreshRace(env, storedTokens);

    if (reusedTokens) {
      return reusedTokens;
    }

    const error = payload?.error || {
      code: payload?.statusCode || response.status,
      message: payload?.message || 'Imweb accessToken 재발급에 실패했습니다.',
    };
    await recordRefreshFailure(env, error);

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
}

export async function fetchImwebJson(env, url, init = {}) {
  let storedTokens = await getStoredImwebTokens(env);
  let accessToken = storedTokens.accessToken;
  let preemptiveRefresh = null;

  if (shouldRefreshBeforeRequest(storedTokens)) {
    preemptiveRefresh = await refreshImwebToken(env);

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

  const refreshed = await refreshImwebToken(env);

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
  const expiresInSeconds = storedTokens.expiresAt && Number.isFinite(expiresAtTime)
    ? Math.floor((expiresAtTime - Date.now()) / 1000)
    : null;

  return {
    kvConfigured: Boolean(env.ATHOCE_KV),
    clientSecretConfigured: Boolean(clean(env.IMWEB_CLIENT_SECRET)),
    hasAccessToken: Boolean(storedTokens.accessToken),
    hasRefreshToken: Boolean(storedTokens.refreshToken),
    tokenSource: storedTokens.source,
    updatedAt: storedTokens.updatedAt,
    expiresAt: storedTokens.expiresAt,
    expiresInSeconds,
    refreshRecommended: shouldRefreshBeforeRequest(storedTokens),
    lastRefreshFailedAt: storedTokens.lastRefreshFailedAt,
    lastRefreshError: storedTokens.lastRefreshError,
  };
}
