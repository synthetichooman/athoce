export const STAFF_COOKIE = 'athoce_staff_access';
export const DEFAULT_SETTINGS = Object.freeze({ submissionDay: 25, confirmationWeekday: 1, shiftStart: '13:00', shiftEnd: '20:00' });
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}
export const fail = (message, status = 400) => json({ ok: false, error: { message } }, status);
export function today(now = Date.now()) { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
export function addDays(date, count) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10); }
export function nextMonth(date = today()) { const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); }
export function weekOf(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, -(day + 6) % 7); }
export function monthDates(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month || '')) return [];
  const result = []; let date = `${month}-01`;
  while (date.startsWith(month)) { result.push(date); date = addDays(date, 1); }
  return result;
}
export function allowedMonth(month) {
  if (!monthDates(month).length) return false;
  const current = today().slice(0, 7); const index = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5));
  return index(month) >= index(current) - 1 && index(month) <= index(current) + 12;
}
export function validWeek(week) { return /^20\d{2}-\d{2}-\d{2}$/.test(week || '') && monthDates(week.slice(0, 7)).includes(week) && weekOf(week) === week && allowedMonth(week.slice(0, 7)); }
export async function tokenHash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join(''); }
export function employeeToken(request) { return (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${STAFF_COOKIE}=`))?.slice(STAFF_COOKIE.length + 1) || ''; }
export const staffCookie = token => `${STAFF_COOKIE}=${token}; Path=/api/staff; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? 2592000 : 0}`;
export async function callSchedule(env, payload) {
  if (!env.STAFF_SCHEDULE) return fail('근무표 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
  try { return await env.STAFF_SCHEDULE.get(env.STAFF_SCHEDULE.idFromName('athoce-staff')).fetch('https://staff.internal/', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }); }
  catch { return fail('저장 결과를 확인하지 못했습니다. 새로고침한 뒤 내용을 확인해 주세요.', 503); }
}
