export const TOKEN_REFRESH_INTERVAL_SECONDS = 60 * 60;
export const TOKEN_REFRESH_BUFFER_SECONDS = 60 * 10;
export const TOKEN_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const TOKEN_REQUEST_TIMEOUT_MS = 15000;

export function getTokenExpiresAt(payload, now = Date.now()) {
  const seconds = Number(payload?.data?.expiresIn || payload?.data?.expires_in ||
    payload?.expiresIn || payload?.expires_in || 0);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(now + seconds * 1000).toISOString() : '';
}

export function shouldRefreshBeforeRequest(tokens, now = Date.now()) {
  if (!tokens.refreshToken) return false;
  const updated = Date.parse(tokens.updatedAt || '');
  const expires = Date.parse(tokens.expiresAt || '');
  return !Number.isFinite(updated) || now - updated >= TOKEN_REFRESH_INTERVAL_SECONDS * 1000 ||
    (Number.isFinite(expires) && expires - now <= TOKEN_REFRESH_BUFFER_SECONDS * 1000);
}
