const IMWEB_PRODUCTS_URL = 'https://openapi.imweb.me/products';
const UNIT_CODE = 'S20251229dc44ec3ff128b';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300',
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...extraHeaders,
    },
  });
}

function getImwebError(payload, fallbackStatus) {
  const error =
    payload?.error ||
    payload?.errors?.[0] ||
    payload?.data?.error ||
    payload?.message ||
    payload;

  if (typeof error === 'string') {
    return {
      code: payload?.code || payload?.status || fallbackStatus,
      message: error,
    };
  }

  return {
    code: error?.code || payload?.code || payload?.status || fallbackStatus,
    message:
      error?.message ||
      error?.detail ||
      payload?.message ||
      'Imweb API request failed.',
  };
}

function normalizeProductsPayload(payload) {
  const items =
    payload?.data?.items ||
    payload?.data?.list ||
    payload?.data?.products ||
    payload?.items ||
    payload?.list ||
    payload?.products ||
    [];

  return {
    items: Array.isArray(items) ? items : [],
    page: payload?.data?.page || payload?.page || 1,
    limit: payload?.data?.limit || payload?.limit || 100,
    total:
      payload?.data?.total ||
      payload?.data?.totalCount ||
      payload?.total ||
      payload?.totalCount ||
      null,
    raw: payload,
  };
}

export async function onRequestGet({ env }) {
  if (!env.IMWEB_ACCESS_TOKEN) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'MISSING_IMWEB_ACCESS_TOKEN',
          message: 'Cloudflare Pages 환경 변수 IMWEB_ACCESS_TOKEN이 설정되지 않았습니다.',
        },
      },
      500,
      { 'cache-control': 'no-store' },
    );
  }

  const url = new URL(IMWEB_PRODUCTS_URL);
  url.searchParams.set('unitCode', UNIT_CODE);
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', '100');

  let imwebResponse;

  try {
    imwebResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${env.IMWEB_ACCESS_TOKEN}`,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'IMWEB_NETWORK_ERROR',
          message: error?.message || 'Imweb API에 연결하지 못했습니다.',
        },
      },
      502,
      { 'cache-control': 'no-store' },
    );
  }

  const text = await imwebResponse.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text || 'Empty response from Imweb API.' };
  }

  const businessCode = payload?.code || payload?.error?.code || payload?.data?.code;
  const hasBusinessError = businessCode && Number(businessCode) !== 200;

  if (!imwebResponse.ok || hasBusinessError) {
    const parsedError = getImwebError(payload, imwebResponse.status);

    return jsonResponse(
      {
        ok: false,
        error: {
          ...parsedError,
          hint:
            String(parsedError.code) === '30104'
              ? 'unitCode/siteCode가 올바른지, 해당 토큰이 이 사이트 권한을 갖는지 확인하세요.'
              : undefined,
        },
      },
      imwebResponse.ok ? 400 : imwebResponse.status,
      { 'cache-control': 'no-store' },
    );
  }

  const products = normalizeProductsPayload(payload);

  return jsonResponse({
    ok: true,
    unitCode: UNIT_CODE,
    fetchedAt: new Date().toISOString(),
    ...products,
  });
}
