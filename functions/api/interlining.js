import { saveSubmission } from '../_interlining-store.js';

const FIELDS = ['fullName', 'instagram', 'phoneFirst', 'phoneMiddle', 'phoneLast', 'address', 'addressDetail', 'postcode', 'guests', 'filmingConsent'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ ok: false, message: '이 페이지에서 직접 제출해 주세요.' }, 403);
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 415);
  }
  const raw = await request.text();
  if (raw.length > 8192) return json({ ok: false, message: '입력 내용이 너무 깁니다.' }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.website) {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400);
  }
  const fields = {};
  for (const key of FIELDS) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    const maxLength = key === 'address' || key === 'addressDetail' ? 300 : 100;
    if (!value || value.length > maxLength) {
      return json({ ok: false, message: '필수 항목을 확인해 주세요.' }, 400);
    }
    fields[key] = value;
  }
  if (!/^\d{2,4}$/.test(fields.phoneFirst) || !/^\d{3,4}$/.test(fields.phoneMiddle) ||
      !/^\d{4}$/.test(fields.phoneLast) || !/^\d{5}$/.test(fields.postcode)) {
    return json({ ok: false, message: '연락처와 우편번호를 확인해 주세요.' }, 400);
  }
  if (!['0', '1', '2', '3', 'etc'].includes(fields.guests) || fields.filmingConsent !== '동의') {
    return json({ ok: false, message: '동반인원 수와 촬영 동의를 확인해 주세요.' }, 400);
  }
  const guestsDetail = typeof body.guestsDetail === 'string' ? body.guestsDetail.trim() : '';
  if (fields.guests === 'etc' && (!guestsDetail || guestsDetail.length > 100)) {
    return json({ ok: false, message: '동반인원 수를 직접 입력해 주세요.' }, 400);
  }

  if (body.submissionId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId)) {
    return json({ ok: false, message: '잘못된 접수 번호입니다. 페이지를 새로고침해 주세요.' }, 400);
  }
  try {
    const record = await saveSubmission(env, { ...fields, guestsDetail: fields.guests === 'etc' ? guestsDetail : '' }, body.submissionId || crypto.randomUUID());
    return json({ ok: true, code: record.code, message: '정상적으로 접수되었습니다.' });
  } catch (error) {
    return json({ ok: false, code: error.code || 'STORAGE_UNAVAILABLE', message: error.code === 'SUBMISSION_CONFLICT'
      ? '이 접수 번호로 이미 신청이 저장되었습니다. 관리자에게 접수 내용을 확인해 주세요.'
      : '접수 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.' }, error.code === 'SUBMISSION_CONFLICT' ? 409 : 503);
  }
}
