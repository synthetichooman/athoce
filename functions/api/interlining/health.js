import { interliningAccess } from '../../_interlining-access.js';
import { adminJson } from '../../_interlining-admin.js';
import { SUBMISSION_PREFIX } from '../../_interlining-store.js';
import { onRequestPost } from '../interlining.js';
import { onRequestGet as listSubmissions } from './submissions.js';

// Exercise the deployed save/read path using a temporary, non-applicant record.
// Health records live outside the submission namespace and expire if cleanup fails.
export async function onRequestGet({ env, request }) {
  if (!(await interliningAccess(request, env))) return adminJson({ ok: false }, 401);
  if (!env.ATHOCE_KV) return adminJson({ ok: false, storage: 'unavailable' }, 503);
  const id = crypto.randomUUID();
  const key = `interlining:health:${id}`;
  const isolate = (name) => name === `${SUBMISSION_PREFIX}${id}` ? key : name;
  const probeEnv = { ...env, ATHOCE_KV: {
    get: (name, type) => env.ATHOCE_KV.get(isolate(name), type),
    put: (name, value, options) => env.ATHOCE_KV.put(isolate(name), value, { ...options, expirationTtl: 60 }),
    list: async (options) => {
      const result = await env.ATHOCE_KV.list({ ...options, prefix: key });
      return { ...result, keys: result.keys.map((entry) => ({ ...entry, name: `${SUBMISSION_PREFIX}${id}` })) };
    },
  } };
  try {
    const origin = new URL(request.url).origin;
    const body = { submissionId: id, fullName: 'connection check', instagram: 'connection check', phoneFirst: '010', phoneMiddle: '0000', phoneLast: '0000', address: 'connection check', addressDetail: 'connection check', postcode: '00000', guests: '0', filmingConsent: '동의' };
    const probe = () => new Request(`${origin}/api/interlining`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await (await onRequestPost({ request: probe(), env: probeEnv })).json();
    const stored = await env.ATHOCE_KV.get(key, 'json');
    const repeated = await (await onRequestPost({ request: probe(), env: probeEnv })).json();
    const listed = await (await listSubmissions({ env: probeEnv, request: new Request(`${origin}/api/interlining/submissions`, { headers: request.headers }) })).json();
    const listVerified = listed.ok === true && listed.data?.list?.some((row) => row.code === saved.code && row.fullName === body.fullName);
    const ready = saved.ok === true && stored?.code === saved.code && stored?.fullName === body.fullName && stored?.answers?.length === 6 && repeated.ok === true && repeated.code === saved.code && listVerified;
    return adminJson({ ok: ready, storage: ready ? 'ready' : 'unavailable', saveVerified: ready, repeatVerified: ready, listVerified: Boolean(listVerified) }, ready ? 200 : 503);
  } catch {
    return adminJson({ ok: false, storage: 'unavailable' }, 503);
  } finally {
    await env.ATHOCE_KV.delete(key).catch(() => {});
  }
}
