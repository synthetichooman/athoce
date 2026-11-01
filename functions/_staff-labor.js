import { json, fail, today, tokenHash } from './_staff-schedule.js';
import { validPayMonth } from './_staff-payrun.js';
import { readForecast } from './_staff-forecast.js';
import { laborReport, validDate, addDays, day, agreed, holidayReport } from '../staff/labor/model.js';
const fresh = () => ({version:0,facts:{},overrides:{},attendance:{}});
const number = (v,max) => Number.isSafeInteger(v)&&v>=0&&v<=max;
const text = (v,max=160) => typeof v==='string' && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v);
const date = d => validDate(d) && d>='1960-01-01' && d<='2100-12-31';
export function cleanProfile(p) {
  if(!p || !text(p.employer)||!p.employer.trim()||!date(p.startDate)|| (p.endDate && (!date(p.endDate)||p.endDate<p.startDate)) || !number(p.holidayDay,6) || !Array.isArray(p.referenceDays)||!p.referenceDays.length||p.referenceDays.length>7||new Set(p.referenceDays).size!==p.referenceDays.length||p.referenceDays.some(d=>!number(d,6)) || !Array.isArray(p.segments)||!p.segments.length||p.segments.length>60)return null;
  const segments=[];
  for(const s of p.segments){
    if(!date(s.start)||s.start<p.startDate||(s.end&&(!date(s.end)||s.end<s.start))||(p.endDate&&(!s.end||s.end>p.endDate))||!Array.isArray(s.minutes)||s.minutes.length!==7||s.minutes.some(n=>!number(n,480))||s.minutes.reduce((a,b)=>a+b,0)>2400||!number(s.rate,1000000)||s.rate===0)return null;
    segments.push({start:s.start,end:s.end||'',minutes:s.minutes,rate:s.rate});
  }
  segments.sort((a,b)=>a.start.localeCompare(b.start));
  if(segments.some((s,i)=>i>0 && (!segments[i-1].end || s.start<=segments[i-1].end)))return null;
  return {employer:p.employer.trim(),startDate:p.startDate,endDate:p.endDate||'',holidayDay:p.holidayDay,referenceDays:p.referenceDays,segments};
}
export function cleanFacts(f) {
  if(!f || !['yes','unknown'].includes(f.standardCase)||!['unknown','under18','18to59','60to64','65plus'].includes(f.age)||!['unknown','under1','1to3','3plus'].includes(f.duration)||!['unknown','new','continued'].includes(f.over65)||!['unknown','full','exempt'].includes(f.pensionCharge)||!['unknown','full','exempt'].includes(f.healthCharge))return null;
  const out=Object.fromEntries(['standardCase','age','duration','over65','pensionCharge','healthCharge'].map(k=>[k,f[k]]));
  for(const k of ['pensionIncome','pensionBase','healthBase','employmentBase','accidentBase']){if(f[k]!=null && !number(f[k],1000000000))return null;out[k]=f[k]??null;}
  if(f.stabilityRate!=null && ![.25,.45,.65,.85].includes(f.stabilityRate))return null;
  if(f.accidentRate!=null && (typeof f.accidentRate!=='number'||!Number.isFinite(f.accidentRate)||f.accidentRate<=0||f.accidentRate>50))return null;
  out.stabilityRate=f.stabilityRate??null;out.accidentRate=f.accidentRate??null;out.overrides={};
  for(const k of ['pension','health','employment','accident']){
    const o=f.overrides?.[k]; if(!o||o.status==='auto')continue;
    if(!['yes','no'].includes(o.status)||!text(o.reason,300)||!o.reason.trim())return null;
    out.overrides[k]={status:o.status,reason:o.reason.trim()};
  }
  return out;
}
// A change of pattern or date can cross the ordinary 40-hour week boundary.
function ordinaryWeeks(profile,records) {
  const dates=[...profile.segments.flatMap(s=>[s.start,s.end].filter(Boolean)),...Object.values(records).flatMap(r=>Object.keys(r.overrides||{}))];
  const starts=new Set(dates.map(d=>addDays(d,-((day(d)+6)%7))));
  return [...starts].every(start=>Array.from({length:7},(_,i)=>agreed(profile,records,addDays(start,i)).minutes||0).reduce((a,b)=>a+b,0)<=2400);
}
async function context(db,id,month) {
  const profile=await db.get(`labor:profile:${id}`)||null;
  const records=Object.fromEntries([...(await db.list({prefix:`labor:month:${id}:`}))].map(([k,v])=>[k.slice(-7),v]));
  const record=records[month]||fresh();
  const report=laborReport(month,profile,records,today());
  const source=await tokenHash(JSON.stringify({profile,records,asOf:today()}));
  return {profile,records,record,report,source};
}
export async function readLabor(db,month,id,employees) {
  if(!validPayMonth(month))return fail('조회 월을 확인해 주세요.');
  const staff=employees.filter(e=>e.role!=='core').map(({id,name,active})=>({id,name,active}));
  const selected=id||staff.find(e=>e.active)?.id||staff[0]?.id||'';
  if(selected&&!staff.some(e=>e.id===selected))return fail('스태프를 찾지 못했습니다.',404);
  const c=selected?await context(db,selected,month):{profile:null,record:fresh(),report:null,source:''};
  const forecast=await readForecast(db,month,employees.filter(e=>e.id===selected));
  return json({ok:true,forecast,employees:staff,employeeId:selected,month,profile:c.profile,record:c.record,report:c.report,source:c.source});
}
export async function writeLabor(db,body,employees) {
  const {month,employeeId:id}=body;
  if(!validPayMonth(month)||!employees.some(e=>e.id===id&&e.role!=='core'))return fail('조회 월과 스태프를 확인해 주세요.');
  const c=await context(db,id,month);
  if(body.source!==c.source)return fail('근로조건 또는 월별 기록이 변경되었습니다. 새로고침 후 다시 확인하세요.',409);
  let key,next;
  if(body.op==='labor.profile'){
    if(body.version!==(c.profile?.version||0))return fail('근로조건이 변경되었습니다.',409);
    const profile=cleanProfile(body.profile);if(!profile)return fail('입사일·약정기간·시간·시급을 확인하세요. 기간 중복, 하루 8시간·주 40시간 초과는 입력할 수 없습니다.');
    if(!ordinaryWeeks(profile,c.records))return fail('약정기간 변경일 또는 날짜별 변경을 포함한 주 소정시간이 40시간을 초과합니다.');
    key=`labor:profile:${id}`;next={...profile,version:(c.profile?.version||0)+1};
  }else{
    if(body.version!==c.record.version)return fail('월별 기록이 변경되었습니다.',409);
    key=`labor:month:${id}:${month}`;next=structuredClone(c.record);
    if(body.op==='labor.facts'){
      const facts=cleanFacts(body.facts);if(!facts)return fail('보험 기준과 신고금액, 예외 사유를 확인해 주세요.');next.facts=facts;
    }else if(body.op==='labor.override'){
      if(!date(body.date)||!body.date.startsWith(month)||!c.profile || body.date<c.profile.startDate || (c.profile.endDate && body.date>c.profile.endDate))return fail('재직 중인 날짜를 선택해 주세요.');
      if(body.remove)delete next.overrides[body.date];
      else {if(!number(body.minutes,480)||!number(body.rate,1000000)||body.rate===0||!text(body.note,300)||!body.note.trim())return fail('약정 유급시간·시급·변경 사유를 확인해 주세요.');next.overrides[body.date]={minutes:body.minutes,rate:body.rate,note:body.note.trim()};}
    }else if(body.op==='labor.attendance'){
      if(!c.profile || !date(body.date)||body.date>today()||!['yes','no','unknown'].includes(body.result)||!text(body.note||'',300))return fail('이미 지난 주휴일의 개근 여부를 확인해 주세요.');
      const holiday=c.report.holidays.find(h=>h.date===body.date);if(!holiday)return fail('해당 급여 기간의 주휴일을 선택해 주세요.');
      // Attendance is stored in its calendar month even if the payroll period crosses months.
      const targetMonth=body.date.slice(0,7);key=`labor:month:${id}:${targetMonth}`;next=structuredClone(c.records[targetMonth]||fresh());
      if(body.result==='unknown')delete next.attendance[body.date];
      else next.attendance[body.date]={result:body.result,basis:holidayReport(c.profile,c.records,body.date,today()).basis,note:(body.note||'').trim(),at:new Date().toISOString()};
    }else return fail('잘못된 요청입니다.');
    if(body.op==='labor.override' && !ordinaryWeeks(c.profile,{...c.records,[month]:next}))return fail('날짜별 변경을 포함한 주 소정시간이 40시간을 초과합니다.');
    next.version++;
  }
  next.updatedAt=new Date().toISOString();
  const auditKey=`labor:audit:${id}:${crypto.randomUUID()}`;
  await db.put(auditKey,{op:body.op,month,at:next.updatedAt,before:await db.get(key)||null,after:next});
  await db.put(key,next);
  return json({ok:true,version:next.version});
}
