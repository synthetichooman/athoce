import { recruitAccess } from '../../../_recruit-access.js';
import { failure, manager } from '../../../_recruit-rsvp.js';
export async function onRequestGet({ env, request }) {
  if (!(await recruitAccess(request, env))) return failure('UNAUTHORIZED', '채용 관리자 로그인이 필요합니다.', 401);
  return manager(env, '/reservations');
}
export async function onRequestDelete({ env, request }) {
  if (!(await recruitAccess(request, env))) return failure('UNAUTHORIZED', '채용 관리자 로그인이 필요합니다.', 401);
  if (request.headers.get('origin') !== new URL(request.url).origin) return failure('ORIGIN', '관리자 화면에서 취소해 주세요.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return failure('CONTENT_TYPE', '잘못된 요청입니다.', 415);
  const raw = await request.text();
  if (raw.length > 512) return failure('TOO_LARGE', '잘못된 요청입니다.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return failure('INVALID_INPUT', '잘못된 요청입니다.'); }
  if (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return failure('INVALID_INPUT', '예약 번호를 확인해 주세요.');
  return manager(env, '/reservations', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: body.id }) });
}
