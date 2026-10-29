import { failure, manager, validateBooking } from '../../_recruit-rsvp.js';
export const onRequestGet = ({ env }) => manager(env, '/availability');
export async function onRequestPost({ request, env }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return failure('ORIGIN', '이 페이지에서 직접 제출해 주세요.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return failure('CONTENT_TYPE', '잘못된 요청입니다.', 415);
  const raw = await request.text();
  if (raw.length > 4096) return failure('TOO_LARGE', '입력 내용이 너무 깁니다.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return failure('INVALID_INPUT', '입력 내용을 확인해 주세요.'); }
  if (!validateBooking(body)) return failure('INVALID_INPUT', '이름, 연락처와 면접 시간을 확인해 주세요.');
  return manager(env, '/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
