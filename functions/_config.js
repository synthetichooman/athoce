export const ADMIN_CONFIG_KEY = 'athoce_admin_config';

export const DEFAULT_ADMIN_CONFIG = {
  categoryCodes: [],
  statusFilter: [],
  sortMode: 'imweb',
  maxItems: 100,
  hiddenProductNos: [],
  pinnedProductNos: [],
  blurUnavailable: true,
  hideUnavailablePrice: true,
};

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toNumberArray(value) {
  return toStringArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function clampMaxItems(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_ADMIN_CONFIG.maxItems;
  }

  return Math.min(Math.max(Math.trunc(number), 1), 100);
}

export function normalizeAdminConfig(config = {}) {
  const sortMode = ['imweb', 'newest', 'price-low', 'price-high', 'name'].includes(config.sortMode)
    ? config.sortMode
    : DEFAULT_ADMIN_CONFIG.sortMode;

  return {
    categoryCodes: toStringArray(config.categoryCodes),
    statusFilter: toStringArray(config.statusFilter),
    sortMode,
    maxItems: clampMaxItems(config.maxItems),
    hiddenProductNos: toNumberArray(config.hiddenProductNos),
    pinnedProductNos: toNumberArray(config.pinnedProductNos),
    blurUnavailable: config.blurUnavailable !== false,
    hideUnavailablePrice: config.hideUnavailablePrice !== false,
  };
}

export async function getAdminConfig(env) {
  if (!env.ATHOCE_KV) {
    return normalizeAdminConfig(DEFAULT_ADMIN_CONFIG);
  }

  const stored = await env.ATHOCE_KV.get(ADMIN_CONFIG_KEY, 'json');
  return normalizeAdminConfig({
    ...DEFAULT_ADMIN_CONFIG,
    ...(stored || {}),
  });
}

export async function setAdminConfig(env, config) {
  if (!env.ATHOCE_KV) {
    throw new Error('ATHOCE_KV binding is not configured.');
  }

  const normalized = normalizeAdminConfig(config);
  await env.ATHOCE_KV.put(
    ADMIN_CONFIG_KEY,
    JSON.stringify({
      ...normalized,
      updatedAt: new Date().toISOString(),
    }),
  );

  return normalized;
}

export function isAdminAuthorized(request, env) {
  const password = String(env.ADMIN_PASSWORD || '').trim();

  if (!password) {
    return false;
  }

  return request.headers.get('x-admin-password') === password;
}
