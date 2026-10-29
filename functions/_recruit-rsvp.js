export const EVENT = Object.freeze({
  id: 'interview-2026-10-30', date: '2026-10-30', dateLabel: '2026년 10월 30일 (금)',
  location: '방울내로 56, 아토스 서울', timeZone: 'Asia/Seoul', durationMinutes: 30,
});
export const SLOTS = Object.freeze(Array.from({ length: 14 }, (_, i) => {
  const minutes = 13 * 60 + i * 30;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const end = minutes + 30;
  return Object.freeze({ time, end: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`, startsAt: `${EVENT.date}T${time}:00+09:00` });
}));
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
export function failure(code, message, status = 400) { return json({ ok: false, error: { code, message } }, status); }
export function validateBooking(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.website) return null;
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const phone = typeof body.phone === 'string' && /^[0-9\s()-]{9,24}$/.test(body.phone) ? body.phone.replace(/\D/g, '') : '';
  const id = typeof body.submissionId === 'string' ? body.submissionId : '';
  if (!fullName || fullName.length > 100 || /[\u0000-\u001f\u007f]/.test(fullName) || !/^0[1-9]\d{7,9}$/.test(phone) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '') || !SLOTS.some(slot => slot.time === body.slot)) return null;
  return { id, fullName, phone, slot: body.slot };
}
export async function manager(env, path, options) {
  if (!env.RECRUIT_RSVP) return failure('UNAVAILABLE', '예약 시스템에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
  try {
    const stub = env.RECRUIT_RSVP.get(env.RECRUIT_RSVP.idFromName(EVENT.id));
    return await stub.fetch(`https://rsvp.internal${path}`, options);
  } catch { return failure('UNAVAILABLE', '예약 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.', 503); }
}
