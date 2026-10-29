import { isAdminAuthorized } from '../../_config.js';
import { callSchedule, employeeToken, staffCookie, tokenHash, json, fail } from '../../_staff-schedule.js';

export async function onRequest({ request, env, params }) {
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  const url = new URL(request.url);
  const mutation = request.method === 'POST';
  if (!mutation && request.method !== 'GET') return fail('지원하지 않는 요청입니다.', 405);
  let body = {};
  if (mutation) {
    if (request.headers.get('origin') !== url.origin) return fail('이 페이지에서 직접 요청해 주세요.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('잘못된 요청입니다.', 415);
    const raw = await request.text(); if (raw.length > 24000) return fail('입력 내용이 너무 깁니다.', 413);
    try { body = JSON.parse(raw); } catch { return fail('입력 내용을 확인해 주세요.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('입력 내용을 확인해 주세요.');
  }
  if (path === 'logout' && mutation) return json({ ok: true }, 200, { 'set-cookie': staffCookie('') });
  if (path === 'login' && mutation) {
    if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) return fail('직원 전용 링크를 확인해 주세요.', 401);
    const response = await callSchedule(env, { action: 'identity', credential: await tokenHash(body.token) });
    if (!response.ok) return response;
    return json(await response.json(), 200, { 'set-cookie': staffCookie(body.token) });
  }
  if (path === 'admin') {
    if (!await isAdminAuthorized(request, env)) return fail('사이트 관리자 로그인이 필요합니다.', 401);
    return callSchedule(env, mutation ? { action: 'admin-write', body } : { action: 'admin-read', week: url.searchParams.get('week') });
  }
  if (path !== '' && path !== 'me') return fail('페이지를 찾지 못했습니다.', 404);
  const token = employeeToken(request);
  if (!/^[0-9a-f]{64}$/.test(token)) return fail('관리자에게 받은 직원 전용 링크로 접속해 주세요.', 401);
  const credential = await tokenHash(token);
  return callSchedule(env, mutation ? { action: 'employee-write', credential, body } : { action: 'employee-read', credential, month: url.searchParams.get('month') });
}
