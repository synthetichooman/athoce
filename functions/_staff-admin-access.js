import { getAdminSessionSecret, isAdminAuthorized } from './_config.js';
import { tokenHash } from './_staff-schedule.js';

const COOKIE = 'athoce_staff_admin_session';
const MAX_AGE = 86400;
const encoder = new TextEncoder();
const credential = env => String(env.STAFF_ADMIN_PASSWORD_SHA256 || '').trim();
const configured = env => /^[a-f0-9]{64}$/.test(credential(env));
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value) {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
async function sign(payload, env) {
  const secret = getAdminSessionSecret(env);
  if (!secret) throw new Error('Admin signing secret is not configured.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(`staff-admin\0${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}
export async function isStaffAdminPasswordValid(password, env) {
  if (!configured(env) || typeof password !== 'string' || !password.trim() || password.length > 256) return false;
  return equal(await tokenHash(password.trim()), credential(env));
}
export async function createStaffAdminCookie(env) {
  if (!configured(env)) throw new Error('Staff password is not configured.');
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(encoder.encode(JSON.stringify({ audience: 'staff-admin', credential: credential(env), iat: now, exp: now + MAX_AGE })));
  return `${COOKIE}=${payload}.${await sign(payload, env)}; Path=/api/staff; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}
export const clearStaffAdminCookie = () => `${COOKIE}=; Path=/api/staff; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export async function verifyStaffAdminSession(request, env) {
  if (!configured(env)) return false;
  try {
    const value = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const parts = value.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1] || !equal(parts[1], await sign(parts[0], env))) return false;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    return payload.audience === 'staff-admin' && payload.credential === credential(env) && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
export async function isStaffAdminAuthorized(request, env) {
  return await isAdminAuthorized(request, env) || await verifyStaffAdminSession(request, env);
}
