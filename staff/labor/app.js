import { $,el,api,status,today,monthMove } from '../shared.js';
import { registerAdminPanel } from '../admin/embed.js?v=20261101-1';
import { monthEnd } from './model.js';
const endpoint='/api/staff/admin/labor',weekdays=['월','화','수','목','금','토','일'];
let month=today().slice(0,7),employeeId='',data,busy=false;const dirtyForms=new Set();
const won=n=>n==null?'확인 필요':Math.round(n).toLocaleString('ko-KR')+'원';
const hours=n=>n==null?'확인 필요':(Math.round(n/60*100)/100).toLocaleString('ko-KR')+'시간';
const labels={yes:'가입 대상',no:'대상 제외',unknown:'확인 필요'};
$('#month').value=month;$('#month').min='2020-01';$('#month').max=(Number(today().slice(0,4))+1)+'-12';
const dirty=()=>dirtyForms.size>0;
const leave=()=>!dirty()||confirm('저장하지 않은 입력을 버리고 이동할까요? 탭 이동 시에는 입력이 유지됩니다.');
function select(options,value){const node=el('select');for(const [v,t] of options){const o=el('option',t);o.value=v;node.append(o);}node.value=value??options[0][0];return node;}
function input(type,value,attrs={}){const n=el('input');n.type=type;n.value=value??'';for(const [k,v] of Object.entries(attrs))n[k]=v;return n;}
function field(parent,title,node){const label=el('label',title);label.append(node);parent.append(label);return node;}
const mark=form=>dirtyForms.add(form);
async function fetchData(){return api(`${endpoint}?month=${month}&employeeId=${encodeURIComponent(employeeId)}`);}
async function load(){if(busy)return;busy=true;$('#dashboard').inert=true;try{data=await fetchData();employeeId=data.employeeId;renderAll();dirtyForms.clear();status('');}catch(e){if(data){month=data.month;employeeId=data.employeeId;$('#month').value=month;$('#employee').value=employeeId;}status(e.message,true);}finally{busy=false;$('#dashboard').inert=false;}}
async function save(body,form){if(busy)return;busy=true;$('#dashboard').inert=true;try{await api(endpoint,{...body,month,employeeId,version:body.op==='labor.profile'?(data.profile?.version||0):data.record.version,source:data.source});data=await fetchData();if(form)dirtyForms.delete(form);renderReport();if(body.op==='labor.override')renderOverrides();status('저장했습니다.');}catch(e){if(body.op==='labor.attendance')renderReport();status(e.message,true);}finally{busy=false;$('#dashboard').inert=false;}}
function metric(title,value,note){const box=el('div',null,'metric');box.append(el('h2',title),el('strong',value),el('p',note));$('#metrics').append(box);}
function renderReport(){
 const r=data.report;if(!r)return;
 $('#metrics').replaceChildren();
 metric('주휴수당 예상',r.holidays.length? (r.holidayPending?(r.holidayTotal?won(r.holidayTotal)+' + 확인 중':'확인 필요'):won(r.holidayTotal)):'확인 필요',`확인분 ${won(r.holidayTotal)} · ${r.holidayPending}건 확인·예정 / 조건 충족 시 합계 ${won(r.holidayPotential)}`);
 metric('월 60시간 · 주 15시간',`${r.monthly.missing?'확인 필요':r.monthly.minutes>=3600?'월 충족':'월 미달'} / ${r.recent?.met==null?'확인 필요':r.recent.met?'주 충족':'주 미달'}`,`월 약정 ${r.monthly.missing?'확인 필요':hours(r.monthly.minutes)} · 최근 4주 평균 ${r.recent?.missing?'확인 필요':hours(r.recent?.average)}`);
 const s=r.retirement;
 metric('퇴직급여 인정기간',s.ready?`${s.eligible.toLocaleString()}일`:'입사일 입력',`제외 ${s.excluded}일 · 확인 대기 ${s.unknown}일 / 365일 도달 ${s.eligible>=365?'(참고)':'전'}`);
 metric('사업주 보험료',r.insurance.total==null?'확인 필요':won(r.insurance.total),`계산 가능 합계 ${won(r.insurance.subtotal)} · ${r.insurance.pending}개 항목 확인 대기`);
 $('#basis').textContent=`시간·보험: ${month} 1일~말일 / 근속·4주 평균: ${r.asOf} 기준 / ${data.profile?.employer||'실제 사용자 미입력'}`;
 $('#holidayBasis').textContent=`25일 급여 기준 ${r.period.start} ~ ${r.period.end}에 도래하는 주휴일`;
 $('#holidays').replaceChildren();
 if(!r.holidays.length){const tr=el('tr'),td=el('td','아래에서 입사일·근로조건을 저장하면 계산합니다.');td.colSpan=5;tr.append(td);$('#holidays').append(tr);}
 for(const h of r.holidays){
  const tr=el('tr');tr.append(el('td',h.date),el('td',h.hours.missing?'확인 필요':hours(h.hours.average)));
  const td=el('td'),control=select([['unknown',h.stale?'변경됨 · 재확인':'미확인'],['yes','개근·출근간주 확인'],['no','미충족']],h.attendance);control.setAttribute('aria-label',h.date+' 개근 확인');control.disabled=h.date>today()||h.state==='future';
  control.onchange=()=>{const result=control.value;if(result==='no'&&!confirm('법정 출근간주일을 확인했고, 개근 요건을 충족하지 않은 주가 맞나요?')){control.value=h.attendance;return;}save({op:'labor.attendance',date:h.date,result});};td.append(control);tr.append(td);
  tr.append(el('td',h.amount==null?(h.potential==null?'확인 필요':won(h.potential)+' (조건부)'):won(h.amount)));
  const state=el('td',h.reason);state.dataset.state=h.state;state.className='status-tag';tr.append(state);$('#holidays').append(tr);
 }
 $('#insurance').replaceChildren();for(const row of r.insurance.rows){const tr=el('tr');tr.append(el('td',row.name));const tag=el('td',labels[row.status]);tag.dataset.state=row.status;tag.className='status-tag';tr.append(tag,el('td',won(row.amount)),el('td',row.rate+' · '+row.reason));$('#insurance').append(tr);}
 $('#insuranceTotal').textContent=`${r.insurance.total==null?'확인된 항목 소계':'예상 사업주 부담 합계'} ${won(r.insurance.subtotal)}${r.insurance.pending?' · 미확정 '+r.insurance.pending+'개':''} / 2026년 외 요율은 계산하지 않습니다.`;
 $('#serviceSummary').textContent=`${data.profile?.startDate||'입사일 미입력'} ~ ${s.asOf} / 재직 ${s.total}일 · 인정 ${s.eligible}일 · 제외 ${s.excluded}일 · 확인 대기 ${s.unknown}일`;
 $('#service').replaceChildren();for(const b of s.blocks){const tr=el('tr');tr.append(el('td',`${b.start} ~ ${b.end}`),el('td',b.missing?'확인 필요':hours(b.average)),el('td',b.state==='unknown'?'확인 대기':b.state==='eligible'?b.days+'일':'제외'));$('#service').append(tr);}
}
function segment(s={start:'',end:'',rate:'',minutes:[0,0,0,0,0,0,0]}){
 const node=el('section',null,'segment'),meta=el('div',null,'segment-meta');
 field(meta,'약정 시작일',input('date',s.start,{required:true})).dataset.key='start';field(meta,'약정 종료일(없으면 계속)',input('date',s.end)).dataset.key='end';field(meta,'시급',input('number',s.rate,{required:true,min:1,max:1000000,step:1})).dataset.key='rate';
 const remove=el('button','기간 삭제');remove.type='button';remove.onclick=()=>{node.remove();mark($('#profileForm'));};meta.append(remove);node.append(meta);
 const grid=el('div',null,'hours');weekdays.forEach((d,i)=>{const n=input('number',s.minutes[i]/60,{min:0,max:8,step:'any',required:true});n.dataset.day=i;field(grid,d+' (시간)',n);});node.append(grid);$('#segments').append(node);
}
const factDefs=[
 ['standardCase','일반 근로자·국내 4대보험 특례 없음',[['unknown','확인 필요'],['yes','확인함 (예외는 아래 별도 입력)']]],
 ['age','조회 월 나이',[['unknown','확인 필요'],['under18','만 18세 미만'],['18to59','만 18~59세'],['60to64','만 60~64세'],['65plus','만 65세 이상']]],
 ['duration','조회 월에 적용할 계속근로 기간',[['unknown','확인 필요'],['under1','1개월 미만 (일용 등 별도 확인)'],['1to3','1개월 이상~3개월 미만'],['3plus','3개월 이상 계속근로 (예정 포함·자격 확인)']]],
 ['over65','만 65세 이상 고용 형태',[['unknown','해당 없음·확인 필요'],['new','65세 이후 신규 고용'],['continued','65세 전부터 피보험자격 계속 유지']]],
 ['pensionIncome','국민연금 가입 판단용 월 소득(원)','number'],['pensionBase','연금 신고 기준소득월액(원)','number'],
 ['pensionCharge','국민연금 해당 월 부과',[['unknown','확인 필요'],['full','정상월 부과 확인'],['exempt','해당 월 미부과 확인']]],
 ['healthBase','건강보험 신고 보수월액(원)','number'],['healthCharge','건강보험 해당 월 부과',[['unknown','확인 필요'],['full','정상월 부과 확인'],['exempt','해당 월 미부과 확인']]],
 ['employmentBase','고용보험 월평균 보수(원)','number'],['stabilityRate','고용안정·능력개발 사업주 요율',[['','사업 규모 확인 필요'],['0.25','0.25% · 150인 미만'],['0.45','0.45% · 150인 이상 우선지원'],['0.65','0.65% · 150~999인 비우선지원'],['0.85','0.85% · 1,000인 이상 등']]],
 ['accidentBase','산재보험 월평균 보수(원)','number'],['accidentRate','산재 실제 총 요율(%) · 출퇴근·개별실적 포함','rate']
];
function renderFacts(){
 const facts=data.record.facts||{};$('#factsFields').replaceChildren();
 for(const [key,title,opts] of factDefs){const n=Array.isArray(opts)?select(opts,facts[key]):input('number',facts[key],{min:opts==='rate'?0.0001:0,max:opts==='rate'?50:1000000000,step:opts==='rate'?'any':1});n.id='fact-'+key;field($('#factsFields'),title,n);}
 $('#exceptions').replaceChildren();for(const [key,name] of [['pension','국민연금'],['health','건강보험·장기요양'],['employment','고용보험'],['accident','산재보험']]){
  const grid=el('div',null,'field-grid');const n=select([['auto','자동 판단'],['yes','가입 대상 확인'],['no','적용 제외 확인']],facts.overrides?.[key]?.status||'auto');n.id='exception-'+key;field(grid,name,n);const note=input('text',facts.overrides?.[key]?.reason,{maxLength:300});note.id='reason-'+key;field(grid,'공단 확인 근거·적용 월',note);$('#exceptions').append(grid);
 }
}
function renderOverrides(){
 $('#overrides').replaceChildren();for(const [date,o] of Object.entries(data.record.overrides).sort()){
  const node=el('div');node.append(el('span',`${date} · ${hours(o.minutes)} · ${won(o.rate)} · ${o.note}`));const remove=el('button','삭제');remove.onclick=()=>{if(confirm('날짜별 약정을 지우고 기간별 약정으로 되돌릴까요?'))save({op:'labor.override',date,remove:true});};node.append(remove);$('#overrides').append(node);
 }
}
function renderAll(){
 $('#dashboard').hidden=false;$('#employee').replaceChildren();for(const e of data.employees){const o=el('option',e.name+(e.active?'':' (사용 중지)'));o.value=e.id;$('#employee').append(o);}$('#employee').value=employeeId;
 $('#empty').hidden=!!employeeId;$('#content').hidden=!employeeId;$('#export').disabled=!employeeId;if(!employeeId)return;
 const p=data.profile||{employer:'',startDate:'',endDate:'',holidayDay:0,referenceDays:[1,2,3,4,5],segments:[]};
 for(const k of ['employer','startDate','endDate'])$('#'+k).value=p[k];
 $('#holidayDay').replaceChildren();for(let i=0;i<7;i++){const o=el('option',['일','월','화','수','목','금','토'][i]);o.value=i;$('#holidayDay').append(o);}$('#holidayDay').value=p.holidayDay;
 $('#referenceDays').replaceChildren();for(let i=0;i<7;i++){const n=input('checkbox');n.checked=p.referenceDays.includes(i);n.value=i;field($('#referenceDays'),['일','월','화','수','목','금','토'][i],n);}
 $('#segments').replaceChildren();p.segments.forEach(segment);if(!p.segments.length)segment();$('#profileDetails').open=!data.profile;
 $('#overrideDate').min=month+'-01';$('#overrideDate').max=monthEnd(month);$('#overrideDate').value='';$('#overrideHours').value='';$('#overrideRate').value='';$('#overrideNote').value='';$('#overrideHours').step='any';
 renderFacts();renderOverrides();renderReport();
}
$('#profileForm').onsubmit=e=>{
 e.preventDefault();const segments=[...document.querySelectorAll('.segment')].map(n=>({start:n.querySelector('[data-key=start]').value,end:n.querySelector('[data-key=end]').value,rate:Number(n.querySelector('[data-key=rate]').value),minutes:[...n.querySelectorAll('[data-day]')].map(i=>Number(i.value)*60)}));
 if(segments.some(s=>s.minutes.some(m=>Math.abs(m-Math.round(m))>1e-5))){status('유급시간은 1분 단위로 입력하세요.',true);return;}segments.forEach(s=>s.minutes=s.minutes.map(Math.round));
 save({op:'labor.profile',profile:{employer:$('#employer').value,startDate:$('#startDate').value,endDate:$('#endDate').value,holidayDay:Number($('#holidayDay').value),referenceDays:[...document.querySelectorAll('#referenceDays input:checked')].map(n=>Number(n.value)),segments}},e.target);
};
$('#addSegment').onclick=()=>{segment({start:'',end:'',rate:'',minutes:[0,0,0,0,0,0,0]});mark($('#profileForm'));};
$('#overrideForm').onsubmit=e=>{e.preventDefault();const minutes=Number($('#overrideHours').value)*60;if(Math.abs(minutes-Math.round(minutes))>1e-5){status('유급시간은 1분 단위로 입력하세요.',true);return;}save({op:'labor.override',date:$('#overrideDate').value,minutes:Math.round(minutes),rate:Number($('#overrideRate').value),note:$('#overrideNote').value},e.target);};
$('#factsForm').onsubmit=e=>{e.preventDefault();const facts={};for(const [key,,opts] of factDefs){const v=$('#fact-'+key).value;facts[key]=['number','rate'].includes(opts)||key==='stabilityRate'?(v===''?null:Number(v)):v;}facts.overrides={};for(const key of ['pension','health','employment','accident'])facts.overrides[key]={status:$('#exception-'+key).value,reason:$('#reason-'+key).value};save({op:'labor.facts',facts},e.target);};
$('#content').addEventListener('input',e=>{const f=e.target.closest('form');if(f)mark(f);});
$('#employee').onchange=()=>{if(!leave()){$('#employee').value=employeeId;return;}employeeId=$('#employee').value;load();};
$('#month').onchange=()=>{if(!$('#month').checkValidity()||!leave()){$('#month').value=month;return;}month=$('#month').value;load();};
$('#refresh').onclick=()=>{if(leave())load();};
$('#export').onclick=()=>{if(dirty()){status('작성한 내용을 저장한 뒤 내려받으세요.',true);return;}const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),employee:data.employees.find(e=>e.id===employeeId),profile:data.profile,month,record:data.record,report:data.report},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`athoce-labor-${month}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
registerAdminPanel(()=>dirty()||busy);
await load();
