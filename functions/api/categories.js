import { DEFAULT_UNIT_CODE, clean, fetchImwebJson } from '../_imweb.js';

const IMWEB_CATEGORIES_URL = 'https://openapi.imweb.me/products/shop-categories';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300, s-maxage=600' : 'no-store',
    },
  });
}

export async function onRequestGet({ env }) {
  const unitCode = clean(env.IMWEB_UNIT_CODE || env.IMWEB_SITE_CODE, DEFAULT_UNIT_CODE);

  const url = new URL(IMWEB_CATEGORIES_URL);
  url.searchParams.set('unitCode', unitCode);

  const { response, payload, tokenRefreshed, tokenSource, refreshed } = await fetchImwebJson(
    env,
    url.toString(),
    {
      method: 'GET',
    },
  );

  if (!response.ok || payload?.statusCode >= 400 || payload?.error) {
    return jsonResponse(
      {
        ok: false,
        error: payload?.error || {
          code: payload?.statusCode || response.status,
          message: payload?.message || '카테고리 목록을 불러오지 못했습니다.',
        },
      },
      response.ok ? 400 : response.status,
    );
  }

  return jsonResponse({
    ok: true,
    unitCode,
    tokenRefreshed,
    tokenSource,
    storedInKv: Boolean(refreshed?.storedInKv),
    items: Array.isArray(payload?.data) ? payload.data : [],
  });
}
