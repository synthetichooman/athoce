import { isAdminAuthorized } from '../../_config.js';
import { DEFAULT_CLIENT_ID, clean, getStoredImwebTokens } from '../../_imweb.js';
import { adminJson } from '../../_interlining-admin.js';

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return adminJson({ ok: false, error: { code: 'UNAUTHORIZED', message: '관리자 로그인이 필요합니다.' } }, 401);
  }
  const tokens = await getStoredImwebTokens(env);
  const scope = [...new Set(['site-info:write', 'product:read', 'community:read', ...tokens.scope.split(/\s+/).filter(Boolean)])].join(' ');
  const url = new URL('https://openapi.imweb.me/oauth2/authorize');
  url.search = new URLSearchParams({
    responseType: 'code',
    clientId: clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID),
    redirectUri: clean(env.IMWEB_REDIRECT_URI, `${new URL(request.url).origin}/api/oauth/callback`),
    scope,
    state: crypto.randomUUID(),
    siteCode: clean(env.IMWEB_SITE_CODE, 'S20251229dc44ec3ff128b'),
  }).toString();
  return new Response(null, { status: 302, headers: { location: url.toString(), 'cache-control': 'private, no-store' } });
}
