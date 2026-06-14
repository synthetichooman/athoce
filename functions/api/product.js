import { DEFAULT_UNIT_CODE, clean, fetchImwebJson } from '../_imweb.js';
import { RENTAL_CATEGORY_CODE, isRentalAuthorized } from '../_rental.js';

const IMWEB_PRODUCTS_URL = 'https://openapi.imweb.me/products';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store',
    },
  });
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeProductCategories(product) {
  const categories = Array.isArray(product?.categories) ? product.categories : [];

  return categories
    .map((category) =>
      String(
        pickFirst(
          category?.categoryCode,
          category?.code,
          category?.category_code,
          category,
          '',
        ),
      ),
    )
    .filter(Boolean);
}

export async function onRequestGet({ env, request }) {
  const requestUrl = new URL(request.url);
  const prodNo = clean(requestUrl.searchParams.get('prodNo'));
  const unitCode = clean(env.IMWEB_UNIT_CODE || env.IMWEB_SITE_CODE, DEFAULT_UNIT_CODE);
  if (!prodNo) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'MISSING_PROD_NO',
          message: 'prodNo 쿼리 파라미터가 필요합니다.',
        },
      },
      400,
    );
  }

  const url = new URL(`${IMWEB_PRODUCTS_URL}/${encodeURIComponent(prodNo)}`);
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
          message: payload?.message || '상품 상세를 불러오지 못했습니다.',
        },
      },
      response.ok ? 400 : response.status,
    );
  }

  const item = payload?.data || payload;
  const isRentalProduct = normalizeProductCategories(item).includes(RENTAL_CATEGORY_CODE);

  if (isRentalProduct && !(await isRentalAuthorized(request, env))) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'RENTAL_LOCKED',
          message: 'rental password is required.',
        },
      },
      401,
    );
  }

  return jsonResponse({
    ok: true,
    unitCode,
    tokenRefreshed,
    tokenSource,
    storedInKv: Boolean(refreshed?.storedInKv),
    item,
  });
}
