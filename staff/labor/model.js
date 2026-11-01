// Ordinary part-time employees. Unknown inputs deliberately remain unknown.
export const RULE_DATE = '2026-11-01';
export const addDays = (d,n) => new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const day = d => new Date(d+'T00:00:00Z').getUTCDay();
export const days = (a,b) => { const out=[]; for(let d=a;d<=b;d=addDays(d,1))out.push(d); return out; };
export const validDate = d => typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d;
export const monthEnd = m => addDays(new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),1)).toISOString().slice(0,10),-1);
export const payPeriod = m => ({start:addDays(new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1)).toISOString().slice(0,10),-1).slice(0,7)+'-26',end:m+'-25'});
const min = (...v) => v.filter(Boolean).sort()[0];
const max = (...v) => v.filter(Boolean).sort().at(-1);
export function agreed(profile,records,date) {
  if(!profile?.startDate)return {minutes:null,rate:null};
  if(date<profile.startDate || (profile.endDate && date>profile.endDate))return {minutes:0,rate:null,outside:true};
  const override=records[date.slice(0,7)]?.overrides?.[date];
  const segment=profile.segments?.find(s=>s.start<=date && (!s.end||s.end>=date));
  return override || (segment ? {minutes:segment.minutes[(day(date)+6)%7],rate:segment.rate} : {minutes:null,rate:null});
}
export function windowHours(profile,records,start,end) {
  const dates=days(start,end), entries=dates.map(d=>agreed(profile,records,d));
  const missing=entries.filter(e=>e.minutes==null).length;
  const minutes=entries.reduce((n,e)=>n+(e.minutes||0),0);
  return {start,end,days:dates.length,minutes,missing,average:dates.length?minutes*7/dates.length:null,met:missing||!dates.length?null:minutes*7/dates.length>=900};
}
export function holidayReport(profile,records,date,asOf) {
  const start=addDays(date,-6),lookback=max(addDays(date,-27),profile?.startDate||date);
  const hours=windowHours(profile,records,lookback,date);
  const comparator=days(lookback,date).filter(d=>profile?.referenceDays?.includes(day(d))).length;
  const rate=agreed(profile,records,date).rate;
  const basis=JSON.stringify([profile?.employer,profile?.startDate,profile?.endDate,profile?.holidayDay,profile?.referenceDays,days(lookback,date).map(d=>[d,agreed(profile,records,d)])]);
  const saved=records[date.slice(0,7)]?.attendance?.[date];
  const attendance=saved?.basis===basis?saved.result:'unknown';
  let state='pending',reason='개근·출근간주 확인 필요',amount=null,potential=null;
  if(!profile?.startDate){reason='근로조건 입력 필요';}
  else if(start<profile.startDate || (profile.endDate && date>profile.endDate)){state='excluded';reason='해당 7일간 근로관계 미유지';amount=0;potential=0;}
  else if(hours.met===false){state='excluded';reason='4주 평균 주 15시간 미만';amount=0;potential=0;}
  else if(hours.met==null || !comparator || !rate || hours.minutes/comparator>480){reason='약정시간·시급·비교 근무일 확인 필요';}
  else {
    potential=Math.round(hours.minutes/comparator/60*rate);
    if(date>asOf){state='future';reason='아직 도래하지 않은 주휴일';}
    else if(attendance==='no'){state='excluded';reason='개근 요건 미충족';amount=0;potential=0;}
    else if(attendance==='yes'){state='eligible';reason='시간·개근 요건 충족';amount=potential;}
  }
  return {date,start,lookback,hours,attendance,stale:!!saved && saved.basis!==basis,basis,state,reason,amount,potential};
}
export function retirementReport(profile,records,asOf) {
  if(!profile?.startDate || profile.startDate>asOf)return {asOf,total:0,eligible:0,excluded:0,unknown:0,blocks:[],ready:false};
  const end=min(asOf,profile.endDate),blocks=[];
  for(let last=end;last>=profile.startDate;last=addDays(last,-28)){
    const h=windowHours(profile,records,max(profile.startDate,addDays(last,-27)),last);
    blocks.push({...h,state:h.met===null?'unknown':h.met?'eligible':'excluded'});
  }
  const count=state=>blocks.filter(b=>b.state===state).reduce((n,b)=>n+b.days,0);
  return {asOf:end,total:days(profile.startDate,end).length,eligible:count('eligible'),excluded:count('excluded'),unknown:count('unknown'),blocks,ready:true};
}
export function insuranceReport(month,profile,records) {
  const facts=records[month]?.facts||{},start=month+'-01',end=monthEnd(month);
  const hours=windowHours(profile,records,start,end);
  // Employment insurance uses each contractual week, not the holiday four-week average.
  const patterns=(profile?.segments||[]).filter(s=>s.start<=end && (!s.end||s.end>=start));
  const weeklyKnown=patterns.length>0 && !hours.missing && !Object.keys(records[month]?.overrides||{}).length;
  const allWeekly15=weeklyKnown?patterns.every(s=>s.minutes.reduce((a,b)=>a+b,0)>=900):null;
  const ordinary=facts.standardCase==='yes' && !!profile?.startDate && profile.startDate<=end && (!profile.endDate || profile.endDate>=start);
  const duration=facts.duration||'unknown',age=facts.age||'unknown';
  const partialMonth=profile?.startDate>start || !!(profile?.endDate && profile.endDate<end);
  const qualifiesMonth=hours.missing||partialMonth?null:hours.minutes>=3600;
  let pension='unknown',health='unknown',employment='unknown',accident='unknown';
  if(ordinary){
    accident='yes';
    if(duration==='under1') {pension='unknown';health='unknown';} // daily-worker rules require a separate assessment
    else if(duration!=='unknown'){
      health=qualifiesMonth==null?'unknown':qualifiesMonth?'yes':'no';
      if(['60to64','65plus'].includes(age))pension='no';
      else if(age==='18to59')pension=qualifiesMonth===true || (facts.pensionIncome!=null && facts.pensionIncome>=2200000)?'yes':qualifiesMonth===false && facts.pensionIncome!=null?'no':'unknown';
    }
    if(duration==='3plus')employment='yes';
    else if(duration!=='unknown')employment=qualifiesMonth===false || allWeekly15===false?'no':qualifiesMonth===true && allWeekly15===true?'yes':'unknown';
  }
  let unemployment=true;
  if(employment==='yes' && age==='65plus'){
    if(facts.over65==='new')unemployment=false;
    else if(facts.over65!=='continued')employment='unknown';
  }else if(employment==='yes' && age==='unknown')employment='unknown';
  const statuses={pension,health,employment,accident};
  for(const key in statuses)if(['yes','no'].includes(facts.overrides?.[key]?.status) && facts.overrides[key].reason?.trim())statuses[key]=facts.overrides[key].status;
  const verified=month.startsWith('2026-'),floor10=v=>Math.floor((v+1e-7)/10)*10;
  const rows=[];
  const row=(key,name,status,amount,reason,rate)=>rows.push({key,name,status,amount:status==='no'?0:status==='yes'&&verified?amount:null,reason:!verified?'2026년 이외 요율 확인 필요':reason,rate});
  const base=facts.pensionBase;
  const pensionBase=base==null?null:Math.min(month<'2026-07'?6370000:6590000,Math.max(month<'2026-07'?400000:410000,Math.floor(base/1000)*1000));
  row('pension','국민연금',statuses.pension,facts.pensionCharge==='exempt'?0:facts.pensionCharge==='full'&&pensionBase!=null?floor10(pensionBase*.0475):null,'나이·근로기간·월 소정시간 또는 소득 기준 / 취득월 부과 확인','사업주 4.75%');
  const healthAmount=facts.healthCharge==='exempt'?0:facts.healthCharge==='full'&&facts.healthBase!=null?floor10(Math.min(4591740,Math.max(10080,facts.healthBase*.03595))):null;
  row('health','건강보험',statuses.health,healthAmount,'월 소정 60시간 / 입·퇴사월 자격·부과 별도 확인','사업주 3.595%');
  row('care','장기요양',statuses.health,healthAmount==null?null:floor10(healthAmount*.9448/7.19),'건강보험과 연동','건강보험료 × 0.9448 ÷ 7.19');
  row('employment','고용보험',statuses.employment,facts.employmentBase!=null && facts.stabilityRate!=null && (['under18','18to59','60to64'].includes(age)||(age==='65plus'&&['new','continued'].includes(facts.over65)))?floor10(facts.employmentBase*((unemployment ? .009 : 0)+facts.stabilityRate/100)):null,'월 60시간·주 15시간 / 3개월 이상 계속근로 예외 / 65세 확인',`${unemployment?'실업급여 0.9% + ':''}사업 규모별 요율`);
  row('accident','산재보험',statuses.accident,facts.accidentBase!=null&&facts.accidentRate!=null?floor10(facts.accidentBase*facts.accidentRate/100):null,'사업장 실제 적용 요율(출퇴근·개별실적 포함) 필요','전액 사업주 부담');
  const pending=rows.filter(r=>r.amount==null).length;
  return {month,hours,rows,pending,subtotal:rows.reduce((n,r)=>n+(r.amount||0),0),total:pending?null:rows.reduce((n,r)=>n+r.amount,0),verified};
}
export function laborReport(month,profile,records,asOf) {
  const period=payPeriod(month),holidays=[];
  if(profile?.startDate)for(const date of days(period.start,period.end))if(day(date)===profile.holidayDay)holidays.push(holidayReport(profile,records,date,asOf));
  const reference=min(monthEnd(month),asOf,profile?.endDate);
  const recent=profile?.startDate && profile.startDate<=reference?windowHours(profile,records,max(profile.startDate,addDays(reference,-27)),reference):null;
  return {ruleDate:RULE_DATE,month,asOf:reference,period,monthly:windowHours(profile,records,month+'-01',monthEnd(month)),recent,holidays,holidayTotal:holidays.reduce((n,r)=>n+(r.amount||0),0),holidayPotential:holidays.reduce((n,r)=>n+(r.potential||0),0),holidayPending:holidays.filter(r=>r.amount==null).length,retirement:retirementReport(profile,records,reference),insurance:insuranceReport(month,profile,records)};
}
