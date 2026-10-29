import { $, el, api, status, today, weekOf, addDays, dateLabel, randomToken } from '../shared.js';
let data; let busy = false; let dirty = false; let pendingEmployee;
let viewWeek = addDays(weekOf(today()), 7);
const employeeName = id => data.employees.find(e => e.id === id)?.name || '사용 중지된 직원';
function setDirty(value) { dirty = value; $('#draftState').textContent = value ? '저장하지 않은 변경이 있습니다.' : '작성 중인 배정은 확정 전까지 직원에게 표시되지 않습니다.'; }
function login() { data = null; dirty = false; $('#dashboard').hidden = true; $('#logout').hidden = true; $('#loginPanel').hidden = false; $('#employees').replaceChildren(); $('#weekDays').replaceChildren(); $('#requests').replaceChildren(); $('#inviteDialog').close(); }
function noUnsavedChanges() { if (dirty) { status('작성 중인 배정을 먼저 임시 저장해 주세요.', true); return false; } return true; }
async function run(action, success) {
  if (busy) return false; busy = true; $('#dashboard').inert = true;
  try { await action(); busy = false; const loaded = await load(viewWeek); if (!loaded) return false; status(success); return true; }
  catch (error) { if (error.status === 401) login(); status(error.message, true); return false; }
  finally { busy = false; $('#dashboard').inert = false; }
}
const write = body => api('/api/staff/admin', body);
function invitation(name, token) { $('#inviteTitle').textContent = `${name} 님 전용 링크`; $('#inviteLink').value = `${location.origin}/staff/#key=${token}`; $('#copyStatus').textContent = ''; $('#inviteDialog').showModal(); }
function nameList(ids) { return ids.map(employeeName).join(', ') || '없음'; }
function renderDays() {
  $('#weekDays').replaceChildren();
  for (let i = 0; i < 7; i++) {
    const date = addDays(data.schedule.week, i); const all = data.availability[date.slice(0, 7)] || {}; const past = date < data.today;
    const assigned = data.schedule.draft[date] || []; const required = data.schedule.required[date];
    const card = el('article', null, 'week-day'); const heading = el('div', null, 'day-heading'); heading.append(el('h3', dateLabel(date)));
    const label = el('label', null, 'required-label'); label.append(el('span', '필요 인원')); const input = el('input'); input.type = 'number'; input.min = '0'; input.max = '10'; input.step = '1'; input.value = required; input.disabled = past; input.setAttribute('aria-label', `${dateLabel(date)} 필요 인원`);
    input.onchange = () => { const value = Number(input.value); if (!Number.isInteger(value) || value < 0 || value > 10) { input.value = data.schedule.required[date]; return; } data.schedule.required[date] = value; setDirty(true); renderDays(); }; label.append(input); heading.append(label); card.append(heading);
    const choices = el('div', null, 'staff-choices');
    const available = data.employees.filter(e => (e.active && all[e.id]?.dates.includes(date)) || assigned.includes(e.id));
    for (const e of available) {
      const choice = el('label', null, 'staff-choice'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = assigned.includes(e.id); checkbox.disabled = past || (!e.active && !checkbox.checked); checkbox.setAttribute('aria-label', `${dateLabel(date)} ${e.name} 배정`);
      checkbox.onchange = () => { data.schedule.draft[date] = checkbox.checked ? [...assigned, e.id] : assigned.filter(id => id !== e.id); setDirty(true); renderDays(); };
      choice.append(checkbox, el('span', `${e.name}${!all[e.id]?.dates.includes(date) ? ' · 가능일 변경됨' : ''}${!e.active ? ' · 사용 중지' : ''}`)); choices.append(choice);
    }
    if (!available.length) choices.append(el('p', '근무 가능한 직원이 없습니다.', 'small'));
    card.append(choices); const detail = el('div', null, 'day-details');
    detail.append(el('p', `배정 ${assigned.length} / 필요 ${required}명${required === 0 ? ' · 휴무' : ''}`, assigned.length !== required ? 'day-warning' : ''));
    const unsubmitted = data.employees.filter(e => e.active && !all[e.id]?.submittedAt); const unavailable = data.employees.filter(e => e.active && all[e.id]?.submittedAt && !all[e.id].dates.includes(date));
    if (unsubmitted.length) detail.append(el('p', `미제출: ${nameList(unsubmitted.map(e => e.id))}`));
    if (unavailable.length) detail.append(el('p', `불가: ${nameList(unavailable.map(e => e.id))}`));
    detail.append(el('p', data.schedule.published ? `직원에게 공개된 배정: ${nameList(data.schedule.published.assignments[date] || [])} · ${data.schedule.published.start} ~ ${data.schedule.published.end}` : '직원에게 아직 공개되지 않았습니다.'));
    card.append(detail); $('#weekDays').append(card);
  }
}
function renderEmployees() {
  $('#employees').replaceChildren();
  if (!data.employees.length) $('#employees').append(el('p', '직원을 추가하면 전용 링크가 발급됩니다.', 'small section-description'));
  for (const employee of data.employees) {
    const card = el('div', null, 'employee-card'); card.append(el('h3', `${employee.name}${employee.active ? '' : ' · 사용 중지'}`));
    for (const [month, availability] of Object.entries(data.availability)) {
      const entry = availability[employee.id]; card.append(el('p', `${month} · ${entry?.submittedAt ? `${entry.dates.length}일 가능 · 제출 완료` : '미제출'}`, 'small'));
      if (entry?.note) card.append(el('p', entry.note, 'small employee-note'));
    }
    const actions = el('div', null, 'employee-actions');
    if (employee.active) {
      const rotate = el('button', '링크 재발급'); rotate.onclick = async () => {
        if (!noUnsavedChanges() || !confirm(`${employee.name} 님의 이전 링크와 접속 권한을 만료시키고 새 링크를 발급할까요?`)) return;
        const token = randomToken(); if (await run(() => write({ op: 'employee.rotate', id: employee.id, token }), '새 링크를 발급했습니다.')) invitation(employee.name, token);
      };
      const archive = el('button', '사용 중지'); archive.onclick = () => { if (noUnsavedChanges() && confirm(`${employee.name} 님의 접속을 중지할까요? 기존 근무 이력은 보존됩니다.`)) run(() => write({ op: 'employee.archive', id: employee.id }), '직원 접속을 중지했습니다.'); }; actions.append(rotate, archive);
    }
    const remove = el('button', '삭제'); remove.onclick = () => { if (noUnsavedChanges() && confirm(`${employee.name} 님의 직원 정보와 가능일을 삭제할까요? 확정 근무 이력이 있는 직원은 삭제할 수 없습니다.`)) run(() => write({ op: 'employee.delete', id: employee.id }), '직원 정보를 삭제했습니다.'); }; actions.append(remove); card.append(actions); $('#employees').append(card);
  }
}
function renderRequests() {
  $('#requests').replaceChildren(); $('#requestCount').textContent = `${data.requests.length}건 대기 · 전체 기간`;
  if (!data.requests.length) $('#requests').append(el('p', '대기 중인 변경 요청이 없습니다.', 'small'));
  for (const item of data.requests) {
    const card = el('div', null, 'request-item'); card.append(el('h3', `${employeeName(item.employeeId)} · ${dateLabel(item.date)} · ${item.available ? '근무 가능' : '근무 불가'}`), el('p', item.reason));
    const actions = el('div', null, 'request-actions');
    for (const [decision, text] of [['approved', '승인'], ['rejected', '반려']]) {
      const button = el('button', text); button.onclick = () => {
        if (!noUnsavedChanges()) return;
        if (decision === 'approved' && !item.available && !confirm('승인하면 이 직원의 해당 날짜 확정 배정이 해제됩니다. 승인할까요?')) return;
        run(() => write({ op: 'request.resolve', id: item.id, decision }), decision === 'approved' ? '변경 요청을 승인했습니다. 해당 날짜의 필요 인원을 확인해 주세요.' : '변경 요청을 반려했습니다.');
      }; actions.append(button);
    }
    card.append(actions); $('#requests').append(card);
  }
}
function render() {
  const week = data.schedule.week; $('#week').value = week; $('#weekTitle').textContent = `${dateLabel(week)} — ${dateLabel(addDays(week, 6))}`;
  $('#publishedState').textContent = data.schedule.published ? '확정본 공개 중' : '미확정';
  $('#confirmationDate').textContent = `확정 기준일: ${dateLabel(addDays(week, -7))} · 월요일에 다음 주 근무표를 확정해 주세요.`;
  $('#shiftStart').value = data.schedule.start; $('#shiftEnd').value = data.schedule.end;
  $('#shiftStart').disabled = week < data.today; $('#shiftEnd').disabled = week < data.today;
  $('#dashboard').hidden = false; $('#loginPanel').hidden = true; $('#logout').hidden = false; setDirty(false); renderDays(); renderEmployees(); renderRequests();
  $('#saveDraft').disabled = addDays(week, 6) < data.today; $('#publish').disabled = addDays(week, 6) < data.today;
}
async function load(week = viewWeek) {
  if (busy) return false; busy = true; $('#dashboard').inert = true;
  try { const result = await api(`/api/staff/admin?week=${encodeURIComponent(week)}`); data = result; viewWeek = data.schedule.week; render(); status(''); return true; }
  catch (error) { if (error.status === 401) login(); status(error.message, true); return false; }
  finally { busy = false; $('#dashboard').inert = false; }
}
async function navigate(week) { if (busy || (dirty && !confirm('저장하지 않은 배정이 있습니다. 변경 내용을 버리고 이동할까요?'))) { if (data) $('#week').value = data.schedule.week; return; } await load(week); if (data) $('#week').value = data.schedule.week; }
$('#week').onchange = () => { if ($('#week').value) navigate(weekOf($('#week').value)); }; $('#previous').onclick = () => navigate(addDays(viewWeek, -7)); $('#next').onclick = () => navigate(addDays(viewWeek, 7)); $('#refresh').onclick = () => navigate(viewWeek);
for (const id of ['shiftStart', 'shiftEnd']) $(`#${id}`).onchange = () => { data.schedule.start = $('#shiftStart').value; data.schedule.end = $('#shiftEnd').value; setDirty(true); };
async function saveDraft() {
  return run(() => write({ op: 'week.save', week: data.schedule.week, version: data.schedule.version, assignments: data.schedule.draft, required: data.schedule.required, start: data.schedule.start, end: data.schedule.end }), '배정을 임시 저장했습니다. 직원에게는 확정 후 표시됩니다.');
}
$('#saveDraft').onclick = saveDraft;
$('#publish').onclick = async () => {
  if (busy || !confirm(`${dateLabel(viewWeek)}부터 한 주의 근무표를 확정해 직원에게 공개할까요?`)) return;
  if (dirty && !await saveDraft()) return;
  await run(() => write({ op: 'week.publish', week: data.schedule.week, version: data.schedule.version }), '근무표를 확정했습니다. 직원 페이지에 반영되었습니다.');
};
$('#print').onclick = () => { if (dirty) { status('배정을 저장한 뒤 인쇄해 주세요.', true); return; } window.print(); };
$('#addEmployee').onsubmit = async event => {
  event.preventDefault(); if (!noUnsavedChanges()) return;
  const name = $('#employeeName').value.trim();
  if (pendingEmployee && pendingEmployee.name !== name) { status('먼저 이전 이름으로 다시 제출해 등록 결과를 확인해 주세요.', true); return; }
  pendingEmployee ||= { op: 'employee.add', id: crypto.randomUUID(), name, token: randomToken() };
  if (await run(() => write(pendingEmployee), '직원을 등록했습니다. 전용 링크를 전달해 주세요.')) { const token = pendingEmployee.token; pendingEmployee = null; $('#employeeName').value = ''; invitation(name, token); }
};
$('#closeInvite').onclick = () => $('#inviteDialog').close(); $('#inviteDialog').onclose = () => { $('#inviteLink').value = ''; $('#copyStatus').textContent = ''; };
$('#copyInvite').onclick = async () => { try { await navigator.clipboard.writeText($('#inviteLink').value); $('#copyStatus').textContent = '복사했습니다.'; } catch { $('#inviteLink').focus(); $('#inviteLink').select(); $('#copyStatus').textContent = '주소를 선택했습니다. 직접 복사해 주세요.'; } };
$('#loginForm').onsubmit = async event => {
  event.preventDefault(); $('#loginButton').disabled = true;
  try { await api('/api/staff/admin/login', { password: $('#password').value }); $('#password').value = ''; await load(); status(''); } catch (error) { status(error.message, true); } finally { $('#loginButton').disabled = false; }
};
$('#logout').onclick = async () => { if (busy || (dirty && !confirm('저장하지 않은 배정이 있습니다. 로그아웃할까요?'))) return; try { await api('/api/staff/admin/logout', {}); login(); status('로그아웃했습니다.'); } catch (error) { status(error.message, true); } };
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
await load();
