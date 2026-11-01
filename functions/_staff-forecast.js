import { addDays, weekOf, today } from './_staff-schedule.js';
import { payrollPeriod } from './_staff-payroll.js';
import { days, day, monthEnd, holidayReport, insuranceReport } from '../staff/labor/model.js';

const empty = () => ({settings:{},shifts:{},adjustments:{},reconciliations:{}});
const clock = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '') ? Number(s.slice(0,2))*60+Number(s.slice(3)) : NaN;
const payMonth = date => date.slice(8) <= '25' ? date.slice(0,7) : addDays(date.slice(0,7)+'-01',32).slice(0,7);
const signature = (s,d,id) => JSON.stringify([(s?.draft?.[d]||[]).includes(id),(s?.published?.assignments?.[d]||[]).includes(id),s?.start,s?.end,s?.published?.start,s?.published?.end]);
const sum = (rows,key) => rows.reduce((n,r)=>n+(r[key]||0),0);

// Carry rates forward for this estimate only; never change payroll settings.
function settingFor(payruns,month,id) {
  const source=Object.keys(payruns).filter(m=>m<=month && payruns[m].settings?.[id]).sort().at(-1);
  return {source:source||null,...(source?payruns[source].settings[id]:{})};
}
function projectedShift(date,id,schedules,payruns,asOf) {
  const month=payMonth(date),record=payruns[month]||empty();
  if(record.snapshot){
    const row=record.snapshot.report.rows.find(r=>r.id===id),shift=row?.shifts.find(s=>s.date===date);
    return shift?{...shift,hourlyRate:row.hourlyRate,source:'finalized',provisional:false,future:false,settingMonth:month,missing:[]}:null;
  }
  const s=schedules.get(weekOf(date));if(!s)return null;
  const pub=s.published, draft=s.draft?.[date],saved=record.reconciliations?.[date]?.[id];
  const resolution=date<=asOf && saved?.signature===signature(s,date,id)?saved:null;
  const source=resolution?resolution.choice:Object.hasOwn(s.draft||{},date)?'draft':'published';
  const ids=source==='off'?[]:source==='draft'?draft:pub?.assignments?.[date];
  if(!ids?.includes(id))return null;
  const start=source==='draft'?s.start:pub.start,end=source==='draft'?s.end:pub.end;
  const setting=settingFor(payruns,month,id),duration=clock(end)-clock(start),override=record.shifts?.[date]?.[id];
  const missing=[];
  if(!Number.isSafeInteger(setting.hourlyRate)||setting.hourlyRate<=0)missing.push('시급');
  if(!Number.isInteger(setting.breakMinutes))missing.push('무급 휴게시간');
  if(!Number.isFinite(duration)||duration<=0)missing.push('근무시간');
  const minutes=override?.minutes??(missing.includes('무급 휴게시간')||!Number.isFinite(duration)?null:Math.max(0,duration-setting.breakMinutes));
  const amount=missing.length?null:Math.round(setting.hourlyRate*minutes/60);
  const provisional=!resolution && (!pub?.assignments?.[date]?.includes(id)||start!==pub.start||end!==pub.end);
  return {date,start,end,minutes,amount,hourlyRate:setting.hourlyRate??null,payer:s.payers?.[date]?.[id]||'',source,provisional,future:date>asOf,settingMonth:setting.source,missing};
}
function wageWindow(start,end,id,schedules,payruns,profile,records,asOf) {
  const shifts=days(start,end).map(d=>projectedShift(d,id,schedules,payruns,asOf)).filter(Boolean);
  const missing=shifts.filter(s=>s.amount==null).length,knownBase=sum(shifts,'amount');
  const holidays=profile?.startDate?days(start,end).filter(d=>day(d)===profile.holidayDay).map(d=>holidayReport(profile,records,d,asOf)):[];
  const holidayMissing=profile?holidays.filter(h=>h.potential==null).length:1;
  const holiday=holidayMissing?null:sum(holidays,'potential');
  const base=missing?null:knownBase;
  const payers={};for(const s of shifts){const p=s.payer||'unassigned';payers[p]??={amount:0,missing:0};payers[p].amount+=s.amount||0;payers[p].missing+=Number(s.amount==null);}
  return {start,end,shifts,minutes:shifts.some(s=>s.minutes==null)?null:sum(shifts,'minutes'),base,knownBase,missing,holiday,holidayMissing,holidayConditional:holidays.some(h=>h.amount==null),gross:base==null||holiday==null?null:base+holiday,provisional:shifts.filter(s=>s.provisional).length,future:shifts.filter(s=>s.future).length,carryMonths:[...new Set(shifts.filter(s=>s.settingMonth && s.settingMonth!==payMonth(s.date)).map(s=>s.settingMonth))],payers};
}

