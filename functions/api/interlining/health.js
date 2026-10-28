import { interliningAccess } from '../../_interlining-access.js';
import { adminJson } from '../../_interlining-admin.js';
import { submissionKeys } from '../../_interlining-store.js';
export async function onRequestGet({ env, request }) {
  if (!(await interliningAccess(request, env))) return adminJson({ ok: false }, 401);
  try {
    const keys = await submissionKeys(env);
    return adminJson({ ok: true, intake: 'closed', totalCount: keys.length });
  } catch { return adminJson({ ok: false, storage: 'unavailable' }, 503); }
}
