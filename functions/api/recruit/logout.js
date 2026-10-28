import { clearAdminSessionCookie } from '../../_config.js';
import { clearRecruitViewerCookie } from '../../_recruit-access.js';
import { adminJson } from '../../_interlining-admin.js';

export function onRequestPost() {
  const response = adminJson({ ok: true });
  response.headers.append('set-cookie', clearRecruitViewerCookie());
  response.headers.append('set-cookie', clearAdminSessionCookie());
  return response;
}
