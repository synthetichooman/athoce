import { saveSubmission } from '../_recruit-store.js';
export const DAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
export async function onRequestPost({ request, env }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ ok: false, message: '이 페이지에서 직접 제출해 주세요.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ ok: false, message: '잘못된 요청입니다.' }, 415);
  const raw = await request.text();
  if (raw.length > 32768) return json({ ok: false, message: '입력 내용이 너무 깁니다.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, message: '잘못된 요청입니다.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.website) return json({ ok: false, message: '잘못된 요청입니다.' }, 400);
  const fields = {};
  for (const key of ['fullName', 'instagram', 'phoneFirst', 'phoneMiddle', 'phoneLast', 'introduction']) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!value || value.length > (key === 'introduction' ? 5000 : 100)) return json({ ok: false, message: '필수 항목과 입력 길이를 확인해 주세요.' }, 400);
    fields[key] = value;
  }
  if (!/^\d{2,4}$/.test(fields.phoneFirst) || !/^\d{3,4}$/.test(fields.phoneMiddle) || !/^\d{4}$/.test(fields.phoneLast)) return json({ ok: false, message: '연락처를 확인해 주세요.' }, 400);
  if (!Array.isArray(body.availableDays) || body.availableDays.length < 1 || body.availableDays.length > 7 || body.availableDays.some(day => !DAYS.includes(day))) return json({ ok: false, message: '근무 가능 요일을 하나 이상 선택해 주세요.' }, 400);
  fields.availableDays = DAYS.filter(day => body.availableDays.includes(day));
  if (body.submissionId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId)) return json({ ok: false, message: '잘못된 접수 번호입니다. 페이지를 새로고침해 주세요.' }, 400);
  try {
    const record = await saveSubmission(env, fields, body.submissionId || crypto.randomUUID());
    return json({ ok: true, code: record.code, message: '지원서가 정상적으로 접수되었습니다.' });
  } catch (error) {
    return json({ ok: false, code: error.code || 'STORAGE_UNAVAILABLE', message: error.code === 'SUBMISSION_CONFLICT'
      ? '이 접수 번호로 이미 지원서가 저장되었습니다. 관리자에게 접수 내용을 확인해 주세요.'
      : '접수 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.' }, error.code === 'SUBMISSION_CONFLICT' ? 409 : 503);
  }
}
