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

function clean(value) {
  return String(value || '').trim();
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

  const imwebResponse = await fetch(IMWEB_SITE_INFO_URL, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await imwebResponse.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  return jsonResponse(
    {
      ok: imwebResponse.ok,
      status: imwebResponse.status,
      payload,
    },
    imwebResponse.ok ? 200 : imwebResponse.status,
  );
}
