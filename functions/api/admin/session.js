import { isAdminConfigured, verifyAdminSession } from '../../_config.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ env, request }) {
  return jsonResponse({
    ok: true,
    authenticated: await verifyAdminSession(request, env),
    adminConfigured: isAdminConfigured(env),
  });
}
