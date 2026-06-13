export const DEFAULT_CLIENT_ID = '41b37086-2076-4edd-ade4-b447c22544ea';
export const DEFAULT_UNIT_CODE = 'S20251229dc44ec3ff128b';

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

export async function refreshImwebToken(env) {
  const clientId = clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID);
  const clientSecret = clean(env.IMWEB_CLIENT_SECRET);
  const refreshToken = clean(env.IMWEB_REFRESH_TOKEN);

  if (!clientSecret || !refreshToken) {
    return {
      ok: false,
      error: {
        code: 'MISSING_REFRESH_CONFIG',
        message: 'IMWEB_CLIENT_SECRET 또는 IMWEB_REFRESH_TOKEN 환경변수가 없습니다.',
      },
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
    return {
      ok: false,
      error: payload?.error || {
        code: payload?.statusCode || response.status,
        message: payload?.message || 'Imweb accessToken 재발급에 실패했습니다.',
      },
      payload,
    };
  }

  return {
    ok: true,
    accessToken,
    refreshToken: payload?.data?.refreshToken || payload?.refreshToken || refreshToken,
    scope: payload?.data?.scope || payload?.scope,
  };
}

export async function fetchImwebJson(env, url, init = {}) {
  const accessToken = clean(env.IMWEB_ACCESS_TOKEN);

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
    return { response, payload, tokenRefreshed: false };
  }

  const refreshed = await refreshImwebToken(env);

  if (!refreshed.ok) {
    return { response, payload, tokenRefreshed: false, refreshError: refreshed.error };
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
    refreshed,
  };
}
