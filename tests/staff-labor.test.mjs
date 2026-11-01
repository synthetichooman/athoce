import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { laborReport, insuranceReport, holidayReport, retirementReport, agreed, payPeriod } from '../staff/labor/model.js';
import { cleanProfile, cleanFacts } from '../functions/_staff-labor.js';
import { StaffSchedule } from '../workers/staff-schedule/index.js';
import { onRequest } from '../functions/api/staff/[[path]].js';
import { createStaffAdminCookie } from '../functions/_staff-admin-access.js';
import { tokenHash } from '../functions/_staff-schedule.js';
const profile=(minutes=[240,240,240,240,240,0,0])=>({employer:'시험 사업주',startDate:'2025-01-01',endDate:'',holidayDay:0,referenceDays:[1,2,3,4,5],segments:[{start:'2025-01-01',end:'',minutes,rate:11000}]});
const facts=()=>({standardCase:'yes',age:'18to59',duration:'3plus',over65:'unknown',pensionIncome:1000000,pensionBase:1000000,healthBase:1000000,employmentBase:1000000,accidentBase:1000000,stabilityRate:.25,accidentRate:.86,pensionCharge:'full',healthCharge:'full',overrides:{}});
test('monthly 60h and four-week 15h thresholds remain separate, including exact boundaries',()=>{
 const p=profile([180,180,180,180,180,0,0]);let r=laborReport('2026-02',p,{},'2026-02-28');assert.equal(r.monthly.minutes,3600);assert.equal(r.recent.average,900);assert.equal(r.recent.met,true);
 p.segments[0].minutes=[179,179,179,179,179,0,0];r=laborReport('2026-02',p,{},'2026-02-28');assert.equal(r.monthly.minutes,3580);assert.equal(r.recent.met,false);
 p.segments[0].minutes=[180,180,180,180,180,0,0];r=laborReport('2026-03',p,{},'2026-03-28');assert.equal(r.monthly.minutes,3960);assert.equal(r.recent.average,900);assert.deepEqual(payPeriod('2026-01'),{start:'2025-12-26',end:'2026-01-25'});
});
test('holiday estimates require full employment week, 15h contractual average and explicit current attendance',()=>{
 const p=profile(),records={};let h=holidayReport(p,records,'2026-10-25','2026-11-01');assert.equal(h.state,'pending');assert.equal(h.amount,null);assert.equal(h.potential,44000);
 records['2026-10']={attendance:{'2026-10-25':{result:'yes',basis:h.basis}}};h=holidayReport(p,records,'2026-10-25','2026-11-01');assert.equal(h.amount,44000);
 p.segments[0].rate=12000;h=holidayReport(p,records,'2026-10-25','2026-11-01');assert.equal(h.stale,true);assert.equal(h.amount,null);assert.equal(h.potential,48000);
 records['2026-10'].attendance['2026-10-25']={result:'no',basis:h.basis};assert.equal(holidayReport(p,records,'2026-10-25','2026-11-01').amount,0);
 assert.equal(holidayReport(p,records,'2026-11-08','2026-11-01').state,'future');
 p.startDate='2026-10-20';assert.equal(holidayReport(p,{},'2026-10-25','2026-11-01').state,'excluded');
 p.startDate='2026-10-19';p.segments[0].start=p.startDate;h=holidayReport(p,{},'2026-10-25','2026-11-01');assert.equal(h.potential,48000);
 p.endDate='2026-10-24';assert.equal(holidayReport(p,{},'2026-10-25','2026-11-01').amount,0);
});
test('missing contract periods and hire dates are unknown rather than zero or no eligibility',()=>{
 const r=laborReport('2026-10',null,{},'2026-11-01');assert.equal(r.monthly.missing,31);assert.equal(r.insurance.total,null);assert.equal(r.retirement.ready,false);
 const p=profile();p.segments[0].end='2026-10-10';const partial=laborReport('2026-10',p,{},'2026-11-01');assert.equal(partial.monthly.missing,21);assert.ok(partial.retirement.unknown>0);assert.ok(partial.holidayPending>0);
});
test('retirement counts qualifying reverse 28-day blocks and preserves excluded and unknown days',()=>{
 const p=profile([120,120,120,120,120,0,0]);p.startDate='2026-01-01';p.segments=[{start:p.startDate,end:'2026-01-04',minutes:[120,120,120,120,120,0,0],rate:11000},{start:'2026-01-05',end:'2026-02-01',minutes:[180,180,180,180,180,0,0],rate:11000}];
 const r=retirementReport(p,{},'2026-02-01');assert.equal(r.total,32);assert.equal(r.eligible,28);assert.equal(r.excluded,4);assert.equal(r.unknown,0);assert.equal(r.blocks[0].start,'2026-01-05');
 p.segments.pop();assert.equal(retirementReport(p,{},'2026-02-01').unknown,28);
 const ongoing=retirementReport(profile(),{},'2026-11-01');assert.ok(ongoing.eligible>=365);assert.equal(ongoing.eligible,ongoing.total);
});
test('calendar overrides change hours, invalidate attendance and do not mutate the contract',()=>{
 const p=profile(),before=JSON.stringify(p);const records={'2026-10':{overrides:{'2026-10-05':{minutes:0,rate:11000}}}};
 assert.equal(agreed(p,records,'2026-10-05').minutes,0);assert.equal(JSON.stringify(p),before);assert.equal(laborReport('2026-10',p,records,'2026-11-01').monthly.minutes,5040);
});
test('2026 employer insurance calculations use distinct bases, actual accident rate and LTC fraction',()=>{
 const r=insuranceReport('2026-10',profile(),{'2026-10':{facts:facts()}});assert.equal(r.pending,0);assert.deepEqual(r.rows.map(x=>x.amount),[47500,35950,4720,11500,8600]);assert.equal(r.total,108270);
 const f=facts();f.stabilityRate=null;f.accidentRate=null;let pending=insuranceReport('2026-10',profile(),{'2026-10':{facts:f}});assert.equal(pending.pending,2);assert.equal(pending.total,null);assert.equal(pending.subtotal,88170);
 const future=insuranceReport('2027-01',profile(),{'2027-01':{facts:facts()}});assert.equal(future.total,null);assert.ok(future.rows.every(r=>r.amount==null||r.status==='no'));
});
test('pension applies 2026 half-year caps and low-hours income exception; health remains excluded',()=>{
 const f=facts();f.pensionBase=99999999;assert.equal(insuranceReport('2026-06',profile(),{'2026-06':{facts:f}}).rows[0].amount,302570);assert.equal(insuranceReport('2026-07',profile(),{'2026-07':{facts:f}}).rows[0].amount,313020);
 f.pensionBase=0;assert.equal(insuranceReport('2026-06',profile(),{'2026-06':{facts:f}}).rows[0].amount,19000);assert.equal(insuranceReport('2026-07',profile(),{'2026-07':{facts:f}}).rows[0].amount,19470);
 const p=profile([60,60,60,60,60,0,0]);f.pensionIncome=2200000;let r=insuranceReport('2026-10',p,{'2026-10':{facts:f}});assert.equal(r.rows[0].status,'yes');assert.equal(r.rows[1].status,'no');assert.equal(r.rows[3].status,'yes');assert.equal(r.rows[4].status,'yes');
 f.pensionIncome=2199999;f.duration='1to3';r=insuranceReport('2026-10',p,{'2026-10':{facts:f}});assert.equal(r.rows[0].status,'no');assert.equal(r.rows[3].status,'no');
 f.pensionIncome=null;r=insuranceReport('2026-10',p,{'2026-10':{facts:f}});assert.equal(r.rows[0].status,'unknown');
});
test('age65, unknown exceptions, acquisition-month exemptions and manual authority results are explicit',()=>{
 const f=facts();f.age='65plus';f.over65='new';let r=insuranceReport('2026-10',profile(),{'2026-10':{facts:f}});assert.equal(r.rows[0].status,'no');assert.equal(r.rows[3].amount,2500);
 f.over65='continued';assert.equal(insuranceReport('2026-10',profile(),{'2026-10':{facts:f}}).rows[3].amount,11500);
 f.over65='unknown';assert.equal(insuranceReport('2026-10',profile(),{'2026-10':{facts:f}}).rows[3].status,'unknown');
 f.age='18to59';f.pensionCharge='exempt';f.healthCharge='exempt';r=insuranceReport('2026-10',profile(),{'2026-10':{facts:f}});assert.deepEqual(r.rows.slice(0,3).map(r=>r.amount),[0,0,0]);
 f.standardCase='unknown';r=insuranceReport('2026-10',profile(),{'2026-10':{facts:f}});assert.ok(r.rows.every(r=>r.status==='unknown'));
 f.overrides={accident:{status:'yes',reason:'공단 확인 2026-10'}};r=insuranceReport('2026-10',profile(),{'2026-10':{facts:f}});assert.equal(r.rows[4].amount,8600);
});
test('profile and insurance input validation rejects overlapping periods, overwork, invalid dates and unsupported values',()=>{
 assert.ok(cleanProfile(profile()));const p=profile();p.segments.push({...p.segments[0]});assert.equal(cleanProfile(p),null);
 assert.equal(cleanProfile({...profile(),startDate:'2026-02-30'}),null);assert.equal(cleanProfile(profile([481,0,0,0,0,0,0])),null);assert.equal(cleanProfile(profile([480,480,480,480,480,1,0])),null);
 assert.ok(cleanFacts(facts()));assert.equal(cleanFacts({...facts(),accidentRate:NaN}),null);assert.equal(cleanFacts({...facts(),stabilityRate:.3}),null);assert.equal(cleanFacts({...facts(),overrides:{pension:{status:'no',reason:''}}}),null);
});
async function fixture(t){
 t.mock.method(Date,'now',()=>Date.parse('2026-11-01T12:00:00+09:00'));const id=randomUUID(),credential=await tokenHash('a'.repeat(64));const state=new Map([['employees',[{id,name:'시험 스태프',role:'staff',active:true,credential}]]]);const storage={get:async k=>structuredClone(state.get(k)),put:async(k,v)=>state.set(k,structuredClone(v)),list:async({prefix})=>new Map([...state].filter(([k])=>k.startsWith(prefix))),transaction:async fn=>fn(storage)};
 const object=new StaffSchedule({storage}),env={ADMIN_PASSWORD:'local-owner-fixture',STAFF_ADMIN_PASSWORD_SHA256:'b'.repeat(64),STAFF_SCHEDULE:{idFromName:n=>n,get:()=>({fetch:(u,o)=>object.fetch(new Request(u,o))})}},cookie=(await createStaffAdminCookie(env)).split(';')[0];
 const call=async(body,{auth=true,origin='https://athoce.kr'}={})=>{const r=await onRequest({request:new Request(`https://athoce.kr/api/staff/admin/labor?month=2026-10&employeeId=${id}`,{method:body?'POST':'GET',headers:{...(auth?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify({employeeId:id,month:'2026-10',...body})}:{})}),env,params:{path:'admin/labor'}});return {status:r.status,data:await r.json()};};return {id,state,object,credential,call};
}
test('labor API is administrator-only, origin-protected and never exposes credentials',async t=>{
 const f=await fixture(t);assert.equal((await f.call(null,{auth:false})).status,401);const r=await f.call();assert.equal(r.status,200);assert.equal(JSON.stringify(r.data).includes(f.credential),false);assert.equal((await f.call({op:'labor.profile'},{origin:'https://other.test'})).status,403);
 const response=await f.object.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({action:'employee-write',credential:f.credential,body:{op:'labor.profile'}})}));assert.equal(response.status,400);
});
test('saved profiles, month facts and attendance are versioned, audited, conflict-safe and block employee deletion',async t=>{
 const f=await fixture(t);let r=(await f.call()).data;let body={op:'labor.profile',profile:profile(),version:0,source:r.source};assert.equal((await f.call(body)).status,200);assert.equal((await f.call(body)).status,409);
 r=(await f.call()).data;assert.equal(r.profile.version,1);assert.equal((await f.call({op:'labor.facts',facts:facts(),version:0,source:r.source})).status,200);
 r=(await f.call()).data;const h=r.report.holidays[0];assert.equal((await f.call({op:'labor.attendance',date:h.date,result:'yes',version:r.record.version,source:r.source})).status,200);
 r=(await f.call()).data;assert.equal(r.report.holidays[0].amount,44000);assert.equal((await f.call({op:'labor.profile',profile:{...profile(),employer:'변경 사업주'},version:1,source:r.source})).status,200);
 r=(await f.call()).data;assert.equal(r.report.holidays[0].stale,true);assert.equal(r.report.holidays[0].amount,null);
 assert.ok([...f.state.keys()].filter(k=>k.startsWith('labor:audit:')).length>=4);
 const response=await f.object.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({action:'admin-write',body:{op:'employee.delete',id:f.id}})}));assert.equal(response.status,409);assert.equal(f.state.get('employees').length,1);
 assert.equal([...f.state.keys()].some(k=>k.startsWith('payrun:')),false);
});
test('partial hire/termination months require a separate insurance qualification review',()=>{
 const p=profile();p.startDate='2026-10-20';p.segments[0].start=p.startDate;const f=facts();f.duration='1to3';let r=insuranceReport('2026-10',p,{'2026-10':{facts:f}});assert.equal(r.rows[0].status,'unknown');assert.equal(r.rows[1].status,'unknown');assert.equal(r.rows[3].status,'unknown');
 f.duration='3plus';assert.equal(insuranceReport('2026-10',p,{'2026-10':{facts:f}}).rows[3].status,'yes');
 p.startDate='2025-01-01';p.endDate='2026-10-10';assert.equal(insuranceReport('2026-10',p,{'2026-10':{facts:f}}).rows[1].status,'unknown');
 f.age='unknown';f.overrides={employment:{status:'yes',reason:'공단 확인'}};assert.equal(insuranceReport('2026-10',profile(),{'2026-10':{facts:f}}).rows[3].amount,null);
});
test('attendance across payroll month boundaries is saved under the holiday calendar month',async t=>{
 const f=await fixture(t);let r=(await f.call()).data;assert.equal((await f.call({op:'labor.profile',profile:profile(),version:0,source:r.source})).status,200);
 r=(await f.call()).data;const h=r.report.holidays.find(h=>h.date==='2026-09-27');assert.ok(h);assert.equal((await f.call({op:'labor.attendance',date:h.date,result:'yes',version:0,source:r.source})).status,200);
 assert.equal(f.state.get(`labor:month:${f.id}:2026-09`).attendance[h.date].result,'yes');r=(await f.call()).data;assert.equal(r.report.holidays.find(x=>x.date===h.date).amount,44000);assert.equal(r.record.version,0);
});
test('date overrides and contract transitions cannot create a week beyond ordinary 40 hours',async t=>{
 const f=await fixture(t);let r=(await f.call()).data;const p=profile([480,480,480,480,480,0,0]);assert.equal((await f.call({op:'labor.profile',profile:p,version:0,source:r.source})).status,200);
 r=(await f.call()).data;assert.equal((await f.call({op:'labor.override',date:'2026-10-03',minutes:60,rate:11000,note:'토요일 추가',version:0,source:r.source})).status,400);
 p.segments=[{...p.segments[0],end:'2026-10-02'},{start:'2026-10-03',end:'',minutes:[0,0,0,0,0,480,480],rate:11000}];assert.equal((await f.call({op:'labor.profile',profile:p,version:1,source:r.source})).status,400);assert.equal(f.state.get(`labor:profile:${f.id}`).version,1);
});
