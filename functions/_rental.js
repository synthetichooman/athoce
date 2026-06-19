export const RENTAL_CATEGORY_CODE = 's20260613e8746a4f236be';

const RENTAL_KEYS_STORAGE_KEY = 'rental_access_keys';
const RENTAL_LOGS_STORAGE_KEY = 'rental_usage_logs';
const RENTAL_SESSION_COOKIE = 'athoce_rental_session';
const RENTAL_SESSION_MAX_AGE = 60 * 60 * 24;
const MAX_RENTAL_LOGS = 80;
const FALLBACK_RENTAL_PASSWORD = '3days15percent';
const encoder = new TextEncoder();

function getRentalPassword(env) {
  return String(env.RENTAL_PASSWORD || FALLBACK_RENTAL_PASSWORD).trim();
}

function getRentalSessionSecret(env) {
  return String(
    env.RENTAL_SESSION_SECRET ||
      env.ADMIN_SESSION_SECRET ||
      env.RENTAL_PASSWORD ||
      FALLBACK_RENTAL_PASSWORD,
  ).trim();
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

function getCookie(request, name) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

function clean(value, maxLength = 240) {
  return String(value || '')
    .trim()
    .slice(0, maxLength);
}

function slugify(value) {
  return clean(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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

async function hashValue(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
  return base64UrlEncode(new Uint8Array(digest)).slice(0, 18);
}

function getRequestIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function getRequestMeta(request) {
  return {
    ip: getRequestIp(request),
    userAgent: clean(request.headers.get('user-agent'), 180),
  };
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

export function isRentalPasswordValid(password, env) {
  return timingSafeEqual(String(password || '').trim(), getRentalPassword(env));
}

export function normalizeRentalKeys(keys = []) {
  if (!Array.isArray(keys)) {
    return [];
  }

  const seen = new Set();

  return keys
    .map((key) => {
      const id = slugify(key?.id || key?.label || crypto.randomUUID());
      const normalized = {
        id,
        label: clean(key?.label || id, 120),
        key: clean(key?.key, 160),
        note: clean(key?.note, 400),
        active: key?.active !== false,
        createdAt: clean(key?.createdAt, 40),
        lastUsedAt: clean(key?.lastUsedAt, 40),
        useCount: Math.max(0, Number(key?.useCount || 0)),
      };

      if (!normalized.id || !normalized.key || seen.has(normalized.id)) {
        return null;
      }

      seen.add(normalized.id);
      return normalized;
    })
    .filter(Boolean);
}

export async function getRentalKeys(env) {
  if (!env.ATHOCE_KV) {
    return [];
  }

  return normalizeRentalKeys((await env.ATHOCE_KV.get(RENTAL_KEYS_STORAGE_KEY, 'json')) || []);
}

async function putRentalKeys(env, keys) {
  if (!env.ATHOCE_KV) {
    throw new Error('ATHOCE_KV binding is not configured.');
  }

  const normalized = normalizeRentalKeys(keys);
  await env.ATHOCE_KV.put(RENTAL_KEYS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function createRentalKey(env, keyInput = {}) {
  const keys = await getRentalKeys(env);
  const now = new Date().toISOString();
  const idBase = slugify(keyInput.id || keyInput.label || `client-${keys.length + 1}`);
  let id = idBase || `client-${Date.now()}`;
  let suffix = 2;

  while (keys.some((key) => key.id === id)) {
    id = `${idBase}-${suffix}`;
    suffix += 1;
  }

  const nextKey = {
    id,
    label: clean(keyInput.label || id, 120),
    key: clean(keyInput.key, 160),
    note: clean(keyInput.note, 400),
    active: keyInput.active !== false,
    createdAt: now,
    lastUsedAt: '',
    useCount: 0,
  };

  if (!nextKey.key) {
    throw new Error('rental key value is required.');
  }

  return putRentalKeys(env, [...keys, nextKey]);
}

export async function updateRentalKey(env, keyId, patch = {}) {
  const keys = await getRentalKeys(env);
  const id = clean(keyId, 80);
  const index = keys.findIndex((key) => key.id === id);

  if (index < 0) {
    throw new Error('rental key not found.');
  }

  keys[index] = {
    ...keys[index],
    label: patch.label === undefined ? keys[index].label : clean(patch.label, 120),
    key: patch.key === undefined ? keys[index].key : clean(patch.key, 160),
    note: patch.note === undefined ? keys[index].note : clean(patch.note, 400),
    active: patch.active === undefined ? keys[index].active : patch.active !== false,
  };

  if (!keys[index].key) {
    throw new Error('rental key value is required.');
  }

  return putRentalKeys(env, keys);
}

export async function deleteRentalKey(env, keyId) {
  const id = clean(keyId, 80);
  const keys = (await getRentalKeys(env)).filter((key) => key.id !== id);
  return putRentalKeys(env, keys);
}

export async function findRentalAccess(password, env) {
  const passwordText = String(password || '').trim();

  if (timingSafeEqual(passwordText, getRentalPassword(env))) {
    return {
      ok: true,
      keyId: 'default',
      label: 'default rental key',
    };
  }

  const keys = await getRentalKeys(env);
  const matchedKey = keys.find((key) => key.active && timingSafeEqual(passwordText, key.key));

  if (!matchedKey) {
    return {
      ok: false,
    };
  }

  return {
    ok: true,
    keyId: matchedKey.id,
    label: matchedKey.label,
  };
}

export async function createRentalSessionCookie(env, access = {}) {
  const secret = getRentalSessionSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now,
      exp: now + RENTAL_SESSION_MAX_AGE,
      keyId: clean(access.keyId || 'default', 80),
      label: clean(access.label || 'default rental key', 120),
    }),
  );
  const signature = await signSessionPayload(payload, secret);
  const token = `${payload}.${signature}`;

  return `${RENTAL_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${RENTAL_SESSION_MAX_AGE}`;
}

export async function getRentalSession(request, env) {
  const secret = getRentalSessionSecret(env);
  const token = getCookie(request, RENTAL_SESSION_COOKIE);

  if (!secret || !token) {
    return null;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = await signSessionPayload(payload, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const decodedPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    if (Number(decodedPayload.exp) <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      keyId: clean(decodedPayload.keyId || 'default', 80),
      label: clean(decodedPayload.label || 'default rental key', 120),
      exp: Number(decodedPayload.exp),
      iat: Number(decodedPayload.iat),
    };
  } catch {
    return null;
  }
}

export async function isRentalAuthorized(request, env) {
  return Boolean(await getRentalSession(request, env));
}

export async function getRentalLogs(env) {
  if (!env.ATHOCE_KV) {
    return [];
  }

  const logs = (await env.ATHOCE_KV.get(RENTAL_LOGS_STORAGE_KEY, 'json')) || [];
  return Array.isArray(logs) ? logs : [];
}

export async function recordRentalEvent(env, request, event = {}) {
  if (!env.ATHOCE_KV) {
    return [];
  }

  const meta = getRequestMeta(request);
  const now = new Date().toISOString();
  const keyId = clean(event.keyId || 'unknown', 80);
  const entry = {
    time: now,
    event: clean(event.event || 'rental_event', 80),
    keyId,
    label: clean(event.label || '', 120),
    success: event.success !== false,
    itemCount: Number(event.itemCount || 0),
    ipHash: await hashValue(meta.ip),
    userAgent: meta.userAgent,
  };
  const logs = await getRentalLogs(env);
  const nextLogs = [entry, ...logs].slice(0, MAX_RENTAL_LOGS);

  await env.ATHOCE_KV.put(RENTAL_LOGS_STORAGE_KEY, JSON.stringify(nextLogs));

  if (entry.success && keyId && keyId !== 'default' && event.event === 'rental_login') {
    const keys = await getRentalKeys(env);
    const index = keys.findIndex((key) => key.id === keyId);

    if (index >= 0) {
      keys[index] = {
        ...keys[index],
        lastUsedAt: now,
        useCount: Number(keys[index].useCount || 0) + 1,
      };
      await putRentalKeys(env, keys);
    }
  }

  return nextLogs;
}
