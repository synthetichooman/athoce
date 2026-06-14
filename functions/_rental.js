export const RENTAL_CATEGORY_CODE = 's20260613e8746a4f236be';

const RENTAL_SESSION_COOKIE = 'athoce_rental_session';
const RENTAL_SESSION_MAX_AGE = 60 * 60 * 24;
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

export function isRentalPasswordValid(password, env) {
  return timingSafeEqual(String(password || '').trim(), getRentalPassword(env));
}

export async function createRentalSessionCookie(env) {
  const secret = getRentalSessionSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now,
      exp: now + RENTAL_SESSION_MAX_AGE,
    }),
  );
  const signature = await signSessionPayload(payload, secret);
  const token = `${payload}.${signature}`;

  return `${RENTAL_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${RENTAL_SESSION_MAX_AGE}`;
}

export async function isRentalAuthorized(request, env) {
  const secret = getRentalSessionSecret(env);
  const token = getCookie(request, RENTAL_SESSION_COOKIE);

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
    return Number(decodedPayload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
