export const $ = selector => document.querySelector(selector);
export function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
export function dateLabel(date) { return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T12:00:00+09:00`)); }
export function addDays(date, n) { return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
export function weekOf(date) { return addDays(date, -(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7); }
export function today() { return new Date(Date.now() + 32400000).toISOString().slice(0, 10); }
export function monthMove(month, n) { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + n); return date.toISOString().slice(0, 7); }
export function monthDates(month) { const list = []; let d = `${month}-01`; while (d.startsWith(month)) { list.push(d); d = addDays(d, 1); } return list; }
export function status(message, error = false) { $('#status').textContent = message; $('#status').dataset.error = String(error); }
export async function api(path, body) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok || !result.ok) { const error = new Error(result.error?.message || '요청을 완료하지 못했습니다.'); error.status = response.status; throw error; } return result;
}
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
