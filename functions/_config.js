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

const ADMIN_SESSION_COOKIE = 'athoce_admin_session';
const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24;
const ADMIN_LOGIN_ATTEMPTS_KEY_PREFIX = 'admin_login_attempts:';
const ADMIN_LOGIN_ATTEMPTS_LIMIT = 8;
const ADMIN_LOGIN_ATTEMPTS_WINDOW = 60 * 10;
const encoder = new TextEncoder();

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toNumberArray(value) {
  return toStringArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
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

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : encoder.encode(String(input));
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  base64 += '='.repeat((4 - (base64.length % 4)) % 4);

  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getAdminPassword(env) {
  return String(env.ADMIN_PASSWORD || '').trim();
}

function getAdminPasswords(env) {
  return [
    getAdminPassword(env),
    ...String(env.ADMIN_PASSWORDS || '')
      .split(/[\n,]+/)
      .map((password) => password.trim()),
  ].filter(Boolean);
}

function getAdminSessionSecret(env) {
  return String(env.ADMIN_SESSION_SECRET || getAdminPasswords(env)[0] || '').trim();
}

function getRequestIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

function timingSafeEqual(left, right) {
  const leftText = String(left || '');
  const rightText = String(right || '');

  if (leftText.length !== rightText.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < leftText.length; index += 1) {
    diff |= leftText.charCodeAt(index) ^ rightText.charCodeAt(index);
  }

  return diff === 0;
}

async function signSessionPayload(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));

  return base64UrlEncode(new Uint8Array(signature));
}

export function isAdminConfigured(env) {
  return getAdminPasswords(env).length > 0;
}

export function isAdminPasswordValid(password, env) {
  const adminPasswords = getAdminPasswords(env);

  if (!adminPasswords.length) {
    return false;
  }

  return adminPasswords.some((adminPassword) =>
    timingSafeEqual(String(password || '').trim(), adminPassword),
  );
}

export async function createAdminSessionCookie(env) {
  const secret = getAdminSessionSecret(env);

  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET, ADMIN_PASSWORD, or ADMIN_PASSWORDS is not configured.');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now,
      exp: now + ADMIN_SESSION_MAX_AGE,
    }),
  );
  const signature = await signSessionPayload(payload, secret);
  const token = `${payload}.${signature}`;

  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE}`;
}

export function clearAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function verifyAdminSession(request, env) {
  const secret = getAdminSessionSecret(env);
  const token = getCookie(request, ADMIN_SESSION_COOKIE);

  if (!secret || !token) {
    return false;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = await signSessionPayload(payload, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const decodedPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    const now = Math.floor(Date.now() / 1000);

    return Number(decodedPayload.exp) > now;
  } catch {
    return false;
  }
}

export async function isAdminAuthorized(request, env) {
  return verifyAdminSession(request, env);
}

export async function getAdminLoginAttemptState(env, request) {
  if (!env.ATHOCE_KV) {
    return { blocked: false, attempts: 0 };
  }

  const key = `${ADMIN_LOGIN_ATTEMPTS_KEY_PREFIX}${getRequestIp(request)}`;
  const stored = await env.ATHOCE_KV.get(key, 'json');
  const attempts = Number(stored?.attempts || 0);

  return {
    key,
    attempts,
    blocked: attempts >= ADMIN_LOGIN_ATTEMPTS_LIMIT,
  };
}

export async function recordFailedAdminLogin(env, request) {
  if (!env.ATHOCE_KV) {
    return;
  }

  const state = await getAdminLoginAttemptState(env, request);

  await env.ATHOCE_KV.put(
    state.key,
    JSON.stringify({
      attempts: state.attempts + 1,
      updatedAt: new Date().toISOString(),
    }),
    { expirationTtl: ADMIN_LOGIN_ATTEMPTS_WINDOW },
  );
}

export async function resetAdminLoginAttempts(env, request) {
  if (!env.ATHOCE_KV) {
    return;
  }

  const state = await getAdminLoginAttemptState(env, request);

  if (state.key) {
    await env.ATHOCE_KV.delete(state.key);
  }
}
