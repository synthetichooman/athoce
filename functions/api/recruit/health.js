import { isAdminAuthorized } from '../../_config.js';
import { adminJson } from '../../_interlining-admin.js';
import { SUBMISSION_PREFIX } from '../../_recruit-store.js';
import { onRequestPost } from '../recruit.js';
import { onRequestGet as listSubmissions } from './submissions.js';

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) return adminJson({ ok: false }, 401);
  if (!env.ATHOCE_KV) return adminJson({ ok: false, storage: 'unavailable' }, 503);
  const id = crypto.randomUUID();
  const key = `recruit:health:${id}`;
  const isolate = name => name === `${SUBMISSION_PREFIX}${id}` ? key : name;
  const probeEnv = { ...env, ATHOCE_KV: {
    get: (name, type) => env.ATHOCE_KV.get(isolate(name), type),
    put: (name, value, options) => env.ATHOCE_KV.put(isolate(name), value, { ...options, expirationTtl: 60 }),
    list: async options => {
      const result = await env.ATHOCE_KV.list({ ...options, prefix: key });
      return { ...result, keys: result.keys.map(entry => ({ ...entry, name: `${SUBMISSION_PREFIX}${id}` })) };
    },
  } };
  try {
    const origin = new URL(request.url).origin;
    const body = { submissionId: id, fullName: 'connection check', instagram: 'connection check', phoneFirst: '010', phoneMiddle: '0000', phoneLast: '0000', availableDays: ['월요일', '금요일'], introduction: 'connection check' };
    const probe = () => new Request(`${origin}/api/recruit`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await (await onRequestPost({ request: probe(), env: probeEnv })).json();
    const stored = await env.ATHOCE_KV.get(key, 'json');
    const repeated = await (await onRequestPost({ request: probe(), env: probeEnv })).json();
    const listed = await (await listSubmissions({ env: probeEnv, request: new Request(`${origin}/api/recruit/submissions`, { headers: request.headers }) })).json();
    const listVerified = listed.ok === true && listed.data?.list?.some(row => row.code === saved.code && row.availableDays === '월요일, 금요일' && row.introduction === body.introduction);
    const saveVerified = saved.ok === true && stored?.code === saved.code && stored?.answers?.length === 5;
    const repeatVerified = repeated.ok === true && repeated.code === saved.code;
    const ready = saveVerified && repeatVerified && listVerified;
    return adminJson({ ok: ready, saveVerified, repeatVerified, listVerified: Boolean(listVerified) }, ready ? 200 : 503);
  } catch { return adminJson({ ok: false }, 503); }
  finally { await env.ATHOCE_KV.delete(key).catch(() => {}); }
}
