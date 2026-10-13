import { getAdminSessionSecret, isAdminAuthorized } from './_config.js';

// Random external-access password; only its SHA-256 digest is deployed.
// Replacing this digest also revokes sessions issued for the previous password.
const DEFAULT_VIEWER_PASSWORD_HASH = '064b7379864a595aee1428c01490109046c0176b5dde41b6663e9263df602a7d';
const COOKIE = 'athoce_interlining_session';
const MAX_AGE = 60 * 60 * 24;
const encoder = new TextEncoder();
const hashFor = (env) => String(env.INTERLINING_VIEWER_PASSWORD_SHA256 || DEFAULT_VIEWER_PASSWORD_HASH).trim();

function equal(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}
async function signature(payload, env) {
  const secret = getAdminSessionSecret(env);
  if (!secret) throw new Error('Admin signing secret is not configured.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(`interlining-viewer\0${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}
export async function isInterliningViewerPasswordValid(password, env) {
  const value = String(password || '').trim();
  if (!value || value.length > 256) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return equal(Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''), hashFor(env));
}
export async function createInterliningViewerCookie(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(encoder.encode(JSON.stringify({ audience: 'interlining', credential: hashFor(env), iat: now, exp: now + MAX_AGE })));
  return `${COOKIE}=${payload}.${await signature(payload, env)}; Path=/api/interlining; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
export function clearInterliningViewerCookie() {
  return `${COOKIE}=; Path=/api/interlining; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export async function verifyInterliningViewerSession(request, env) {
  try {
    const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const parts = value.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    if (!equal(parts[1], await signature(parts[0], env))) return false;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    return payload.audience === 'interlining' && payload.credential === hashFor(env) && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
export async function interliningAccess(request, env) {
  if (await isAdminAuthorized(request, env)) return 'owner';
  if (await verifyInterliningViewerSession(request, env)) return 'viewer';
  return null;
}
