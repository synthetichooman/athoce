import { clearAdminSessionCookie } from '../../_config.js';

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

export function onRequestPost() {
  return jsonResponse(
    {
      ok: true,
    },
    200,
    {
      'set-cookie': clearAdminSessionCookie(),
    },
  );
}
