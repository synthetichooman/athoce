import { clean, fetchImwebJson } from '../_imweb.js';

const IMWEB_SITE_INFO_URL = 'https://openapi.imweb.me/site-info';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ env }) {
  const accessToken = clean(env.IMWEB_ACCESS_TOKEN);

  if (!accessToken) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'MISSING_IMWEB_ACCESS_TOKEN',
          message: 'Cloudflare Pages 환경 변수 IMWEB_ACCESS_TOKEN이 설정되지 않았습니다.',
        },
      },
      500,
    );
  }

  const { response, payload, tokenRefreshed, refreshError } = await fetchImwebJson(env, IMWEB_SITE_INFO_URL, {
    method: 'GET',
  });

  return jsonResponse(
    {
      ok: response.ok,
      status: response.status,
      tokenRefreshed,
      refreshError,
      payload,
    },
    response.ok ? 200 : response.status,
  );
}
