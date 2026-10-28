// Temporary, narrowly scoped maintenance endpoint. Removed after verified destruction.
import { adminJson } from '../../_interlining-admin.js';
const DIGEST = '0486812c33d357b8d5fb5dea63e6e84ccdbc82a710c93feee0061578cb68cf52';
const EXPIRES = 1793262127210;
export async function onRequestPost({ request, env }) {
  if (Date.now() > EXPIRES) return adminJson({ ok: false }, 410);
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== DIGEST) return adminJson({ ok: false }, 401);
  const body = await request.json().catch(() => null);
  if (body?.confirm !== 'destroy-interlining-personal-data') return adminJson({ ok: false }, 400);
  if (!env.ATHOCE_KV) return adminJson({ ok: false }, 503);
  const keys = []; let cursor;
  do {
    const page = await env.ATHOCE_KV.list({ prefix: 'interlining:', limit: 1000, ...(cursor ? { cursor } : {}) });
    keys.push(...page.keys.map(k => k.name));
    if (page.list_complete) break;
    if (!page.cursor || page.cursor === cursor) return adminJson({ ok: false, message: 'Incomplete key listing' }, 503);
    cursor = page.cursor;
  } while (true);
  for (let offset = 0; offset < keys.length; offset += 20) {
    await Promise.all(keys.slice(offset, offset + 20).map(key => env.ATHOCE_KV.delete(key)));
  }
  const remaining = await env.ATHOCE_KV.list({ prefix: 'interlining:', limit: 1 });
  return adminJson({ ok: true, deleted: keys.length, remaining: remaining.keys.length, empty: remaining.list_complete && remaining.keys.length === 0 });
}
