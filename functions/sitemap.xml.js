function xmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=1800',
    },
  });
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getProductId(product) {
  return product?.prodNo || product?.idx || product?.id || product?.productNo || '';
}

const CATEGORY_PATH_BY_CODE = {
  s202606130219c191c0d3e: '/aategois',
  s20260613114d8f3179b7b: '/hooman',
  s2026061356787cc1788a8: '/cementbay',
  s20260613e8746a4f236be: '/rental',
  s20260613cf1433ba877ee: '/athoce-made',
};

function getCategoryUrl(origin, categoryCode) {
  const path = CATEGORY_PATH_BY_CODE[String(categoryCode || '')];
  return path ? `${origin}${path}` : `${origin}/?categoryCode=${encodeURIComponent(categoryCode)}`;
}

function toIsoDate(value, fallback) {
  const date = value ? new Date(value) : null;
  const time = date ? date.getTime() : NaN;

  return Number.isFinite(time) ? date.toISOString() : fallback;
}

function buildUrl(loc, lastmod, priority = '0.7') {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
    `    <priority>${priority}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function onRequestGet() {
  const origin = 'https://athoce.kr';
  const now = new Date().toISOString();
  const urls = [buildUrl(`${origin}/`, now, '1.0')];

  try {
    const response = await fetch(`${origin}/api/products`, {
      headers: {
        accept: 'application/json',
      },
    });
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const categoryCodes = Array.isArray(payload?.categoryCodes) ? payload.categoryCodes : [];

    for (const categoryCode of categoryCodes) {
      if (!categoryCode) {
        continue;
      }

      urls.push(
        buildUrl(getCategoryUrl(origin, categoryCode), payload.fetchedAt || now, '0.7'),
      );
    }

    for (const product of items) {
      const prodNo = getProductId(product);

      if (!prodNo) {
        continue;
      }

      const lastmod = toIsoDate(product.addTime, payload.fetchedAt || now);

      urls.push(
        buildUrl(`${origin}/detail?prodNo=${encodeURIComponent(prodNo)}`, lastmod, '0.8'),
      );
    }
  } catch {
    // Keep the sitemap valid even when the product API is temporarily unavailable.
  }

  return xmlResponse(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      '</urlset>',
    ].join('\n'),
  );
}
