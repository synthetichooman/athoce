import { refreshImwebToken } from '../../_imweb.js';
import { sendThrottledTelegramAlert } from '../../_telegram.js';

const PUBLIC_REFRESH_LOCK_KEY = 'imweb_public_refresh_lock';
const PUBLIC_REFRESH_LOCK_SECONDS = 60;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function getRequestIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

async function isRateLimited(env) {
  if (!env.ATHOCE_KV) {
    return false;
  }

  const lockedAt = await env.ATHOCE_KV.get(PUBLIC_REFRESH_LOCK_KEY);

  if (lockedAt) {
    return true;
  }

  await env.ATHOCE_KV.put(PUBLIC_REFRESH_LOCK_KEY, new Date().toISOString(), {
    expirationTtl: PUBLIC_REFRESH_LOCK_SECONDS,
  });

  return false;
}

async function notifyPublicRefresh(env, request, refreshed) {
  const ip = getRequestIp(request);
  const status = refreshed.ok ? 'succeeded' : 'failed';
  const message = [
    `[athoce] public token refresh ${status}`,
    `ip: ${ip}`,
    refreshed.ok ? `storedInKv: ${refreshed.storedInKv ? 'yes' : 'no'}` : `error: ${refreshed.error?.message || '-'}`,
    refreshed.ok ? '' : 'reauthorize: https://athoce.kr/api/oauth/start',
  ]
    .filter(Boolean)
    .join('\n');

  await sendThrottledTelegramAlert(
    env,
    `public_refresh:${status}`,
    message,
  );
}

export async function onRequestPost({ env, request }) {
  if (await isRateLimited(env)) {
    return jsonResponse({
      ok: false,
      error: {
        code: 'PUBLIC_REFRESH_RATE_LIMITED',
        message: 'sync retry is already running. please try again shortly.',
      },
    }, 429);
  }

  const refreshed = await refreshImwebToken(env, { notifyFailure: false });
  await notifyPublicRefresh(env, request, refreshed);

  if (!refreshed.ok) {
    return jsonResponse({
      ok: false,
      error: {
        code: refreshed.error?.code || 'PUBLIC_REFRESH_FAILED',
        message: 'sync retry failed.',
      },
    }, 502);
  }

  return jsonResponse({
    ok: true,
    refreshed: {
      storedInKv: Boolean(refreshed.storedInKv),
    },
  });
}

export async function onRequestGet() {
  return jsonResponse({
    ok: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'use post.',
    },
  }, 405);
}
