import { DEFAULT_UNIT_CODE, clean, fetchImwebJson } from '../_imweb.js';

const IMWEB_PRODUCTS_URL = 'https://openapi.imweb.me/products';

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
      code: payload?.errorCode || payload?.code || payload?.statusCode || payload?.status || fallbackStatus,
      message: error,
    };
  }

  return {
    code:
      error?.errorCode ||
      error?.code ||
      payload?.errorCode ||
      payload?.code ||
      payload?.statusCode ||
      payload?.status ||
      fallbackStatus,
    message:
      error?.message ||
      error?.detail ||
      payload?.message ||
      'Imweb API request failed.',
  };
}

function normalizeProductsPayload(payload) {
  const items =
    payload?.data?.list ||
    payload?.data?.items ||
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
      payload?.data?.totalCount ||
      payload?.total ||
      payload?.totalCount ||
      null,
  };
}

async function fetchProducts({ env, unitCode, categoryCode }) {
  const url = new URL(IMWEB_PRODUCTS_URL);
  url.searchParams.set('unitCode', unitCode);
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', '100');

  if (categoryCode) {
    url.searchParams.set('categoryCode', categoryCode);
  }

  return fetchImwebJson(env, url.toString(), {
    method: 'GET',
  });
}

export async function onRequestGet({ env, request }) {
  const unitCode = clean(env.IMWEB_UNIT_CODE || env.IMWEB_SITE_CODE, DEFAULT_UNIT_CODE);
  const requestUrl = new URL(request.url);
  const requestedCategoryCode = clean(requestUrl.searchParams.get('categoryCode'));
  const envCategoryCodes = clean(env.IMWEB_CATEGORY_CODES)
    .split(',')
    .map((categoryCode) => categoryCode.trim())
    .filter(Boolean);
  const categoryCodes = requestedCategoryCode
    ? [requestedCategoryCode]
    : envCategoryCodes.length
      ? envCategoryCodes
      : [];

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

  let results;

  try {
    const targets = categoryCodes.length ? categoryCodes : [null];

    results = await Promise.all(
      targets.map((categoryCode) =>
        fetchProducts({
          env,
          unitCode,
          categoryCode,
        }),
      ),
    );
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

  const failedResult = results.find(({ response, payload }) => {
    const businessCode =
      payload?.errorCode ||
      payload?.code ||
      payload?.error?.errorCode ||
      payload?.error?.code ||
      payload?.data?.errorCode ||
      payload?.data?.code;
    const statusCode = payload?.statusCode || payload?.status;

    return (
      !response.ok ||
      (businessCode && Number(businessCode) !== 200) ||
      (statusCode && Number(statusCode) >= 400)
    );
  });

  if (failedResult) {
    const parsedError = getImwebError(failedResult.payload, failedResult.response.status);

    return jsonResponse(
      {
        ok: false,
        error: {
          ...parsedError,
          hint:
            String(parsedError.code) === '30104'
              ? `unitCode "${unitCode}"가 올바른지, OAuth 승인 때 사용한 siteCode와 같은지 확인하세요.`
              : undefined,
        },
      },
      failedResult.response.ok ? 400 : failedResult.response.status,
      { 'cache-control': 'no-store' },
    );
  }

  const mergedItems = [];
  const seen = new Set();

  for (const result of results) {
    const products = normalizeProductsPayload(result.payload);

    for (const item of products.items) {
      const key = item?.prodNo || item?.prodCode || item?.id || JSON.stringify(item);

      if (!seen.has(key)) {
        seen.add(key);
        mergedItems.push(item);
      }
    }
  }

  return jsonResponse({
    ok: true,
    unitCode,
    categoryCodes,
    tokenRefreshed: results.some((result) => result.tokenRefreshed),
    fetchedAt: new Date().toISOString(),
    items: mergedItems,
    page: 1,
    limit: 100,
    total: mergedItems.length,
  });
}
