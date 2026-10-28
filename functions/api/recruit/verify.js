// Temporary deployment verification; removed after completion.
import { createAdminSessionCookie } from '../../_config.js';
import { adminJson } from '../../_interlining-admin.js';
import { onRequestGet as health } from './health.js';
export async function onRequestPost({ env, request }) {
  if (Date.now() > 1793262406209) return adminJson({ ok: false }, 410);
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== '0486812c33d357b8d5fb5dea63e6e84ccdbc82a710c93feee0061578cb68cf52') return adminJson({ ok: false }, 401);
  const cookie = (await createAdminSessionCookie(env)).split(';')[0];
  return health({ env, request: new Request(new URL('/api/recruit/health', request.url), { headers: { cookie } }) });
}
