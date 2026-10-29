import { $, el, api, status, dateLabel, monthDates, monthMove } from './shared.js';
let data; let selected = new Set(); let busy = false; let dirty = false; let pendingRequest;
const days = ['일', '월', '화', '수', '목', '금', '토'];
function accessible(date) { return date >= data.today && !data.locked.includes(date); }
function setDirty(value) { dirty = value; $('#saveState').textContent = value ? '아직 제출하지 않은 변경이 있습니다.' : data.availability.submittedAt ? `제출 완료 · ${new Date(data.availability.submittedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : '선택 후 제출해 주세요. 가능일이 없어도 제출할 수 있습니다.'; }
function renderCalendar() {
  $('#calendar').replaceChildren();
  const dates = monthDates(data.month); const offset = new Date(`${dates[0]}T00:00:00Z`).getUTCDay();
  for (let i = 0; i < offset; i++) $('#calendar').append(el('div'));
  for (const date of dates) {
    const confirmed = data.confirmed.some(s => s.date === date); const locked = data.locked.includes(date);
    const button = el('button', null, 'day'); button.type = 'button'; button.dataset.date = date; button.disabled = busy || !accessible(date); button.dataset.today = String(date === data.today);
    button.setAttribute('aria-pressed', String(selected.has(date))); button.setAttribute('aria-label', `${dateLabel(date)} ${confirmed ? '근무 확정' : selected.has(date) ? '근무 가능' : '선택 안 함'}${locked ? ', 확정된 주' : ''}`);
    button.append(el('span', String(Number(date.slice(-2)))), el('span', confirmed ? '근무 확정' : date < data.today ? '지난 날짜' : locked ? '확정된 주' : selected.has(date) ? '가능' : '—'));
    button.addEventListener('click', () => { if (selected.has(date)) selected.delete(date); else selected.add(date); setDirty(true); renderCalendar(); document.querySelector(`[data-date="${date}"]`)?.focus(); }); $('#calendar').append(button);
  }
  $('#selectedCount').textContent = `${selected.size}일 선택`;
  $('#weekdayButtons').replaceChildren();
  days.forEach((day, i) => {
    const datesForDay = dates.filter(d => accessible(d) && new Date(`${d}T00:00:00Z`).getUTCDay() === i);
    const all = datesForDay.length > 0 && datesForDay.every(d => selected.has(d)); const button = el('button', day); button.type = 'button'; button.disabled = busy || !datesForDay.length; button.setAttribute('aria-pressed', String(all)); button.setAttribute('aria-label', `${day}요일 모두 ${all ? '해제' : '선택'}`);
    button.addEventListener('click', () => { datesForDay.forEach(d => all ? selected.delete(d) : selected.add(d)); setDirty(true); renderCalendar(); }); $('#weekdayButtons').append(button);
  });
}
function render() {
  $('#workspace').hidden = false; $('#welcome').hidden = true; $('#logout').hidden = false;
  $('#employeeName').textContent = `${data.employee.name} 님`; $('#month').value = data.month;
  const current = data.today.slice(0, 7); $('#month').min = monthMove(current, -1); $('#month').max = monthMove(current, 12);
  selected = new Set(data.availability.dates); $('#note').value = data.availability.note; setDirty(false); renderCalendar();
  $('#confirmed').replaceChildren();
  if (!data.confirmed.length) $('#confirmed').append(el('p', '이 달에 확정된 근무가 없습니다.', 'small'));
  for (const shift of data.confirmed) { const line = el('div', null, 'shift-line'); line.append(el('span', dateLabel(shift.date)), el('span', `${shift.start} ~ ${shift.end}`)); $('#confirmed').append(line); }
  $('#requestDate').replaceChildren();
  const options = data.locked.filter(d => d >= data.today);
  for (const date of options) { const option = el('option', dateLabel(date)); option.value = date; $('#requestDate').append(option); }
  if (!options.length) $('#requestDate').append(el('option', '변경 가능한 확정 날짜가 없습니다.'));
  $('#requestForm').querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = !options.length; });
  $('#requests').replaceChildren();
  for (const item of data.requests.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const row = el('div', null, 'request-item'); row.append(el('p', `${dateLabel(item.date)} · ${item.available ? '근무 가능' : '근무 불가'} · ${{ pending: '승인 대기', approved: '승인됨', rejected: '반려됨' }[item.status]}`), el('p', item.reason)); $('#requests').append(row);
  }
}
function loggedOut() { data = null; dirty = false; $('#workspace').hidden = true; $('#welcome').hidden = false; $('#logout').hidden = true; $('#calendar').replaceChildren(); $('#confirmed').replaceChildren(); $('#requests').replaceChildren(); $('#note').value = ''; }
async function load(month = $('#month').value) {
  if (busy) return; busy = true; $('#workspace').inert = true;
  try { data = await api(`/api/staff/me${month ? `?month=${encodeURIComponent(month)}` : ''}`); render(); status(''); return true; }
  catch (error) { if (error.status === 401) loggedOut(); status(error.message, true); return false; }
  finally { busy = false; $('#workspace').inert = false; if (data) renderCalendar(); }
}
async function navigate(month) {
  if (busy || (dirty && !confirm('아직 제출하지 않은 변경이 있습니다. 저장하지 않고 이동할까요?'))) { if (data) $('#month').value = data.month; return; }
  await load(month); if (data) $('#month').value = data.month;
}
$('#previous').onclick = () => navigate(monthMove(data.month, -1)); $('#next').onclick = () => navigate(monthMove(data.month, 1)); $('#month').onchange = () => navigate($('#month').value);
$('#note').oninput = () => setDirty(true);
$('#save').onclick = async () => {
  if (busy) return; busy = true; $('#workspace').inert = true; status('가능일을 저장하고 있습니다.');
  try { await api('/api/staff/me', { op: 'availability.save', month: data.month, dates: [...selected].sort(), note: $('#note').value, version: data.availability.version }); dirty = false; busy = false; if (!await load(data.month)) return; status('근무 가능일을 제출했습니다. 확정 근무는 아래에서 확인해 주세요.'); }
  catch (error) { status(`${error.message}${error.status === 409 ? ' 새로고침하면 서버에 저장된 내용을 확인할 수 있습니다.' : ''}`, true); if (error.status === 401) loggedOut(); }
  finally { busy = false; $('#workspace').inert = false; }
};
$('#requestForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  if (dirty) { status('가능일 변경을 먼저 제출한 뒤 요청해 주세요.', true); return; }
  busy = true; $('#workspace').inert = true;
  try {
    const fields = { date: $('#requestDate').value, available: $('#requestAvailable').value === 'true', reason: $('#requestReason').value };
    if (pendingRequest && (pendingRequest.date !== fields.date || pendingRequest.available !== fields.available || pendingRequest.reason !== fields.reason)) throw new Error('먼저 이전 내용으로 다시 제출해 접수 결과를 확인해 주세요.');
    pendingRequest ||= { op: 'request.add', id: crypto.randomUUID(), ...fields };
    await api('/api/staff/me', pendingRequest); pendingRequest = null; $('#requestReason').value = ''; busy = false; if (!await load(data.month)) return; status('변경 요청을 보냈습니다. 관리자 승인 후 반영됩니다.');
  }
  catch (error) { if (error.status && error.status < 500) pendingRequest = null; status(error.message, true); }
  finally { busy = false; $('#workspace').inert = false; }
};
$('#logout').onclick = async () => {
  if (busy || (dirty && !confirm('저장하지 않은 변경이 있습니다. 로그아웃할까요?'))) return;
  try { await api('/api/staff/logout', {}); loggedOut(); status('로그아웃했습니다. 다시 접속하려면 전용 링크를 사용해 주세요.'); } catch (error) { status(error.message, true); }
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try {
  const token = new URLSearchParams(location.hash.slice(1)).get('key');
  if (token) { history.replaceState(null, '', location.pathname); await api('/api/staff/login', { token }); }
  await load();
} catch (error) { loggedOut(); status(error.message, true); }
