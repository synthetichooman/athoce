import { isAdminAuthorized, isAdminConfigured } from '../../_config.js';
import { isTelegramConfigured, sendTelegramMessage } from '../../_telegram.js';

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

export async function onRequestPost({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return unauthorized(env);
  }

  if (!isTelegramConfigured(env)) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'TELEGRAM_NOT_CONFIGURED',
          message: 'TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 환경변수를 먼저 설정하세요.',
        },
      },
      500,
    );
  }

  const result = await sendTelegramMessage(
    env,
    ['[athoce] telegram test', `time: ${new Date().toISOString()}`].join('\n'),
  );

  return jsonResponse(
    {
      ok: result.ok,
      status: result.status || null,
      error: result.ok ? null : result.payload || result.error || 'TELEGRAM_SEND_FAILED',
    },
    result.ok ? 200 : 502,
  );
}
