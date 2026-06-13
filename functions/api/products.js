import { DEFAULT_UNIT_CODE, clean, fetchImwebJson } from '../_imweb.js';
import { getAdminConfig } from '../_config.js';

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

function getProductNo(product) {
  const value = Number(product?.prodNo || product?.idx || product?.id || product?.productNo);
  return Number.isFinite(value) ? value : null;
}

function getPrice(product) {
  const value = Number(product?.price || product?.salePrice || product?.sale_price || 0);
  return Number.isFinite(value) ? value : 0;
}

function getSortNo(product) {
  const value = Number(product?.sortNo || product?.sort_no || 0);
  return Number.isFinite(value) ? value : 0;
}

function getAddTime(product) {
  const time = new Date(product?.addTime || product?.createdAt || product?.created_at || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function productHasCategory(product, categoryCodes) {
  if (!categoryCodes.length) {
    return true;
  }

  const productCategories = Array.isArray(product?.categories) ? product.categories : [];
  return productCategories.some((categoryCode) => categoryCodes.includes(String(categoryCode)));
}

function applyPinnedOrder(items, pinnedProductNos) {
  if (!pinnedProductNos.length) {
    return items;
  }

  const rank = new Map(pinnedProductNos.map((prodNo, index) => [prodNo, index]));

  return [...items].sort((a, b) => {
    const aRank = rank.has(getProductNo(a)) ? rank.get(getProductNo(a)) : Infinity;
    const bRank = rank.has(getProductNo(b)) ? rank.get(getProductNo(b)) : Infinity;

    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return 0;
  });
}

function sortProducts(items, sortMode) {
  const sorted = [...items];

  if (sortMode === 'newest') {
    return sorted.sort((a, b) => getAddTime(b) - getAddTime(a));
  }

  if (sortMode === 'price-low') {
    return sorted.sort((a, b) => getPrice(a) - getPrice(b));
  }

  if (sortMode === 'price-high') {
    return sorted.sort((a, b) => getPrice(b) - getPrice(a));
  }

  if (sortMode === 'name') {
    return sorted.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'ko'));
  }

  return sorted.sort((a, b) => getSortNo(b) - getSortNo(a));
}

function applyAdminConfig(items, config) {
  const hidden = new Set(config.hiddenProductNos);
  const statusFilter = new Set(config.statusFilter);
  const filtered = items.filter((product) => {
    const productNo = getProductNo(product);
    const status = String(product?.prodStatus || '');

    return (
      !hidden.has(productNo) &&
      productHasCategory(product, config.categoryCodes) &&
      (!statusFilter.size || statusFilter.has(status))
    );
  });

  return applyPinnedOrder(sortProducts(filtered, config.sortMode), config.pinnedProductNos).slice(
    0,
    config.maxItems,
  );
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
  const adminConfig = await getAdminConfig(env);
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
      : adminConfig.categoryCodes;

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

  const displayItems = applyAdminConfig(mergedItems, adminConfig);

  return jsonResponse({
    ok: true,
    unitCode,
    categoryCodes: adminConfig.categoryCodes,
    requestedCategoryCodes: categoryCodes,
    display: {
      blurUnavailable: adminConfig.blurUnavailable,
      hideUnavailablePrice: adminConfig.hideUnavailablePrice,
    },
    tokenRefreshed: results.some((result) => result.tokenRefreshed),
    tokenSource: results.find((result) => result.tokenSource)?.tokenSource || 'unknown',
    storedInKv: results.some((result) => result.refreshed?.storedInKv),
    fetchedAt: new Date().toISOString(),
    items: displayItems,
    page: 1,
    limit: 100,
    total: displayItems.length,
  });
}
