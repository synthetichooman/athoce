import {
  clearAdminSessionCookie, createAdminSessionCookie, getAdminLoginAttemptState, isAdminConfigured,
  isAdminPasswordValid, recordFailedAdminLogin, resetAdminLoginAttempts,
} from '../../_config.js';
import { adminJson } from '../../_interlining-admin.js';
import { clearRecruitViewerCookie, createRecruitViewerCookie, isRecruitViewerPasswordValid } from '../../_recruit-access.js';

export async function onRequestPost({ env, request }) {
  if (!isAdminConfigured(env)) return adminJson({ ok: false, error: { code: 'ADMIN_PASSWORD_NOT_CONFIGURED', message: '관리자 로그인이 아직 설정되지 않았습니다.' } }, 503);
  if ((await getAdminLoginAttemptState(env, request)).blocked) return adminJson({ ok: false, error: { code: 'TOO_MANY_ATTEMPTS', message: '로그인 시도가 너무 많습니다. 10분 뒤 다시 시도하세요.' } }, 429);
  let payload;
  try { payload = await request.json(); } catch { payload = {}; }
  const owner = isAdminPasswordValid(payload?.password, env);
  if (!owner && !(await isRecruitViewerPasswordValid(payload?.password, env))) {
    await recordFailedAdminLogin(env, request);
    return adminJson({ ok: false, error: { code: 'INVALID_PASSWORD', message: '비밀번호가 올바르지 않습니다.' } }, 401);
  }
  await resetAdminLoginAttempts(env, request);
  const response = adminJson({ ok: true, access: owner ? 'owner' : 'viewer', expiresIn: 60 * 60 * 24 });
  response.headers.append('set-cookie', owner ? await createAdminSessionCookie(env) : await createRecruitViewerCookie(env));
  response.headers.append('set-cookie', owner ? clearRecruitViewerCookie() : clearAdminSessionCookie());
  return response;
}
