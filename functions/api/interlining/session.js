import { isAdminConfigured } from '../../_config.js';
import { interliningAccess } from '../../_interlining-access.js';
import { adminJson } from '../../_interlining-admin.js';

export async function onRequestGet({ env, request }) {
  const access = await interliningAccess(request, env);
  return adminJson({ ok: true, authenticated: Boolean(access), access, adminConfigured: isAdminConfigured(env) });
}
