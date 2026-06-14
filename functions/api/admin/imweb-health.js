import { isAdminAuthorized, isAdminConfigured } from '../../_config.js';
import { getImwebTokenHealth, refreshImwebToken } from '../../_imweb.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function unauthorized(env) {
  const configured = isAdminConfigured(env);

  return jsonResponse(
    {
      ok: false,
      error: {
        code: configured ? 'UNAUTHORIZED' : 'ADMIN_PASSWORD_NOT_CONFIGURED',
        message: configured
          ? '관리자 로그인이 필요합니다.'
          : 'Cloudflare Pages 환경변수 ADMIN_PASSWORD 또는 ADMIN_PASSWORDS를 먼저 설정하세요.',
      },
    },
    configured ? 401 : 500,
  );
}

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return unauthorized(env);
  }

  return jsonResponse({
    ok: true,
    health: await getImwebTokenHealth(env),
  });
}

export async function onRequestPost({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return unauthorized(env);
  }

  const refreshed = await refreshImwebToken(env);

  return jsonResponse(
    {
      ok: refreshed.ok,
      refreshed: refreshed.ok
        ? {
            storedInKv: Boolean(refreshed.storedInKv),
            expiresAt: refreshed.expiresAt || '',
          }
        : null,
      health: await getImwebTokenHealth(env),
      error: refreshed.ok ? null : refreshed.error,
    },
    refreshed.ok ? 200 : 502,
  );
}
