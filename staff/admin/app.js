import { $, el, api, status, today, weekOf, addDays, dateLabel, randomToken, monthMove } from '../shared.js';
import { calendarDates, calendarWeeks, daySummary, monthSummary } from './calendar.js?v=20261029-4';
let data; let busy = false; let dirty = false; let pendingEmployee;
let selectedDate = addDays(weekOf(today()), 7);
let viewWeek = weekOf(selectedDate); let viewMonth = selectedDate.slice(0, 7); let records = new Map();
const minMonth = monthMove(today().slice(0, 7), -1); const maxMonth = monthMove(today().slice(0, 7), 12);
$('#month').min = minMonth; $('#month').max = maxMonth;
const employeeName = id => data.employees.find(e => e.id === id)?.name || '사용 중지된 직원';
function setDirty(value) { dirty = value; $('#draftState').textContent = value ? '저장하지 않은 변경이 있습니다.' : '저장 후 주간 확정을 눌러야 직원에게 공개됩니다.'; if (data) renderOverview(); }
function login() { data = null; records.clear(); dirty = false; $('#dashboard').hidden = true; $('#logout').hidden = true; $('#loginPanel').hidden = false; $('#employees').replaceChildren(); $('#monthCalendar').replaceChildren(); $('#weekDays').replaceChildren(); $('#requests').replaceChildren(); $('#inviteDialog').close(); }
function noUnsavedChanges() { if (dirty) { status('작성 중인 배정을 먼저 임시 저장해 주세요.', true); return false; } return true; }
async function run(action, success) {
  if (busy) return false; busy = true; $('#dashboard').inert = true;
  try { await action(); busy = false; const loaded = await load(selectedDate, viewMonth); if (!loaded) return false; status(success); return true; }
  catch (error) { if (error.status === 401) login(); status(error.message, true); return false; }
  finally { busy = false; $('#dashboard').inert = false; }
}
const write = body => api('/api/staff/admin', body);
function invitation(name, token) { $('#inviteTitle').textContent = `${name} 님 전용 링크`; $('#inviteLink').value = `${location.origin}/staff/#key=${token}`; $('#copyStatus').textContent = ''; $('#inviteDialog').showModal(); }
function nameList(ids) { return ids.map(employeeName).join(', ') || '없음'; }
function renderWorkflow() {
  const staged = data.schedule.workflow === 'staged'; const opened = !!data.schedule.openedAt; const published = !!data.schedule.published;
  const stage = published ? 3 : opened ? 2 : 1;
  document.querySelectorAll('.workflow-step').forEach((node, i) => { node.dataset.state = i + 1 < stage ? 'complete' : i + 1 === stage ? 'current' : 'waiting'; });
  $('#coreProgress').textContent = `${data.workflow.submitted.length} / 3명 입력 완료`;
  const core = data.employees.filter(e => e.active && e.role === 'core');
  $('#corePeople').replaceChildren();
  if (core.length < 3) $('#corePeople').append(el('p', `운영진 ${3 - core.length}명을 더 등록해 주세요.`, 'small'));
  for (const e of core) $('#corePeople').append(el('p', `${e.name} · ${data.workflow.submitted.includes(e.id) ? '입력 완료' : '입력 대기'}`, 'small'));
  const remaining = Object.entries(data.workflow.remaining).filter(([d, n]) => d >= data.today && n > 0);
  const applications = data.employees.filter(e => e.active && e.role === 'staff' && Object.values(data.availability).some(m => m[e.id]?.dates.some(d => remaining.some(([date]) => d === date))));
  $('#slotProgress').textContent = opened ? `${remaining.length}일 신청 중` : '공개 전';
  $('#applicationProgress').textContent = opened ? `스태프 ${applications.length}명 신청` : '';
  $('#finalProgress').textContent = published ? '공개 중' : '월요일에 다음 주 확정';
  $('#openApplications').hidden = !staged || opened || published;
  $('#openApplications').disabled = !data.workflow.ready || addDays(data.schedule.week, 6) < data.today;
  $('#closeApplications').hidden = !staged || !opened || published;
  $('#copyRequest').hidden = !opened || published || !remaining.length;
  $('#stageNotice').textContent = !staged ? '기존 방식으로 작성된 주입니다.' : published ? '확정한 근무표를 직원에게 공개 중입니다.' : opened ? '날짜별 신청자를 배정하고 확정하세요.' : data.workflow.ready ? '운영진 입력 완료. 스태프 신청을 열어 주세요.' : '운영진 3명의 근무일 입력을 기다리고 있습니다.';
  $('#stageNotice').dataset.stage = stage;
}
function renderDays() {
  $('#weekDays').replaceChildren();
  const staged = data.schedule.workflow === 'staged';
  {
    const date = selectedDate; const all = data.availability[date.slice(0, 7)] || {}; const past = date < data.today;
    const assigned = data.schedule.draft[date] || []; const coreIds = staged ? (data.workflow.coreAssignments[date] || []) : [];
    const required = Math.max(data.schedule.required[date], coreIds.length); data.schedule.required[date] = required;
    const remaining = Math.max(0, required - coreIds.length);
    const card = el('article', null, 'week-day'); const heading = el('div', null, 'day-heading');
    const title = el('div', null, 'day-title'); title.append(el('h3', '근무자 선택')); heading.append(title);
    card.append(heading);
    if (staged && coreIds.length) { const coreLine = el('div', null, 'core-assignment'); coreLine.append(el('strong', nameList(coreIds))); card.append(coreLine); }
    const choices = el('div', null, 'staff-choices');
    const available = data.employees.filter(e => ((e.active && all[e.id]?.dates.includes(date)) || assigned.includes(e.id)) && (!staged || e.role === 'staff' || (data.schedule.published && !coreIds.includes(e.id))));
    if (!staged || (data.schedule.openedAt && remaining > 0)) {
      for (const e of available) {
        const choice = el('label', null, 'staff-choice'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = assigned.includes(e.id); checkbox.disabled = past || (!e.active && !checkbox.checked); checkbox.setAttribute('aria-label', `${dateLabel(date)} ${e.name} 배정`);
        checkbox.onchange = () => { data.schedule.draft[date] = checkbox.checked ? [...coreIds, e.id] : assigned.filter(id => id !== e.id); setDirty(true); renderDays(); const focus = document.querySelector(`[data-employee="${e.id}"]`); focus?.focus(); }; checkbox.dataset.employee = e.id;
        choice.append(checkbox, el('span', `${e.name}${!all[e.id]?.dates.includes(date) ? ' · 신청 변경됨' : ''}${!e.active ? ' · 사용 중지' : ''}`)); choices.append(choice);
      }
      if (!available.length) choices.append(el('p', '아직 스태프 신청이 없습니다.', 'small'));
    } else if (remaining > 0) choices.append(el('p', '주간 관리에서 스태프 신청을 열어 주세요.', 'small'));
    else if (available.some(e => assigned.includes(e.id))) {
      for (const e of available.filter(e => assigned.includes(e.id))) { const remove = el('button', `${e.name} 배정 해제`); remove.disabled = past; remove.onclick = () => { data.schedule.draft[date] = assigned.filter(id => id !== e.id); setDirty(true); renderDays(); }; choices.append(remove); }
    }
    card.append(choices); const detail = el('div', null, 'day-details');
    if (data.schedule.published) detail.append(el('p', `공개 중: ${nameList(data.schedule.published.assignments[date] || [])} · ${data.schedule.published.start} ~ ${data.schedule.published.end}`));
    card.append(detail); $('#weekDays').append(card);
  }
}
function renderEmployees() {
  $('#employees').replaceChildren();
  if (!data.employees.length) $('#employees').append(el('p', '직원을 추가하면 전용 링크가 발급됩니다.', 'small section-description'));
  for (const employee of data.employees.slice().sort((a, b) => (a.role === 'core' ? 0 : 1) - (b.role === 'core' ? 0 : 1))) {
    const card = el('div', null, 'employee-card'); card.append(el('span', employee.role === 'core' ? '운영진' : '스태프', 'employee-role'), el('h3', `${employee.name}${employee.active ? '' : ' · 사용 중지'}`));
    for (const [month, availability] of Object.entries(data.availability)) {
      const entry = availability[employee.id]; card.append(el('p', `${month} · ${entry?.submittedAt ? `${entry.dates.length}일 · 입력 완료` : '미제출'}`, 'small'));
      if (entry?.note) card.append(el('p', entry.note, 'small employee-note'));
    }
    const actions = el('div', null, 'employee-actions');
    if (employee.active) {
      const role = el('select'); role.setAttribute('aria-label', `${employee.name} 직원 구분`);
      for (const [value, text] of [['core', '운영진'], ['staff', '스태프']]) { const option = el('option', text); option.value = value; role.append(option); } role.value = employee.role;
      role.onchange = async () => { const value = role.value; role.value = employee.role; if (noUnsavedChanges() && confirm(`${employee.name} 님의 구분을 변경할까요?`)) await run(() => write({ op: 'employee.role', id: employee.id, role: value }), '직원 구분을 변경했습니다.'); }; card.append(role);
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
        run(() => write({ op: 'request.resolve', id: item.id, decision }), decision === 'approved' ? '변경 요청을 승인했습니다. 해당 날짜의 배정을 확인해 주세요.' : '변경 요청을 반려했습니다.');
      }; actions.append(button);
    }
    card.append(actions); $('#requests').append(card);
  }
}
function renderOverview() {
  const summary = monthSummary(viewMonth, records);
  $('#monthTitle').textContent = `${Number(viewMonth.slice(0, 4))}년 ${Number(viewMonth.slice(5))}월`;
  $('#month').value = viewMonth;
  $('#previous').disabled = viewMonth <= minMonth; $('#next').disabled = viewMonth >= maxMonth;
  $('#monthCore').textContent = `${summary.submitted} / 3명`;
  $('#monthOpen').textContent = `${summary.open}일`;
  $('#monthConfirmed').textContent = `${summary.confirmed}일`;
  const calendar = $('#monthCalendar'); const focused = calendar.contains(document.activeElement);
  calendar.replaceChildren();
  for (const date of calendarDates(viewMonth)) {
    const record = records.get(weekOf(date)); const day = daySummary(record, date);
    const cell = el('button', null, 'month-day'); cell.type = 'button'; cell.dataset.date = date;
    cell.dataset.weekday = String(new Date(`${date}T12:00:00+09:00`).getUTCDay());
    cell.dataset.selected = String(date === selectedDate); cell.dataset.week = String(weekOf(date) === viewWeek);
    cell.dataset.outside = String(!date.startsWith(viewMonth)); cell.dataset.today = String(date === data.today); cell.dataset.phase = day.phase;
    cell.tabIndex = date === selectedDate ? 0 : -1; cell.setAttribute('aria-pressed', String(date === selectedDate)); cell.setAttribute('aria-controls', 'dayEditor');
    if (date === data.today) cell.setAttribute('aria-current', 'date');
    const names = day.assigned.map(id => record.employees.find(e => e.id === id)?.name || '사용 중지된 직원');
    cell.setAttribute('aria-label', `${dateLabel(date)} · ${day.label} · 배정 ${names.join(', ') || '없음'} · 신청 ${day.applicants.length}명`);
    const top = el('span', null, 'cell-heading'); top.append(el('span', String(Number(date.slice(-2))), 'cell-date')); if (day.phase === 'changed') top.append(el('span', '수정 중', 'cell-state')); cell.append(top);
    const members = el('span', null, 'cell-members');
    for (const id of day.assigned.slice(0, 3)) {
      const employee = record.employees.find(e => e.id === id);
      const member = el('span', employee?.name || '사용 중지', 'calendar-member'); member.dataset.role = employee?.role || 'staff';
      member.dataset.draft = String(!record.schedule.published?.assignments[date]?.includes(id)); members.append(member);
    }
    if (day.assigned.length > 3) members.append(el('span', `외 ${day.assigned.length - 3}명`, 'cell-extra'));
    cell.append(members);
    const bottom = el('span', null, 'cell-bottom');
    if (!day.required) bottom.append(el('span', '휴무', 'cell-filled'));
    if (day.phase === 'open' && day.applicants.length) bottom.append(el('span', `신청 ${day.applicants.length}`, 'cell-applicants'));
    if (bottom.childElementCount) cell.append(bottom);
    cell.onclick = async () => { if (await navigate(date, date.slice(0, 7))) { $('#dayEditor').open = true; $('#dayEditor').scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
    cell.onkeydown = async event => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      let target;
      if (event.key in offsets) target = addDays(date, offsets[event.key]);
      else if (event.key === 'Home') target = weekOf(date);
      else if (event.key === 'End') target = addDays(weekOf(date), 6);
      if (!target) return; event.preventDefault();
      if (await navigate(target, target.slice(0, 7))) $(`[data-date="${target}"]`)?.focus();
    };
    calendar.append(cell);
  }
  if (focused) $(`[data-date="${selectedDate}"]`)?.focus();
  const day = daySummary(data, selectedDate);
  $('#selectedDateState').textContent = day.label;
}
function render() {
  const week = data.schedule.week;
  $('#selectedDateTitle').textContent = dateLabel(selectedDate);
  $('#weekTitle').textContent = `${dateLabel(week)} — ${dateLabel(addDays(week, 6))}`;
  $('#publishedState').textContent = data.schedule.published ? '확정본 공개 중' : '미확정';
  $('#confirmationDate').textContent = `확정 기준일: ${dateLabel(addDays(week, -7))}`;
  $('#shiftStart').value = data.schedule.start; $('#shiftEnd').value = data.schedule.end;
  $('#shiftStart').disabled = week < data.today; $('#shiftEnd').disabled = week < data.today;
  $('#dashboard').hidden = false; $('#loginPanel').hidden = true; $('#logout').hidden = false;
  setDirty(false); renderWorkflow(); renderDays(); renderEmployees(); renderRequests();
  $('#employeeCount').textContent = `${data.employees.filter(e => e.active).length}명`;
  $('#saveDraft').disabled = addDays(week, 6) < data.today;
  $('#publish').disabled = addDays(week, 6) < data.today || (data.schedule.workflow === 'staged' && !data.schedule.openedAt);
  $('#employeeRole').value = data.employees.filter(e => e.active && e.role === 'core').length < 3 ? 'core' : 'staff';
}
async function load(date = selectedDate, month = viewMonth) {
  if (busy) return false; busy = true; $('#dashboard').inert = true;
  status('한 달 근무표를 불러오고 있습니다.');
  try {
    const results = await Promise.all(calendarWeeks(month).map(week => api(`/api/staff/admin?week=${encodeURIComponent(week)}`)));
    records = new Map(results.map(result => [result.schedule.week, result]));
    selectedDate = date; viewMonth = month; viewWeek = weekOf(date); data = records.get(viewWeek);
    render(); status(''); return true;
  }
  catch (error) { if (error.status === 401) login(); status(error.message, true); return false; }
  finally { busy = false; $('#dashboard').inert = false; $('#month').value = viewMonth; }
}
async function navigate(date, month = viewMonth, refresh = false) {
  if (busy) return false;
  if (month < minMonth || month > maxMonth) { status('지난달부터 앞으로 12개월까지 조회할 수 있습니다.', true); $('#month').value = viewMonth; return false; }
  if (!refresh && date === selectedDate && month === viewMonth) return true;
  if (!refresh && month === viewMonth && weekOf(date) === viewWeek) {
    selectedDate = date; $('#selectedDateTitle').textContent = dateLabel(date); renderOverview(); renderDays(); status(''); return true;
  }
  if (dirty && !confirm('저장하지 않은 배정이 있습니다. 변경 내용을 버리고 이동할까요?')) { $('#month').value = viewMonth; return false; }
  if (dirty || refresh || month !== viewMonth) return load(date, month);
  selectedDate = date; viewWeek = weekOf(date); data = records.get(viewWeek); render(); status(''); return true;
}
function changeMonth(month) { return navigate(month === today().slice(0, 7) ? today() : `${month}-01`, month); }
$('#month').onchange = () => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test($('#month').value)) changeMonth($('#month').value); };
$('#previous').onclick = () => changeMonth(monthMove(viewMonth, -1));
$('#next').onclick = () => changeMonth(monthMove(viewMonth, 1));
$('#today').onclick = () => navigate(today(), today().slice(0, 7));
$('#refresh').onclick = () => navigate(selectedDate, viewMonth, true);
for (const id of ['shiftStart', 'shiftEnd']) $(`#${id}`).onchange = () => { data.schedule.start = $('#shiftStart').value; data.schedule.end = $('#shiftEnd').value; setDirty(true); };
async function saveDraft() {
  return run(() => write({ op: 'week.save', week: data.schedule.week, version: data.schedule.version, assignments: data.schedule.draft, required: data.schedule.required, start: data.schedule.start, end: data.schedule.end }), '배정을 임시 저장했습니다. 직원에게는 확정 후 표시됩니다.');
}
$('#saveDraft').onclick = saveDraft;
$('#openApplications').onclick = async () => {
  if (busy || !confirm('운영진 입력을 마감하고 남은 날짜의 스태프 신청을 열까요?')) return;
  if (dirty && !await saveDraft()) return;
  await run(() => write({ op: 'week.open', week: data.schedule.week, version: data.schedule.version }), '스태프 신청을 열었습니다. 요청 문구와 각자의 전용 링크를 전달해 주세요.');
};
$('#closeApplications').onclick = async () => {
  if (!noUnsavedChanges() || !confirm('스태프 신청을 닫고 운영진 일정을 다시 입력받을까요? 스태프 신청 내역은 보존되지만 임시 배정은 초기화됩니다.')) return;
  await run(() => write({ op: 'week.close', week: data.schedule.week, version: data.schedule.version }), '신청을 닫았습니다. 운영진 일정 수정 후 다시 열어 주세요.');
};
$('#copyRequest').onclick = async () => {
  if (!noUnsavedChanges()) return;
  const dates = Object.entries(data.workflow.remaining).filter(([d, n]) => d >= data.today && n > 0);
  const text = `아토스 스태프 근무 신청 안내\n${dateLabel(data.schedule.week)} ~ ${dateLabel(addDays(data.schedule.week, 6))}\n근무 시간: ${data.schedule.start} ~ ${data.schedule.end}\n신청 가능한 날짜: ${dates.map(([d]) => dateLabel(d)).join(', ')}\n기존에 받은 본인 전용 링크에서 근무 가능한 날짜를 선택해 제출해 주세요.\n신청 후 관리자가 확인하며 월요일에 다음 주 근무표를 확정합니다.`;
  try { await navigator.clipboard.writeText(text); status('요청 문구를 복사했습니다. 스태프에게 직접 전달해 주세요. 첫 접속자는 직원 관리에서 발급한 전용 링크도 함께 전달해 주세요.'); }
  catch { $('#inviteTitle').textContent = '스태프 신청 요청 문구'; $('#inviteLink').value = text; $('#copyStatus').textContent = ''; $('#inviteDialog').showModal(); }
};
$('#publish').onclick = async () => {
  if (busy || !confirm(`${dateLabel(viewWeek)}부터 한 주의 근무표를 확정해 직원에게 공개할까요?`)) return;
  if (dirty && !await saveDraft()) return;
  await run(() => write({ op: 'week.publish', week: data.schedule.week, version: data.schedule.version }), '근무표를 확정했습니다. 직원 페이지에 반영되었습니다.');
};
$('#print').onclick = () => { if (dirty) { status('배정을 저장한 뒤 인쇄해 주세요.', true); return; } window.print(); };
$('#addEmployee').onsubmit = async event => {
  event.preventDefault(); if (!noUnsavedChanges()) return;
  const name = $('#employeeName').value.trim();
  if (pendingEmployee && (pendingEmployee.name !== name || pendingEmployee.role !== $('#employeeRole').value)) { status('먼저 이전 이름으로 다시 제출해 등록 결과를 확인해 주세요.', true); return; }
  pendingEmployee ||= { op: 'employee.add', id: crypto.randomUUID(), name, role: $('#employeeRole').value, token: randomToken() };
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
