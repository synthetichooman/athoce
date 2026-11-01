import { registerAdminPanel } from '/staff/admin/embed.js?v=20261101-1';
import { $, el, api, status, randomToken, today } from '../shared.js';
import { employeeLabel } from '../names.js?v=20261030-1';
import { FIELDS, defaultTerms, EMPLOYER_CONSENT } from './model.js';
import { renderDocument, signaturePad, labelState, when, downloadContract, downloadFile } from './shared.js';
let data, current, dirty=false, busy=false, employerPad;
const inputs={};
const apiPath='/api/staff/admin/contracts';
const groups=[['계약 당사자',0,7],['근무 조건',7,13],['임금',13,19],['휴일 및 그 밖의 조건',19,FIELDS.length]];
for(const [title,start,end] of groups) {
  const section=el('details',null,'form-section');section.open=true;section.append(el('summary',title));const grid=el('div',null,'field-grid');
  for(const [key,text,type,max,,optional] of FIELDS.slice(start,end)) {
    const label=el('label',text,type==='textarea'?'full':'');const input=el(type==='textarea'?'textarea':'input');
    input.id=`field-${key}`;label.htmlFor=input.id;
    if(type==='textarea'){input.rows=key==='workDays'?4:3;input.maxLength=max;}else {input.type=type;if(type==='number'){input.min=1;input.max=max;input.step=1;}else input.maxLength=max;}
    // Drafts can be saved incomplete; the server validates completeness at issuance.
    input.dataset.required=String(!optional);input.autocomplete='off';inputs[key]=input;label.append(input);grid.append(label);
    if(key==='workDays') { const help=el('p','각 근로일의 시작·종료 시각을 적으세요. 변동 근무도 합의한 날짜별 시간을 명시하세요.','small full');grid.append(help);input.placeholder='예: 매주 토요일 13:00~20:00\n매주 일요일 13:00~20:00'; }
    if(key==='breaks')input.placeholder='예: 각 근무일 16:00~17:00, 무급 (자유 이용)';
    if(key==='insurance')input.placeholder='적용되는 보험과 가입 여부를 구체적으로 입력';
  }
  section.append(grid);$('#fields').append(section);
}
$('#employerConsentText').textContent=EMPLOYER_CONSENT;
function leave(){return !dirty||confirm('저장하지 않은 초안을 버릴까요?');}
function clearShare(){$('#shareLink').value='';$('#shareCode').value='';$('#sharePanel').hidden=true;}
function login() { if(window!==window.top)return;
  data=null;current=null;dirty=false;clearShare();$('#dashboard').hidden=true;$('#logout').hidden=true;$('#loginPanel').hidden=false;
  $('#contracts').replaceChildren();$('#document').replaceChildren();$('#audit').replaceChildren();$('#issueDialog').close();
  for(const input of Object.values(inputs))input.value='';
}
function employeeOptions(select,all=false) {
  const chosen=select.value;select.replaceChildren();if(all){const option=el('option','전체 직원');option.value='';select.append(option);}
  for(const employee of data.employees.filter(e=>all||e.active||e.id===current?.employeeId)) {const option=el('option',`${employeeLabel(employee)}${employee.active?'':' (사용 중지)'}`);option.value=employee.id;select.append(option);}
  if([...select.options].some(o=>o.value===chosen))select.value=chosen;
}
async function list() {
  data=await api(apiPath);$('#loginPanel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;
  employeeOptions($('#employeeFilter'),true);renderList();
}
function renderList() {
  const selected=$('#employeeFilter').value;const records=data.contracts.filter(c=>!selected||c.employeeId===selected);
  $('#contracts').replaceChildren();$('#empty').hidden=records.length>0;
  $('#counts').textContent=`전체 ${records.length} · 서명 대기 ${records.filter(c=>c.status==='requested').length} · 서명 완료 ${records.filter(c=>c.status==='signed').length}`;
  for(const c of records) {
    const card=el('article',null,'contract-card'),info=el('div'),end=el('div',null,'card-end');
    info.append(el('h3',c.name||data.employees.find(e=>e.id===c.employeeId)?.name||'직원'),el('p',c.employerName||'고용주 미작성','small'),el('p',c.startDate?`${c.startDate} → ${c.endDate||'기간의 정함 없음'}`:'근무 시작일 미작성','small'));
    end.append(el('div',labelState(c),'badge'));const button=el('button','계약서 열기');button.onclick=()=>open(c.id);const action=el('div');action.append(button);end.append(action);card.append(info,end);$('#contracts').append(card);
  }
  $('#newContract').disabled=!data.employees.some(e=>e.active);
}
function showEditor() {
  clearShare();dirty=false;employeeOptions($('#employee'));$('#employee').value=current.employeeId;$('#employee').disabled=true;
  const draft=current.status==='draft';$('#listPanel').hidden=true;$('#editor').hidden=false;$('#contractForm').hidden=!draft;$('#recordActions').hidden=draft;
  $('#editorTitle').textContent=`${current.terms.workerName||data.employees.find(e=>e.id===current.employeeId)?.name||'직원'} · 근로계약`;
  $('#contractState').textContent=labelState(current);$('#editorMeta').textContent=current.version?`마지막 변경 ${when(current.updatedAt)}`:'새 초안';
  for(const [key] of FIELDS)inputs[key].value=current.terms[key]??'';
  $('#save').textContent='초안 저장';$('#request').disabled=!current.version;$('#dirtyState').textContent='';
  $('#rotate').hidden=!['requested','signed'].includes(current.status);$('#withdraw').hidden=current.status!=='requested';
  $('#deliveryPanel').hidden=current.status!=='signed';
  if(current.status==='signed') {
    $('#deliveryTitle').textContent=current.delivery?'사본 전달 완료':'서명 완료 · 사본 전달 대기';
    $('#deliveryInfo').textContent=current.delivery?`${when(current.delivery.at)} · ${current.delivery.destination} · ${current.delivery.note}`:`수령 이메일: ${current.worker.email}`;
    $('#deliveryForm').hidden=!!current.delivery;$('#deliveryHelp').hidden=!!current.delivery;$('#deliveryNote').value='';$('#deliveryConfirm').checked=false;
  }
  $('#evidence').hidden=current.status==='draft';renderDocument($('#document'),current);renderAudit();window.scrollTo({top:0,behavior:'instant'});
}
function renderAudit() {
  const names={'draft.saved':'초안 저장','signature.requested':'고용주 서명 · 요청 링크 발급','recipient.opened':'수신자 최초 열람','worker.signed':'근로자 서명','access.rotated':'링크·확인코드 재발급','request.withdrawn':'요청 취소','copy.delivered':'관리자 사본 전달 기록'};
  $('#audit').replaceChildren(...current.events.map(event=>el('p',`${when(event.at)} · ${names[event.event]||event.event}${event.detail?` · ${event.detail}`:''}`)));
}
async function run(fn) {
  if(busy)return;busy=true;$('#dashboard').inert=true;
  try{await fn();}catch(error){if(error.status===401)login();status(error.message,true);}
  finally{busy=false;$('#dashboard').inert=false;}
}
async function open(id) {if(!leave())return;await run(async()=>{current=(await api(`${apiPath}?id=${encodeURIComponent(id)}`)).contract;showEditor();status('');});}
function newContract(source) {
  if(!leave())return;
  const target=source?.employeeId||$('#employeeFilter').value||data.employees.find(e=>e.active&&e.role==='staff')?.id||data.employees.find(e=>e.active)?.id;
  if(!data.employees.some(e=>e.id===target&&e.active)){status('사용 중인 직원을 선택해 주세요.',true);return;}
  const name=data.employees.find(e=>e.id===target).name;
  current={id:crypto.randomUUID(),employeeId:target,schema:'athoce-employment-v1',version:0,revision:0,status:'draft',events:[],terms:source?{...source.terms,startDate:today(),endDate:''}:defaultTerms(name)};
  showEditor();$('#employee').disabled=false;dirty=true;$('#dirtyState').textContent='저장 전';
}
function collect() {return Object.fromEntries(FIELDS.map(([key,,type])=>[key,type==='number'&&inputs[key].value!==''?Number(inputs[key].value):inputs[key].value]));}
$('#contractForm').oninput=()=>{dirty=true;$('#request').disabled=true;$('#dirtyState').textContent='저장하지 않은 변경';renderDocument($('#document'),{...current,terms:collect()});};
$('#employee').onchange=()=>{current.employeeId=$('#employee').value;inputs.workerName.value=data.employees.find(e=>e.id===current.employeeId)?.name||'';renderDocument($('#document'),{...current,terms:collect()});};
$('#contractForm').onsubmit=event=>{event.preventDefault();run(async()=>{const response=await api(apiPath,{op:'contract.save',id:current.id,employeeId:current.employeeId,version:current.version,terms:collect()});current=response.contract;showEditor();await list();status('초안을 저장했습니다. 내용을 검토하고 서명을 요청하세요.');});};
$('#request').onclick=()=> {
  if(dirty||!current.version){status('초안을 먼저 저장해 주세요.',true);return;}
  $('#employerPad').replaceChildren();employerPad=signaturePad($('#employerPad'),'고용주');$('#employerConsent').checked=false;$('#issueError').textContent='';$('#issuerName').textContent=`${current.terms.employerName} · ${current.terms.representative}`;$('#issueDialog').showModal();
};
function newAccess(){const token=randomToken(),code=randomToken().slice(0,16).toUpperCase();return {token,code};}
function showAccess(access){$('#shareLink').value=`${location.origin}/staff/contract/#token=${access.token}`;$('#shareCode').value=access.code;$('#sharePanel').hidden=false;$('#sharePanel').scrollIntoView({behavior:'smooth',block:'start'});}
$('#cancelIssue').onclick=()=>$('#issueDialog').close();
$('#confirmIssue').onclick=async()=> {
  if(busy)return;if(!$('#employerConsent').checked){$('#issueError').textContent='고용주 서명 동의를 확인해 주세요.';return;}
  busy=true;$('#confirmIssue').disabled=true;$('#cancelIssue').disabled=true;$('#issueDialog').inert=true;
  try{const access=newAccess();const response=await api(apiPath,{op:'contract.issue',id:current.id,version:current.version,...access,signature:employerPad.value(),consent:EMPLOYER_CONSENT});current=response.contract;$('#issueDialog').close();showEditor();await list();showAccess(access);status('서명 요청 링크와 확인코드를 각각 전달해 주세요.');}
  catch(error){if(error.status===401)login();$('#issueError').textContent=error.message;status(error.message,true);}
  finally{busy=false;$('#issueDialog').inert=false;$('#confirmIssue').disabled=false;$('#cancelIssue').disabled=false;}
};
$('#rotate').onclick=()=>{if(!confirm('새 링크와 확인코드를 발급하면 기존 링크와 접속이 만료됩니다. 계속할까요?'))return;run(async()=>{const access=newAccess();current=(await api(apiPath,{op:'contract.link',id:current.id,version:current.version,...access})).contract;showEditor();await list();showAccess(access);status('새 링크와 확인코드를 전달해 주세요.');});};
$('#withdraw').onclick=()=>{const reason=prompt('서명 요청을 취소하는 사유');if(!reason?.trim())return;run(async()=>{current=(await api(apiPath,{op:'contract.withdraw',id:current.id,version:current.version,reason})).contract;showEditor();await list();status('요청을 취소했습니다. 원문과 진행 이력은 보관됩니다.');});};
$('#deliveryForm').onsubmit=event=>{event.preventDefault();run(async()=>{current=(await api(apiPath,{op:'contract.delivery',id:current.id,version:current.version,note:$('#deliveryNote').value,confirm:$('#deliveryConfirm').checked})).contract;showEditor();await list();status('사본 전달 내역을 기록했습니다.');});};
async function copy(selector){const input=$(selector);try{await navigator.clipboard.writeText(input.value);status('복사했습니다.');}catch{input.focus();input.select();status('자동 복사가 지원되지 않아 내용을 선택했습니다. 직접 복사하세요.');}}
$('#copyLink').onclick=()=>copy('#shareLink');$('#copyCode').onclick=()=>copy('#shareCode');$('#hideShare').onclick=clearShare;
$('#clone').onclick=()=>newContract(current);
$('#download').onclick=()=>{if(dirty){status('초안을 저장한 후 내려받으세요.',true);return;}downloadContract(current);};
$('#print').onclick=()=>{if(dirty){status('초안을 저장한 후 인쇄하세요.',true);return;}window.print();};
$('#evidence').onclick=()=>downloadFile(`근로계약-서명기록-${current.id}.json`,JSON.stringify(current,null,2),'application/json');
$('#back').onclick=()=>{if(!leave())return;dirty=false;clearShare();$('#editor').hidden=true;$('#listPanel').hidden=false;run(async()=>{await list();status('');});};
$('#newContract').onclick=()=>newContract();$('#employeeFilter').onchange=renderList;
$('#refresh').onclick=()=>run(async()=>{await list();status('최신 상태로 갱신했습니다.');});
$('#loginForm').onsubmit=event=>{event.preventDefault();run(async()=>{await api('/api/staff/admin/login',{password:$('#password').value});$('#password').value='';await list();status('');});};
$('#logout').onclick=()=>{if(!leave())return;run(async()=>{await api('/api/staff/admin/logout',{});login();status('로그아웃했습니다.');});};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
run(async()=>{await list();status('');});

registerAdminPanel(() => dirty || busy);
