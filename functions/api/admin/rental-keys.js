import { isAdminAuthorized, isAdminConfigured } from '../../_config.js';
import {
  createRentalKey,
  deleteRentalKey,
  getRentalKeys,
  getRentalLogs,
  updateRentalKey,
} from '../../_rental.js';

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

function publicKey(key) {
  return {
    id: key.id,
    label: key.label,
    key: key.key,
    note: key.note,
    active: key.active,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    useCount: key.useCount,
  };
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return unauthorized(env);
  }

  return jsonResponse({
    ok: true,
    keys: (await getRentalKeys(env)).map(publicKey),
    logs: await getRentalLogs(env),
  });
}

export async function onRequestPost({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return unauthorized(env);
  }

  const body = await readBody(request);
  const action = String(body?.action || 'create').trim();

  try {
    if (action === 'create') {
      await createRentalKey(env, body.key || body);
    } else if (action === 'update') {
      await updateRentalKey(env, body.id, body.patch || {});
    } else if (action === 'delete') {
      await deleteRentalKey(env, body.id);
    } else {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: 'INVALID_ACTION',
            message: '지원하지 않는 rental key action입니다.',
          },
        },
        400,
      );
    }

    return jsonResponse({
      ok: true,
      keys: (await getRentalKeys(env)).map(publicKey),
      logs: await getRentalLogs(env),
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'RENTAL_KEY_WRITE_FAILED',
          message: error?.message || 'rental key를 저장하지 못했습니다.',
        },
      },
      400,
    );
  }
}
