import { clearAdminSessionCookie } from '../../_config.js';
import { clearInterliningViewerCookie } from '../../_interlining-access.js';
import { adminJson } from '../../_interlining-admin.js';

export function onRequestPost() {
  const response = adminJson({ ok: true });
  response.headers.append('set-cookie', clearInterliningViewerCookie());
  response.headers.append('set-cookie', clearAdminSessionCookie());
  return response;
}
