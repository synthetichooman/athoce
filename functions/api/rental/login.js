import { createRentalSessionCookie, isRentalPasswordValid } from '../../_rental.js';

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

  if (!isRentalPasswordValid(payload?.password, env)) {
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

  return jsonResponse(
    {
      ok: true,
      expiresIn: 60 * 60 * 24,
    },
    200,
    {
      'set-cookie': await createRentalSessionCookie(env),
    },
  );
}
