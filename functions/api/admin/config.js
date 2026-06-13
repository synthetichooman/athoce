import {
  DEFAULT_ADMIN_CONFIG,
  getAdminConfig,
  isAdminAuthorized,
  normalizeAdminConfig,
  setAdminConfig,
} from '../../_config.js';

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
  return jsonResponse(
    {
      ok: false,
      error: {
        code: env.ADMIN_PASSWORD ? 'UNAUTHORIZED' : 'ADMIN_PASSWORD_NOT_CONFIGURED',
        message: env.ADMIN_PASSWORD
          ? '관리자 비밀번호가 올바르지 않습니다.'
          : 'Cloudflare Pages 환경변수 ADMIN_PASSWORD를 먼저 설정하세요.',
      },
    },
    env.ADMIN_PASSWORD ? 401 : 500,
  );
}

export async function onRequestGet({ env }) {
  try {
    const config = await getAdminConfig(env);

    return jsonResponse({
      ok: true,
      config,
      defaults: normalizeAdminConfig(DEFAULT_ADMIN_CONFIG),
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'CONFIG_READ_FAILED',
          message: error?.message || '관리자 설정을 불러오지 못했습니다.',
        },
      },
      500,
    );
  }
}

export async function onRequestPost({ env, request }) {
  if (!isAdminAuthorized(request, env)) {
    return unauthorized(env);
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'INVALID_JSON',
          message: 'JSON body가 올바르지 않습니다.',
        },
      },
      400,
    );
  }

  try {
    const config = await setAdminConfig(env, payload?.config || payload || {});

    return jsonResponse({
      ok: true,
      config,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'CONFIG_WRITE_FAILED',
          message: error?.message || '관리자 설정을 저장하지 못했습니다.',
        },
      },
      500,
    );
  }
}