export function calculateForecast(month,employee,schedules,payruns,profile,records,asOf=today()) {
  const period=payrollPeriod(month),projectedRecords=structuredClone(records);
  for(const date of days(addDays(period.start,-27),monthEnd(month))){
    const m=date.slice(0,7),shift=projectedShift(date,employee.id,schedules,payruns,asOf);
    projectedRecords[m]||={};projectedRecords[m].overrides||={};
    projectedRecords[m].overrides[date]={minutes:shift?shift.minutes:0,rate:shift?.hourlyRate??settingFor(payruns,payMonth(date),employee.id).hourlyRate??null};
  }
  const payday=wageWindow(period.start,period.end,employee.id,schedules,payruns,profile,projectedRecords,asOf);
  const calendar=wageWindow(month+'-01',monthEnd(month),employee.id,schedules,payruns,profile,projectedRecords,asOf);
  const facts={...(records[month]?.facts||{})};
  // A scenario: scheduled hours are agreed hours, gross calendar-month wages are
  // remuneration. The actual contractual/declared report remains separate.
  facts.pensionIncome=calendar.gross;
  for(const k of ['pensionBase','healthBase','employmentBase','accidentBase'])facts[k]=calendar.gross;
  const fullMonth=profile?.startDate<=calendar.start && (!profile?.endDate||profile.endDate>=calendar.end);
  const assumedCharges=[];
  for(const k of ['pensionCharge','healthCharge'])if(!facts[k]||facts[k]==='unknown'){
    if(fullMonth){facts[k]='full';assumedCharges.push(k);}
  }
  projectedRecords[month]={...projectedRecords[month],facts};
  const insurance=insuranceReport(month,profile,projectedRecords);
  return {id:employee.id,name:employee.name,active:employee.active,payday,calendar,insurance,cost:calendar.gross==null||insurance.total==null?null:calendar.gross+insurance.total,assumedCharges,profileMissing:!profile,insuranceFactsMissing:facts.standardCase!=='yes'};
}

export async function readForecast(db,month,employees,asOf=today()) {
  const period=payrollPeriod(month),end=monthEnd(month),weeks=[];
  for(let w=weekOf(addDays(period.start,-27));w<=end;w=addDays(w,7))weeks.push(w);
  const [scheduleEntries,allPayruns]=await Promise.all([Promise.all(weeks.map(async w=>[w,await db.get(`week:${w}`)])),db.list({prefix:'payrun:'})]);
  const schedules=new Map(scheduleEntries),payruns=Object.fromEntries([...allPayruns].map(([k,v])=>[k.slice(7),v]));
  const rows=await Promise.all(employees.filter(e=>e.role!=='core').map(async e=>{
    const [profile,allRecords]=await Promise.all([db.get(`labor:profile:${e.id}`),db.list({prefix:`labor:month:${e.id}:`})]);
    const records=Object.fromEntries([...allRecords].map(([k,v])=>[k.slice(-7),v]));
    return calculateForecast(month,e,schedules,payruns,profile,records,asOf);
  }));
  const visible=rows.filter(r=>r.active||r.payday.shifts.length||r.calendar.shifts.length||r.payday.holiday||r.calendar.holiday);
  const total=key=>visible.some(r=>r[key].gross==null)?null:visible.reduce((n,r)=>n+r[key].gross,0);
  return {month,asOf,period:{start:period.start,end:period.end},calendar:{start:month+'-01',end},rows:visible,totals:{payday:total('payday'),base:visible.some(r=>r.payday.base==null)?null:visible.reduce((n,r)=>n+r.payday.base,0),knownBase:visible.reduce((n,r)=>n+r.payday.knownBase,0),calendar:total('calendar'),insurance:visible.some(r=>r.insurance.total==null)?null:visible.reduce((n,r)=>n+r.insurance.total,0),cost:visible.some(r=>r.cost==null)?null:sum(visible,'cost')}};
}
