import { el } from '../shared.js';
const won=n=>n==null?'확인 필요':n.toLocaleString('ko-KR')+'원';
const hours=n=>n==null?'시간 확인 필요':(Math.round(n/60*100)/100).toLocaleString('ko-KR')+'시간';
const money=(gross,base)=>gross==null?(base==null?'확인 필요':won(base)+' + α'):won(gross);
function table(headers,rows,label){
 const scroll=el('div',null,'table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',label);
 const t=el('table'),thead=el('thead'),head=el('tr'),body=el('tbody');
 headers.forEach(h=>{const th=el('th',h);th.scope='col';head.append(th);});thead.append(head);
 rows.forEach(cells=>{const tr=el('tr');cells.forEach(c=>tr.append(el('td',c)));body.append(tr);});t.append(thead,body);scroll.append(t);return scroll;
}
export function renderForecast(root,f){
 root.replaceChildren();if(!f)return;
 const title=el('div',null,'section-heading');title.append(el('h2','근무표 기준 예상'),el('span','앞으로의 근무 포함','forecast-badge'));root.append(title);
 root.append(el('p',`25일 급여 ${f.period.start} ~ ${f.period.end} · 월간 비용 ${f.calendar.start} ~ ${f.calendar.end}`,'small'));
 const metrics=el('div',null,'forecast-metrics');
 const items=[['25일 예상 급여',money(f.totals.payday,f.totals.base),'기본급 + 주휴수당 (조건부)'],['월간 예상 급여',money(f.totals.calendar,f.rows.some(r=>r.calendar.base==null)?null:f.rows.reduce((n,r)=>n+r.calendar.base,0)),'1일~말일 · 기본급 + 주휴수당'],['월간 사업주 보험료',won(f.totals.insurance),'월간 예상 급여를 보수로 가정'],['월간 총 인건비',won(f.totals.cost),'월간 급여 + 사업주 보험료']];
 for(const [label,value,note] of items){const box=el('div');box.append(el('h3',label),el('strong',value),el('p',note));metrics.append(box);}root.append(metrics);
 if(!f.rows.length){root.append(el('p','예상 급여를 계산할 스태프가 없습니다.','small'));return;}
 root.append(table(['스태프','25일 기본급','25일 주휴수당','월간 보험료','월간 총 인건비'],f.rows.map(r=>[r.name,won(r.payday.base),r.payday.holiday==null?'근로조건 확인 필요':won(r.payday.holiday)+(r.payday.holidayConditional?' (조건부)':''),won(r.insurance.total),won(r.cost)]),'스태프별 예상 급여와 인건비'));
 if(f.rows.some(r=>r.profileMissing||r.insuranceFactsMissing)){
  const note=el('p','주휴·보험료 계산에는 근로조건과 보험 가입정보가 필요합니다. ','forecast-pending');
  const a=el('a','노무·보험에서 설정 →');a.href='/staff/labor/';
  if(document.getElementById('profileDetails')){a.href='#profileDetails';a.onclick=e=>{e.preventDefault();e.stopPropagation();const target=document.getElementById('profileDetails');target.open=true;target.scrollIntoView({behavior:'smooth',block:'start'});};}
  note.append(a);root.append(note);
 }
 const details=el('details',null,'forecast-details');details.append(el('summary','근무·보험료 계산 내역'));
 for(const r of f.rows){
  const section=el('section');section.append(el('h3',r.name),el('p',`${r.payday.shifts.length}회 · ${hours(r.payday.minutes)} / 앞으로 ${r.payday.future}회 · 임시 배정 ${r.payday.provisional}회`,'small'));
  if(r.payday.carryMonths.length||r.calendar.carryMonths.length)section.append(el('p',`시급·휴게시간 미설정 기간은 ${[...new Set([...r.payday.carryMonths,...r.calendar.carryMonths])].join(', ')} 설정을 이어서 가정합니다. 확정 전 해당 급여 월 설정을 저장하세요.`,'small'));
  const missing=[...new Set([...r.payday.shifts,...r.calendar.shifts].flatMap(s=>s.missing))];
  if(missing.length)section.append(el('p',`${missing.join(' · ')} 설정 필요. 미설정 근무를 0원으로 합산하지 않습니다.`,'forecast-pending'));
  const union=[...new Map([...r.payday.shifts,...r.calendar.shifts].map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  section.append(table(['날짜','구분','유급시간','기본급','부담'],union.map(s=>[s.date+(s.date>f.period.end?' · 다음 급여':''),s.source==='finalized'?'급여 확정':s.provisional?'임시 배정':s.future?'예정 · 공개 근무':'공개 근무',hours(s.minutes),won(s.amount),s.payer||'미지정']),r.name+' 예상 근무 내역'));
  section.append(el('p',`월간 배정 ${hours(r.calendar.minutes)} · 월간 기본급 ${won(r.calendar.base)} · 주휴수당 ${won(r.calendar.holiday)}${r.calendar.holidayConditional?' (조건부)':''}`,'small'));
  if(r.profileMissing||r.insuranceFactsMissing){const p=el('p',null,'forecast-pending');p.append(document.createTextNode(r.profileMissing?'입사일·근로조건과 보험 가입정보를 입력하면 주휴·보험료를 계산합니다. ':'보험 가입정보·사업장 요율을 확인하세요. '));const a=el('a','노무·보험 설정 →');a.href='/staff/labor/';p.append(a);section.append(p);}
  section.append(table(['보험','근무표 기준 대상 추정','사업주 예상액'],r.insurance.rows.map(i=>[i.name,{yes:'대상 추정',no:'대상 제외',unknown:'확인 필요'}[i.status],won(i.amount)]),r.name+' 근무표 기준 보험료'));
  if(r.insurance.pending)section.append(el('p',`보험 ${r.insurance.pending}개 항목의 가입 여부·요율·부과 기준 또는 예상 보수 확인이 필요합니다.`,'small'));
  details.append(section);
 }
 root.append(details,el('p','세전 예상 · + α는 주휴 등 확인 필요 금액 · 수동 수당·공제 별도','small forecast-note'));
 details.append(el('p','저장된 배정만 반영합니다. 미배정 날짜·신청만 한 날짜는 제외합니다. 근무표를 소정근로시간으로 가정하며, 주휴는 개근 등 요건 충족 시 예상액입니다. 수동 수당·공제·세금은 제외한 예산이며 최종 급여에 자동 반영되지 않습니다.','small forecast-note'));
 details.append(el('p','보험은 조회 월 가입정보·사업장 요율을 적용한 정상월 추정입니다. 신고 기준액 대신 월간 예상 급여를 사용하며, 부과 여부 미입력 시 계속 재직하는 정상월의 연금·건강보험 부과를 가정합니다. 입·퇴사월·변동 약정·공단 고지액은 별도 확인하세요.','small forecast-note'));
}
