import {
  createAdminSessionCookie,
  getAdminLoginAttemptState,
  isAdminConfigured,
  isAdminPasswordValid,
  recordFailedAdminLogin,
  resetAdminLoginAttempts,
} from '../../_config.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function onRequestPost({ env, request }) {
  if (!isAdminConfigured(env)) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'ADMIN_PASSWORD_NOT_CONFIGURED',
          message: 'Cloudflare Pages 환경변수 ADMIN_PASSWORD 또는 ADMIN_PASSWORDS를 먼저 설정하세요.',
        },
      },
      500,
    );
  }

  const attemptState = await getAdminLoginAttemptState(env, request);

  if (attemptState.blocked) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: '로그인 시도가 너무 많습니다. 10분 뒤 다시 시도하세요.',
        },
      },
      429,
    );
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  if (!isAdminPasswordValid(payload?.password, env)) {
    await recordFailedAdminLogin(env, request);

    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: '비밀번호가 올바르지 않습니다.',
        },
      },
      401,
    );
  }

  await resetAdminLoginAttempts(env, request);

  return jsonResponse(
    {
      ok: true,
      expiresIn: 60 * 60 * 24,
    },
    200,
    {
      'set-cookie': await createAdminSessionCookie(env),
    },
  );
}
