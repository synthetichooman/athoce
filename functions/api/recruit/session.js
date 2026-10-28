import { isAdminConfigured } from '../../_config.js';
import { recruitAccess } from '../../_recruit-access.js';
import { adminJson } from '../../_interlining-admin.js';

export async function onRequestGet({ env, request }) {
  const access = await recruitAccess(request, env);
  return adminJson({ ok: true, authenticated: Boolean(access), access, adminConfigured: isAdminConfigured(env) });
}
