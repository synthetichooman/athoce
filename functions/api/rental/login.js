import { createRentalSessionCookie, findRentalAccess, recordRentalEvent } from '../../_rental.js';

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
  let payload;

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const access = await findRentalAccess(payload?.password, env);

  if (!access.ok) {
    await recordRentalEvent(env, request, {
      event: 'rental_login',
      keyId: 'unknown',
      label: '',
      success: false,
    });

    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'INVALID_RENTAL_PASSWORD',
          message: 'password is not correct.',
        },
      },
      401,
    );
  }

  await recordRentalEvent(env, request, {
    event: 'rental_login',
    keyId: access.keyId,
    label: access.label,
    success: true,
  });

  return jsonResponse(
    {
      ok: true,
      expiresIn: 60 * 60 * 24,
      key: {
        id: access.keyId,
        label: access.label,
      },
    },
    200,
    {
      'set-cookie': await createRentalSessionCookie(env, access),
    },
  );
}
