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

function recordRentalEventInBackground(context, event) {
  const task = recordRentalEvent(context.env, context.request, event).catch(() => {
    // Rental access should never fail because usage logging is temporarily unavailable.
  });

  if (typeof context.waitUntil === 'function') {
    context.waitUntil(task);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  let payload;

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const access = await findRentalAccess(payload?.password, env);

  if (!access.ok) {
    recordRentalEventInBackground(context, {
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

  const sessionCookie = await createRentalSessionCookie(env, access);

  recordRentalEventInBackground(context, {
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
      'set-cookie': sessionCookie,
    },
  );
}
