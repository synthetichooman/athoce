const DEFAULT_CLIENT_ID = '41b37086-2076-4edd-ade4-b447c22544ea';
const DEFAULT_SITE_CODE = 'S20251229dc44ec3ff128b';
const REQUIRED_SCOPE = 'site-info:write product:read';

function clean(value, fallback = '') {
  return String(value || fallback).trim();
}

export async function onRequestGet({ env, request }) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const redirectUri = clean(env.IMWEB_REDIRECT_URI, `${origin}/api/oauth/callback`);

  const authorizeUrl = new URL('https://openapi.imweb.me/oauth2/authorize');
  authorizeUrl.searchParams.set('responseType', 'code');
  authorizeUrl.searchParams.set('clientId', clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID));
  authorizeUrl.searchParams.set('redirectUri', redirectUri);
  authorizeUrl.searchParams.set('scope', REQUIRED_SCOPE);
  authorizeUrl.searchParams.set('state', crypto.randomUUID());
  authorizeUrl.searchParams.set('siteCode', clean(env.IMWEB_SITE_CODE, DEFAULT_SITE_CODE));

  return Response.redirect(authorizeUrl.toString(), 302);
}
