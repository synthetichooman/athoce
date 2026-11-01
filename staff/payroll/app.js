import { registerAdminPanel } from '/staff/admin/embed.js?v=20261101-1';
import { $, el, api, status, today, monthMove, weekOf, dateLabel } from '../shared.js';
import { renderForecast } from './forecast.js?v=20261101-1';
const payers = ['at','ho','ce','athoce'];
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;
const hours = m => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
const when = value => new Date(value).toLocaleString('ko-KR', { timeZone:'Asia/Seoul', year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
let month = today().slice(0,7); let data; let busy = false; let dirty = false; const dirtyForms = new Set();
$('#month').min = '2020-01'; $('#month').max = `${Number(today().slice(0,4)) + 1}-12`;
function login() { if(window!==window.top)return;
  data = null; dirty = false; dirtyForms.clear(); $('#dashboard').hidden = true; $('#logout').hidden = true; $('#loginPanel').hidden = false;
  $('#employees').replaceChildren(); $('#payerTotals').replaceChildren(); $('#total').textContent = ''; $('#history').replaceChildren(); $('#confirmDialog').close();
}
function leave() { return !dirty || confirm('아직 저장하지 않은 입력이 있습니다. 변경을 버릴까요?'); }
const write = body => api('/api/staff/admin', { ...body, month, version:data.version });
async function load(target = month, preserve = true) {
  if (busy) return false;
  busy = true; $('#dashboard').inert = true;
  const open = preserve ? [...document.querySelectorAll('.employee[open]')].map(n => n.dataset.id) : [];
  try {
    const result = await api(`/api/staff/admin?payrun=${encodeURIComponent(target)}`);
    data = result; month = target; dirty = false; dirtyForms.clear();
    $('#loginPanel').hidden = true; $('#dashboard').hidden = false; $('#logout').hidden = false;
    render(); for (const id of open) document.querySelector(`.employee[data-id="${id}"]`)?.setAttribute('open','');
    status(''); return true;
  } catch (error) { if (error.status === 401) login(); status(error.message,true); $('#month').value = month; return false; }
  finally { busy = false; $('#dashboard').inert = false; }
}
async function save(body, message, form) {
  if (busy) return;
  if ([...dirtyForms].some(item => item !== form) && !confirm('다른 항목에 저장하지 않은 입력이 있습니다. 그 입력을 버리고 이 항목을 저장할까요?')) return;
  busy = true; $('#dashboard').inert = true;
  try {
    await write(body); dirty = false; busy = false;
    if (await load()) status(message);
  } catch (error) { if (error.status === 401) login(); status(`${error.message}${error.status === 409 ? ' 저장 전 새로고침해 주세요.' : ''}`,true); }
  finally { busy = false; $('#dashboard').inert = false; }
}
function input(labelText, { type='number', value='', min, max, placeholder='', required=true } = {}) {
  const label = el('label',labelText); const node = el('input'); node.type = type; node.value = value ?? ''; node.required = required;
  if (min !== undefined) node.min = min; if (max !== undefined) node.max = max;
  if (type === 'number') node.step = '1'; else node.maxLength = 300;
  node.placeholder = placeholder; label.append(node); return {label, node};
}
function payerSelect(labelText, value = '') {
  const label = el('label',labelText); const node = el('select'); node.required = true;
  const empty = el('option','선택'); empty.value = ''; node.append(empty);
  for (const payer of payers) { const option = el('option',payer); option.value = payer; node.append(option); }
  node.value = value; label.append(node); return {label,node};
}
function employeeCard(row) {
  const final = data.state === 'finalized'; const card = el('details',null,'employee'); card.dataset.id = row.id;
  const summary = el('summary'); const person = el('span',null,'person'); person.append(el('strong',row.name),el('span',`${row.shifts.length}회 · ${hours(row.minutes)}${row.active ? '' : ' · 사용 중지'}`,'small'));
  summary.append(person,el('span',!final && row.shifts.length && !row.hourlyRate ? '시급 설정 필요' : won(row.total),'money')); card.append(summary);
  const content = el('div',null,'employee-content'); card.append(content);
  const settings = el('form',null,'settings-form'); settings.setAttribute('aria-label',`${row.name} 시급 설정`);
  const rate = input('시급 (원)',{value:row.hourlyRate,min:1,max:1000000,placeholder:'시급 입력'});
  const rest = input('하루 무급 휴게 (분)',{value:row.breakMinutes,min:0,max:1440});
  const settingButton = el('button','시급 설정 저장'); settingButton.type = 'submit'; settings.append(rate.label,rest.label,settingButton);
  settings.onsubmit = e => { e.preventDefault(); save({op:'payrun.settings',employeeId:row.id,hourlyRate:Number(rate.node.value),breakMinutes:Number(rest.node.value)},'시급과 무급 휴게시간을 저장했습니다.',settings); };
  content.append(settings,el('p','기본 유급시간 = 근무표 시간 − 무급 휴게. 시급은 선택한 급여 월에만 적용됩니다.','small'));
  const amounts = el('div',null,'employee-payers');
  for (const payer of [...payers,...(row.payers.unassigned ? ['unassigned'] : [])]) amounts.append(el('span',`${payer === 'unassigned' ? '미지정' : payer}  ${won(row.payers[payer])}`));
  content.append(amounts);
  if (row.issues.length) {
    const issues = el('section',null,'notice'); issues.append(el('h3','미확정 근무 확인'));
    for (const issue of row.issues) {
      const form = el('form',null,'reconcile-form'); form.setAttribute('aria-label',`${row.name} ${dateLabel(issue.date)} 미확정 근무`);
      form.append(el('p',`${dateLabel(issue.date)} · ${issue.changed ? '근무표 변경 · 다시 확인 필요' : '근무표 확인 필요'}`));
      const label = el('label','처리 방식'); const choice = el('select'); choice.required = true;
      for (const [value,text] of [['','선택'],...(issue.published ? [['published',`공개 근무대로 반영 (${issue.publishedStart}–${issue.publishedEnd})`]] : []),...(issue.draft ? [['draft',`임시 배정을 실제 근무로 반영 (${issue.start}–${issue.end})`]] : []),['off','실제 미근무 · 급여 제외']]) { const option = el('option',text); option.value = value; choice.append(option); }
      label.append(choice); const payer = payerSelect('지급 주체'); payer.node.required = false;
      const note = input('확인 사유',{type:'text',placeholder:'실제 근무 여부를 확인한 사유'});
      const button = el('button','확인 내역 저장'); button.type = 'submit'; form.append(label,payer.label,note.label,button);
      form.onsubmit = e => { e.preventDefault(); save({op:'payrun.reconcile',employeeId:row.id,date:issue.date,choice:choice.value,payer:payer.node.value,note:note.node.value,scheduleVersion:data.scheduleVersions[weekOf(issue.date)]},'미확정 근무 확인 내역을 저장했습니다.',form); };
      issues.append(form);
    }
    content.append(issues);
  }
  if (row.reconciliations.length) {
    const audit = el('details',null,'subsection'); audit.append(el('summary','근무 확인 기록'));
    for (const item of row.reconciliations) {
      audit.append(el('p',`${dateLabel(item.date)} · ${item.choice === 'off' ? '미근무·급여 제외' : item.choice === 'draft' ? '임시 배정 반영' : '공개 근무 반영'} · ${item.note}`,'small'));
      if (!final) { const reset = el('button',`${dateLabel(item.date)} 다시 확인`); reset.type = 'button'; reset.onclick = () => save({op:'payrun.reconcile-reset',employeeId:row.id,date:item.date},'근무 확인을 해제했습니다. 실제 근무 여부를 다시 선택해 주세요.'); audit.append(reset); }
    }
    content.append(audit);
  }

  const details = el('details',null,'subsection'); details.append(el('summary',`근무 내역 · 기본급 ${won(row.base)}`));
  const scroll = el('div',null,'table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role','region'); scroll.setAttribute('aria-label',`${row.name} 근무 내역`);
  const table = el('table',null,'shift-table'); const head = el('thead'); const headings = el('tr');
  for (const title of ['근무일','근무표','유급시간','지급 주체','금액','']) { const th = el('th',title); th.scope = 'col'; headings.append(th); } head.append(headings); table.append(head);
  const body = el('tbody'); table.append(body);
  const editor = el('div');
  for (const shift of row.shifts) {
    const tr = el('tr'); const date = el('td',dateLabel(shift.date),`dow-${new Date(shift.date+'T00:00:00Z').getUTCDay()}`); tr.append(date,el('td',`${shift.start}–${shift.end}`),el('td',`${hours(shift.minutes)}${shift.override ? ' · 수정' : ''}`),el('td',shift.payer || '미지정'),el('td',won(shift.amount)));
    const td = el('td'); if (!final) { const button = el('button','수정'); button.type = 'button'; button.setAttribute('aria-label',`${row.name} ${dateLabel(shift.date)} 급여 수정`); button.onclick = () => {
      if (!leave()) return; dirty = false; editor.replaceChildren();
      const form = el('form',null,'shift-form'); form.setAttribute('aria-label',`${row.name} ${dateLabel(shift.date)} 근무 수정`);
      const paid = input('유급시간 (분)',{value:shift.minutes,min:0,max:1440});
      const payer = payerSelect('지급 주체',shift.payer);
      const note = input('시간 변경 사유',{type:'text',value:shift.note,required:false,placeholder:'시간 변경 시 필수'});
      const saveButton = el('button','근무 저장'); saveButton.type = 'submit'; form.append(paid.label,payer.label,note.label,saveButton);
      form.onsubmit = e => { e.preventDefault(); save({op:'payrun.shift',employeeId:row.id,date:shift.date,minutes:Number(paid.node.value),payer:payer.node.value,note:note.node.value,scheduleVersion:data.scheduleVersions[weekOf(shift.date)]},'근무 급여 정보를 저장했습니다.',form); };
      if (shift.override) { const reset = el('button','기본시간으로 되돌리기'); reset.type = 'button'; reset.onclick = () => save({op:'payrun.shift',employeeId:row.id,date:shift.date,minutes:shift.minutes,payer:payer.node.value,note:'',useDefault:true,scheduleVersion:data.scheduleVersions[weekOf(shift.date)]},'기본 유급시간을 다시 적용했습니다.',form); form.append(reset); }
      editor.append(el('p',`${dateLabel(shift.date)} 근무 수정`,'small'),form); payer.node.focus();
    }; td.append(button); } tr.append(td); body.append(tr);
  }
  scroll.append(table); details.append(scroll,editor);
  if (!row.shifts.length) details.append(el('p','이 기간의 확정 근무가 없습니다.','small'));
  content.append(details);
  const adjustments = el('details',null,'subsection'); adjustments.append(el('summary',`수당·공제 · ${won(row.adjustment)}`));
  const list = el('div',null,'adjustments');
  for (const payer of payers) if (row.adjustments[payer]) { const item = row.adjustments[payer]; list.append(el('p',`${payer} · ${won(item.amount)} · ${item.note}`)); }
  if (!list.childElementCount) list.append(el('p','등록된 수당·공제가 없습니다.','small'));
  adjustments.append(list);
  if (!final) {
    const form = el('form',null,'adjust-form'); form.setAttribute('aria-label',`${row.name} 수당 공제`);
    const payer = payerSelect('지급 주체'); const amount = input('조정액 (원)',{value:0,min:-100000000,max:100000000});
    const note = input('수당·공제 사유',{type:'text',required:false,placeholder:'예: 주휴수당, 세금 공제'});
    const button = el('button','조정액 저장'); button.type = 'submit'; form.append(payer.label,amount.label,note.label,button);
    payer.node.onchange = () => { amount.node.value = row.adjustments[payer.node.value]?.amount || 0; note.node.value = row.adjustments[payer.node.value]?.note || ''; };
    form.onsubmit = e => { e.preventDefault(); save({op:'payrun.adjustment',employeeId:row.id,payer:payer.node.value,amount:Number(amount.node.value),note:note.node.value},'수당·공제를 저장했습니다.',form); };
    adjustments.append(form,el('p','수당은 양수, 공제는 음수로 입력. 주체별 합산액을 저장하며 0원으로 저장하면 삭제됩니다.','small'));
  }
  content.append(adjustments);
  if (final) settings.querySelectorAll('input,button').forEach(node => { node.disabled = true; });
  return card;
}
function render() {
  const report = data.report; const final = data.state === 'finalized';
  $('#month').value = month; $('#previous').disabled = month <= $('#month').min; $('#next').disabled = month >= $('#month').max;
  $('#monthTitle').textContent = `${Number(month.slice(0,4))}년 ${Number(month.slice(5))}월 급여`;
  $('#period').textContent = `${report.start.replaceAll('-','.')} — ${report.end.replaceAll('-','.')} · 지급일 ${Number(month.slice(5))}월 25일`;
  $('#state').textContent = final ? '확정' : '검토 중'; $('#state').dataset.final = final;
  renderForecast($('#forecast'),data.forecast);
  $('#totalLabel').textContent = final ? '최종 지급액' : '오늘까지 집계액';
  const amountPending = !final && data.blockers.some(s => /시급|휴게시간|근무 시간을/.test(s));
  $('#total').textContent = amountPending ? '정산 설정 확인 필요' : won(report.totals.total);
  $('#totalMeta').textContent = `${report.totals.shifts}회 · ${hours(report.totals.minutes)} · 수당·공제 ${won(report.totals.adjustment)}`;
  $('#payerTotals').replaceChildren();
  for (const payer of payers) { const item = el('div'); item.append(el('span',payer),el('strong',amountPending ? '확인 필요' : won(report.totals.payers[payer]))); $('#payerTotals').append(item); }
  if (report.totals.payers.unassigned) { const item = el('div'); item.append(el('span','미지정'),el('strong',won(report.totals.payers.unassigned))); $('#payerTotals').append(item); }
  $('#sourceWarning').hidden = !data.sourceChanged;
  $('#employees').replaceChildren(...report.rows.map(employeeCard)); $('#empty').hidden = !!report.rows.length;
  $('#copySettings').hidden = final;
  $('#confirmationTitle').textContent = final ? '급여 확정 완료' : '급여 확정';
  $('#confirmedAt').textContent = data.confirmedAt ? when(data.confirmedAt) : '';
  $('#finalize').hidden = final; $('#finalize').disabled = !!data.blockers.length;
  $('#reopenForm').hidden = !final; $('#reopenReason').value = '';
  const blockers = $('#blockers'); blockers.replaceChildren();
  if (!final && data.blockers.length) {
    const details = el('details'); details.open = data.blockers.length <= 4; details.append(el('summary',`확정 전 확인 ${data.blockers.length}건`)); const ul = el('ul');
    for (const message of data.blockers) ul.append(el('li',message)); details.append(ul); blockers.append(details);
  } else if (!final) blockers.append(el('p','근무시간과 수당·공제 검토가 끝나면 확정하세요.'));
  $('#historyPanel').hidden = !data.history.length; $('#history').replaceChildren();
  for (const [i,item] of data.history.entries()) $('#history').append(el('p',`${i+1}차 확정 ${when(item.confirmedAt)} · ${won(item.total)}\n확정 취소 ${when(item.reopenedAt)} · ${item.reason}`));
}
$('#loginForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true; $('#loginForm').inert = true;
  try { await api('/api/staff/admin/login',{password:$('#password').value}); $('#password').value = ''; busy = false; await load(); }
  catch(error) { status(error.message,true); } finally { busy = false; $('#loginForm').inert = false; }
};
$('#logout').onclick = async () => { if (busy || !leave()) return; try { await api('/api/staff/admin/logout',{}); login(); status('로그아웃했습니다.'); } catch(error) { status(error.message,true); } };
$('#month').onchange = () => { if (leave()) load($('#month').value,false); else $('#month').value = month; };
$('#previous').onclick = () => { if (leave()) load(monthMove(month,-1),false); };
$('#next').onclick = () => { if (leave()) load(monthMove(month,1),false); };
$('#refresh').onclick = () => { if (leave()) load(); };
$('#copySettings').onclick = () => { if (leave()) save({op:'payrun.copy'},'설정하지 않은 스태프의 시급·휴게시간을 이전 달에서 불러왔습니다.'); };
$('#finalize').onclick = () => {
  if (!leave()) return;
  $('#confirmDescription').textContent = `${month} 급여 ${won(data.report.totals.total)}\n${payers.map(p => `${p} ${won(data.report.totals.payers[p])}`).join(' · ')}`;
  $('#confirmDialog').showModal();
};
$('#cancelConfirm').onclick = () => $('#confirmDialog').close();
$('#submitConfirm').onclick = async () => { $('#confirmDialog').close(); await save({op:'payrun.finalize',source:data.source},'급여를 확정했습니다.'); };
$('#reopenForm').onsubmit = event => { event.preventDefault(); save({op:'payrun.reopen',reason:$('#reopenReason').value},'확정을 취소했습니다. 수정 후 다시 확정해 주세요.',$('#reopenForm')); };
$('#dashboard').addEventListener('input',event => { if (event.target.closest('form')) { dirty = true; dirtyForms.add(event.target.closest('form')); } });
window.addEventListener('beforeunload',event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
$('#export').onclick = () => {
  const report = data.report;
  const records = [['급여월',month,'정산 시작',report.start,'정산 종료',report.end,'상태',data.state === 'finalized' ? '확정' : '검토 중'],['이름','근무일','시급','유급시간(분)','지급주체','기본급','수당/공제','합계','사유']];
  for (const row of report.rows) {
    for (const shift of row.shifts) records.push([row.name,shift.date,row.hourlyRate ?? '',shift.minutes,shift.payer || '미지정',shift.amount,0,shift.amount,[shift.note,shift.reconciliation?.note].filter(Boolean).join(' / ')]);
    for (const payer of payers) if (row.adjustments[payer]) { const a = row.adjustments[payer]; records.push([row.name,'수당/공제','','',payer,0,a.amount,a.amount,a.note]); }
    records.push([row.name,'합계','',row.minutes,'',row.base,row.adjustment,row.total,'']);
  }
  records.push(['전체 합계','','',report.totals.minutes,'',report.totals.base,report.totals.adjustment,report.totals.total,'']);
  const escape = value => { const raw = String(value); const safe = /^[=+\-@\t\r]/.test(raw) && typeof value !== 'number' ? `'${raw}` : raw; return `"${safe.replaceAll('"','""')}"`; };
  const blob = new Blob(['\ufeff'+records.map(row=>row.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = `athoce-payroll-${month}.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
registerAdminPanel(() => dirty || busy);
await load();
