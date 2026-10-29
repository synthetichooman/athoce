import { $, el, api, status, dateLabel, monthDates, monthMove } from './shared.js';
let data; let selected = new Set(); let busy = false; let dirty = false; let pendingRequest;
const days = ['일', '월', '화', '수', '목', '금', '토'];
const isCore = () => data.employee.role === 'core';
function accessible(date) { return date >= data.today && !data.locked.includes(date) && (isCore() || data.slots[date]?.state === 'open' || selected.has(date)); }
function setDirty(value) { dirty = value; $('#saveState').textContent = value ? '아직 제출하지 않은 변경이 있습니다.' : data.availability.submittedAt ? `제출 완료 · ${new Date(data.availability.submittedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : '선택 후 제출해 주세요. 가능일이 없어도 제출할 수 있습니다.'; }
function renderCalendar() {
  $('#calendar').replaceChildren();
  const dates = monthDates(data.month); const offset = new Date(`${dates[0]}T00:00:00Z`).getUTCDay();
  for (let i = 0; i < offset; i++) $('#calendar').append(el('div'));
  for (const date of dates) {
    const confirmed = data.confirmed.some(s => s.date === date); const locked = data.locked.includes(date); const slot = data.slots[date];
    const label = confirmed ? '근무 확정' : date < data.today ? '지난 날짜' : locked ? slot?.state === 'published' ? '확정된 주' : '입력 마감' : selected.has(date) ? isCore() ? '근무 예정' : '신청' : isCore() ? '선택' : slot?.state === 'open' ? `${slot.remaining || 1}자리 모집` : slot?.state === 'covered' ? '직원 배정' : '신청 전';
    const button = el('button', null, 'day'); button.type = 'button'; button.dataset.date = date; button.disabled = busy || !accessible(date); button.dataset.today = String(date === data.today);
    button.setAttribute('aria-pressed', String(selected.has(date))); button.setAttribute('aria-label', `${dateLabel(date)} ${label}`);
    button.append(el('span', String(Number(date.slice(-2)))), el('span', label));
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
  const openDates = monthDates(data.month).filter(d => d >= data.today && data.slots[d]?.state === 'open');
  $('#roleLabel').textContent = isCore() ? '01 / 아토스 직원' : '02 / 스태프';
  $('#pageHeading').textContent = isCore() ? '근무 요일 입력' : '빈 날짜 근무 신청';
  $('#introText').textContent = isCore() ? '먼저 근무할 날짜를 입력해 주세요. 아토스 직원 3명의 입력이 끝나면 관리자가 남은 날짜의 스태프 신청을 엽니다.' : '아토스 직원 배정 후 남은 날짜만 신청할 수 있습니다. 신청은 선착순 확정이 아니며, 관리자가 월요일에 다음 주 근무표를 확정합니다.';
  $('#introHint').textContent = isCore() ? '매월 25일까지 다음 달 일정을 입력해 주세요. 스태프 신청이 열린 주는 입력이 마감됩니다.' : '신청 전·직원 배정 날짜는 선택할 수 없습니다. 신청이 열리면 본인 전용 링크에서 새로고침해 주세요.';
  $('#availabilityTitle').textContent = isCore() ? '근무할 날짜 선택' : '신청 가능한 날짜';
  $('#slotSummary').textContent = isCore() ? '반복 요일로 한 번에 선택하거나 날짜를 직접 눌러 주세요.' : openDates.length ? `신청 열린 날짜 ${openDates.length}일 · 중복 신청 후 관리자가 배정합니다.` : '현재 신청 가능한 날짜가 없습니다. 아토스 직원 입력 또는 관리자 신청 오픈을 기다려 주세요.';
  $('#save').textContent = isCore() ? '근무 요일 제출' : '선택한 날짜 신청';
  $('#confirmedHint').textContent = isCore() ? '입력한 요일은 스태프 신청을 열 때 배정에 반영되며, 최종 확정 후 여기에 표시됩니다.' : '신청한 날짜 중 관리자가 배정하고 확정한 근무만 표시됩니다.';
  $('#legendSelected').textContent = isCore() ? '근무 예정' : '신청';
  $('#legendOther').textContent = isCore() ? '선택 안 함' : '신청 전 / 직원 배정';
  $('#employeeName').textContent = `${data.employee.name} 님`; $('#month').value = data.month;
  const current = data.today.slice(0, 7); $('#month').min = monthMove(current, -1); $('#month').max = monthMove(current, 12);
  selected = new Set(data.availability.dates); $('#note').value = data.availability.note; setDirty(false); renderCalendar();
  $('#confirmed').replaceChildren();
  if (!data.confirmed.length) $('#confirmed').append(el('p', '이 달에 확정된 근무가 없습니다.', 'small'));
  for (const shift of data.confirmed) { const line = el('div', null, 'shift-line'); line.append(el('span', dateLabel(shift.date)), el('span', `${shift.start} ~ ${shift.end}`)); $('#confirmed').append(line); }
  $('#requestDate').replaceChildren();
  const options = data.locked.filter(d => d >= data.today && data.slots[d]?.state === 'published');
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
$('#refreshAvailability').onclick = () => navigate(data.month);
$('#previous').onclick = () => navigate(monthMove(data.month, -1)); $('#next').onclick = () => navigate(monthMove(data.month, 1)); $('#month').onchange = () => navigate($('#month').value);
$('#note').oninput = () => setDirty(true);
$('#save').onclick = async () => {
  if (busy) return; busy = true; $('#workspace').inert = true; status('가능일을 저장하고 있습니다.');
  try { await api('/api/staff/me', { op: 'availability.save', month: data.month, dates: [...selected].sort(), note: $('#note').value, version: data.availability.version }); dirty = false; busy = false; if (!await load(data.month)) return; status(isCore() ? '근무 요일을 제출했습니다. 남은 날짜는 관리자가 스태프에게 공개합니다.' : '근무 신청을 제출했습니다. 월요일 최종 확정 후 배정된 근무를 확인해 주세요.'); }
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
