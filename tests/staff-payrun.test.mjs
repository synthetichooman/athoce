import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { StaffSchedule } from '../workers/staff-schedule/index.js';
import { onRequest } from '../functions/api/staff/[[path]].js';
import { createStaffAdminCookie } from '../functions/_staff-admin-access.js';
import { weekOf, tokenHash } from '../functions/_staff-schedule.js';
import { calculatePayrun, validPayMonth } from '../functions/_staff-payrun.js';

function fixture(t, now='2026-11-26T12:00:00+09:00') {
  t.mock.method(Date,'now',()=>Date.parse(now));
  const id=randomUUID(); const employees=[{id,name:'최건',role:'staff',active:true,credential:'not-public'},{id:randomUUID(),name:'at',role:'core',active:true}];
  const state=new Map([['employees',employees]]);
  for (const date of ['2026-10-26','2026-11-01','2026-11-25','2026-11-26']) {
    const week=weekOf(date); let schedule=state.get(`week:${week}`);
    if(!schedule){schedule={week,version:1,draft:{},published:{start:'13:00',end:'20:00',assignments:{}},start:'13:00',end:'20:00',required:{},payers:{}};state.set(`week:${week}`,schedule);}
    schedule.draft[date]=[id];schedule.published.assignments[date]=[id];schedule.payers[date]={[id]:'at'};
  }
  const storage={get:async k=>structuredClone(state.get(k)),put:async(k,v)=>state.set(k,structuredClone(v)),list:async({prefix})=>new Map([...state].filter(([k])=>k.startsWith(prefix))),transaction:async fn=>fn(storage)};
  const object=new StaffSchedule({storage});
  const env={STAFF_ADMIN_PASSWORD_SHA256:awaitableHash(),ADMIN_PASSWORD:'owner-fixture',STAFF_SCHEDULE:{idFromName:n=>n,get:()=>({fetch:(u,o)=>object.fetch(new Request(u,o))})}};
  function awaitableHash(){return 'a'.repeat(64);}
  const cookie=createStaffAdminCookie(env).then(c=>c.split(';')[0]);
  async function call(body,query='2026-11',auth=true){const response=await onRequest({request:new Request(`https://athoce.kr/api/staff/admin?payrun=${query}`,{method:body?'POST':'GET',headers:{...(auth?{cookie:await cookie}:{}),...(body?{origin:'https://athoce.kr','content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,params:{path:'admin'}});return {status:response.status,data:await response.json()};}
  async function write(body){const r=await call({...body,month:body.month||'2026-11'});return r;}
  async function settings(){assert.equal((await write({op:'payrun.settings',employeeId:id,hourlyRate:11000,breakMinutes:60,version:0})).status,200);}
  return {id,employees,state,call,write,settings,env};
}
test('payrun management is admin-only and does not reveal staff credentials',async t=>{
 const f=fixture(t);assert.equal((await f.call(undefined,undefined,false)).status,401);
 const r=await f.call();assert.equal(r.status,200);assert.equal(r.data.report.rows.length,1);assert.equal(JSON.stringify(r.data).includes('not-public'),false);
 assert.equal((await f.call(undefined,'2026-13')).status,400);assert.equal((await f.call(undefined,'2025-01')).status,200);
 assert.equal(validPayMonth('2026-02-01'),false);assert.equal(validPayMonth('2019-12'),false);
 const hash=await tokenHash('employee-token');f.state.get('employees')[0].credential=hash;
 const response=await f.env.STAFF_SCHEDULE.get().fetch('https://internal',{method:'POST',body:JSON.stringify({action:'employee-write',credential:hash,body:{op:'payrun.settings',month:'2026-11',employeeId:f.id,hourlyRate:1,breakMinutes:0,version:0}})});assert.equal(response.status,400);
});
test('wages use published shifts across 26th–25th, unpaid breaks, per-shift rounding, and payer totals',async t=>{
 const f=fixture(t);await f.settings();const r=(await f.call()).data.report;
 assert.equal(r.start,'2026-10-26');assert.equal(r.end,'2026-11-25');assert.equal(r.rows[0].shifts.length,3);assert.equal(r.totals.minutes,1080);assert.equal(r.totals.base,198000);assert.equal(r.totals.payers.at,198000);assert.deepEqual(r.blockers,[]);
 const record=f.state.get('payrun:2026-11');record.settings[f.id].hourlyRate=11001;record.settings[f.id].breakMinutes=59;
 const changed=(await f.call()).data.report;assert.equal(changed.rows[0].shifts[0].amount,66189);assert.equal(changed.totals.base,198567);
});
test('unconfigured rates, missing payers, unconfirmed drafts and future payday prevent finalization',async t=>{
 const f=fixture(t,'2026-11-10T12:00:00+09:00');let r=await f.call();assert.ok(r.data.blockers.some(s=>s.includes('시급')));assert.ok(r.data.blockers.some(s=>s.includes('휴게')));assert.ok(r.data.blockers.some(s=>s.includes('기간')));
 assert.equal((await f.write({op:'payrun.finalize',version:0,source:r.data.source})).status,409);
 await f.settings();delete f.state.get('week:2026-10-26').payers['2026-10-26'];
 f.state.get('week:2026-11-02')?.draft;
 const schedule=f.state.get('week:2026-10-26');schedule.draft['2026-10-27']=[f.id];
 r=await f.call();assert.ok(r.data.blockers.some(s=>s.includes('지급 주체')));assert.ok(r.data.blockers.some(s=>s.includes('미확정 근무')));
});
test('shift corrections validate time, payer, reason, schedule version and preserve published assignments',async t=>{
 const f=fixture(t);await f.settings();const before=structuredClone(f.state.get('week:2026-10-26').published);
 const body={op:'payrun.shift',employeeId:f.id,date:'2026-10-26',minutes:330,payer:'ce',note:'조기 퇴근',scheduleVersion:1,version:1};
 assert.equal((await f.write({...body,note:''})).status,400);assert.equal((await f.write({...body,minutes:-1})).status,400);assert.equal((await f.write({...body,payer:'unknown'})).status,400);assert.equal((await f.write({...body,scheduleVersion:0})).status,409);
 assert.equal((await f.write(body)).status,200);assert.deepEqual(f.state.get('week:2026-10-26').published,before);
 const r=(await f.call()).data;assert.equal(r.report.rows[0].shifts[0].minutes,330);assert.equal(r.report.totals.payers.ce,60500);assert.equal(r.report.totals.total,192500);
 assert.equal((await f.write({...body,version:1})).status,409);assert.equal((await f.write({...body,version:2,date:'2026-11-26'})).status,400);
});
test('adjustments balance by payer, require a reason, replace instead of add and can be removed',async t=>{
 const f=fixture(t);await f.settings();const body={op:'payrun.adjustment',employeeId:f.id,payer:'at',amount:10000,note:'추가 수당',version:1};
 assert.equal((await f.write({...body,note:''})).status,400);assert.equal((await f.write({...body,amount:1.5})).status,400);
 assert.equal((await f.write(body)).status,200);assert.equal((await f.call()).data.report.totals.total,208000);
 assert.equal((await f.write({...body,version:2,amount:-3000,note:'세금 공제'})).status,200);assert.equal((await f.call()).data.report.totals.total,195000);
 assert.equal((await f.write({...body,version:3,amount:0,note:''})).status,200);assert.equal((await f.call()).data.report.totals.total,198000);
 assert.equal((await f.write({...body,version:4,payer:'ho',amount:-5000})).status,200);assert.ok((await f.call()).data.blockers.some(s=>s.includes('음수')));
});
test('finalization rejects stale schedule sources, freezes totals and records a reasoned reopen history',async t=>{
 const f=fixture(t);await f.settings();let r=(await f.call()).data;
 f.state.get('week:2026-10-26').version++;
 assert.equal((await f.write({op:'payrun.finalize',version:r.version,source:r.source})).status,409);
 r=(await f.call()).data;assert.equal((await f.write({op:'payrun.finalize',version:r.version,source:r.source})).status,200);
 let final=(await f.call()).data;assert.equal(final.state,'finalized');assert.equal(final.report.totals.total,198000);
 assert.equal((await f.write({op:'payrun.settings',employeeId:f.id,hourlyRate:12000,breakMinutes:0,version:2})).status,409);
 assert.equal((await f.write({op:'payroll.save',week:'2026-10-26',date:'2026-10-26',employeeId:f.id,payer:'ho',version:2})).status,409);
 const schedule=f.state.get('week:2026-10-26');schedule.published.assignments['2026-10-26']=[];
 final=(await f.call()).data;assert.equal(final.report.totals.total,198000);assert.equal(final.sourceChanged,true);
 assert.equal((await f.write({op:'payrun.reopen',version:2,reason:''})).status,400);
 assert.equal((await f.write({op:'payrun.reopen',version:2,reason:'실제 근무 확인'})).status,200);
 const reopened=(await f.call()).data;assert.equal(reopened.state,'draft');assert.equal(reopened.history.length,1);assert.equal(reopened.history[0].total,198000);assert.equal(reopened.report.totals.total,132000);
 assert.equal(f.state.get('payrun:2026-11').history[0].report.totals.total,198000);
});
test('settings copy is month-local, fills only missing staff and does not alter historical wages',async t=>{
 const f=fixture(t);await f.settings();assert.equal((await f.write({op:'payrun.copy',month:'2026-12',version:0})).status,200);
 assert.equal(f.state.get('payrun:2026-12').settings[f.id].hourlyRate,11000);
 assert.equal((await f.write({op:'payrun.settings',month:'2026-12',version:1,employeeId:f.id,hourlyRate:12000,breakMinutes:0})).status,200);
 assert.equal((await f.write({op:'payrun.copy',month:'2026-12',version:2})).status,200);assert.equal(f.state.get('payrun:2026-12').settings[f.id].hourlyRate,12000);assert.equal(f.state.get('payrun:2026-11').settings[f.id].hourlyRate,11000);
});
test('zero paid minutes can explicitly record a nonworked published shift, without counting overtime twice',async t=>{
 const f=fixture(t);await f.settings();assert.equal((await f.write({op:'payrun.shift',employeeId:f.id,date:'2026-10-26',minutes:0,payer:'at',note:'실제 미근무',version:1,scheduleVersion:1})).status,200);
 const r=(await f.call()).data;assert.equal(r.report.rows[0].shifts[0].amount,0);assert.equal(r.report.totals.total,132000);assert.equal(r.report.totals.shifts,3);
});
test('leap-day and inactive staff wages remain in the payroll period while future published shifts are excluded',()=>{
 const employee={id:'old',name:'이전 직원',active:false,role:'staff'}; const schedules=new Map([['2028-02-28',{published:{start:'13:00',end:'20:00',assignments:{'2028-02-29':['old'],'2028-03-01':['old']}},draft:{'2028-02-29':['old'],'2028-03-01':['old']},start:'13:00',end:'20:00',payers:{'2028-02-29':{old:'athoce'},'2028-03-01':{old:'at'}}}]]);
 const r=calculatePayrun('2028-03',[employee],schedules,{settings:{old:{hourlyRate:10000,breakMinutes:0}},shifts:{},adjustments:{}},'2028-02-29');assert.equal(r.rows.length,1);assert.equal(r.totals.total,70000);assert.equal(r.totals.payers.athoce,70000);assert.equal(r.rows[0].shifts.length,1);
});
test('past unpublished work can be reconciled, reset and excluded without rewriting the published schedule',async t=>{
 const f=fixture(t);await f.settings();const schedule=f.state.get('week:2026-10-26');schedule.draft['2026-10-27']=[f.id];const published=structuredClone(schedule.published);
 let r=(await f.call()).data;assert.equal(r.report.rows[0].issues[0].date,'2026-10-27');
 const body={op:'payrun.reconcile',date:'2026-10-27',employeeId:f.id,choice:'draft',payer:'ho',note:'실제 출근 확인',scheduleVersion:1,version:1};
 assert.equal((await f.write({...body,note:''})).status,400);assert.equal((await f.write({...body,choice:'published'})).status,400);assert.equal((await f.write({...body,scheduleVersion:0})).status,409);
 assert.equal((await f.write(body)).status,200);r=(await f.call()).data;assert.equal(r.report.totals.total,264000);assert.equal(r.report.totals.payers.ho,66000);assert.equal(r.blockers.length,0);assert.equal(r.report.rows[0].reconciliations.length,1);assert.deepEqual(f.state.get('week:2026-10-26').published,published);
 assert.equal((await f.write({op:'payrun.reconcile-reset',date:body.date,employeeId:f.id,version:2})).status,200);r=(await f.call()).data;assert.equal(r.report.rows[0].issues.length,1);
 assert.equal((await f.write({...body,choice:'off',payer:'',version:3,scheduleVersion:2})).status,200);r=(await f.call()).data;assert.equal(r.report.totals.total,198000);assert.equal(r.blockers.length,0);assert.equal(r.report.rows[0].reconciliations[0].choice,'off');
 f.state.get('week:2026-10-26').start='14:00';r=(await f.call()).data;assert.ok(r.report.rows[0].issues.some(i=>i.date===body.date));
});
test('payday cannot finalize an ongoing final shift but permits confirmation after its end in Korea',async t=>{
 const f=fixture(t,'2026-11-25T13:30:00+09:00');await f.settings();let r=(await f.call()).data;
 assert.ok(r.blockers.some(b=>b.includes('종료')));assert.equal((await f.write({op:'payrun.finalize',version:1,source:r.source})).status,409);
 Date.now.mock.mockImplementation(()=>Date.parse('2026-11-25T20:00:00+09:00'));r=(await f.call()).data;assert.deepEqual(r.blockers,[]);assert.equal((await f.write({op:'payrun.finalize',version:1,source:r.source})).status,200);
});
test('reopened wage adjustment edits cannot mutate any previous final report',async t=>{
 const f=fixture(t);await f.settings();const adjustment={op:'payrun.adjustment',employeeId:f.id,payer:'at',amount:10000,note:'추가 수당',version:1};assert.equal((await f.write(adjustment)).status,200);
 let r=(await f.call()).data;assert.equal((await f.write({op:'payrun.finalize',version:2,source:r.source})).status,200);
 assert.equal((await f.write({op:'payrun.reopen',version:3,reason:'수당 정정'})).status,200);assert.equal((await f.write({...adjustment,version:4,amount:20000})).status,200);
 let history=f.state.get('payrun:2026-11').history;assert.equal(history[0].report.rows[0].adjustments.at.amount,10000);assert.equal(history[0].report.totals.total,208000);
 r=(await f.call()).data;assert.equal((await f.write({op:'payrun.finalize',version:5,source:r.source})).status,200);assert.equal((await f.call()).data.report.totals.total,218000);history=f.state.get('payrun:2026-11').history;assert.equal(history[0].report.rows[0].adjustments.at.amount,10000);
});
test('payer-only edits keep default hours responsive to break changes, and custom hours can be reset',async t=>{
 const f=fixture(t);await f.settings();const shift={op:'payrun.shift',employeeId:f.id,date:'2026-10-26',minutes:360,payer:'ce',note:'',version:1,scheduleVersion:1};assert.equal((await f.write(shift)).status,200);
 assert.equal(f.state.get('payrun:2026-11').shifts['2026-10-26'][f.id],undefined);
 assert.equal((await f.write({op:'payrun.settings',employeeId:f.id,hourlyRate:11000,breakMinutes:30,version:2})).status,200);assert.equal((await f.call()).data.report.rows[0].shifts[0].minutes,390);
 assert.equal((await f.write({...shift,minutes:330,note:'조기 퇴근',version:3,scheduleVersion:2})).status,200);
 assert.equal((await f.write({...shift,minutes:330,useDefault:true,version:4,scheduleVersion:3})).status,200);assert.equal((await f.call()).data.report.rows[0].shifts[0].minutes,390);
});
test('payroll history prevents deletion and role conversion even after reopening',async t=>{
 const f=fixture(t);await f.settings();assert.equal((await f.write({op:'employee.delete',id:f.id})).status,409);assert.equal((await f.write({op:'employee.role',id:f.id,role:'core'})).status,409);
});
test('publishing after a nonworked reconciliation requires explicit review even when draft and publication now match',async t=>{
 const f=fixture(t);await f.settings();const schedule=f.state.get('week:2026-10-26');schedule.draft['2026-10-27']=[f.id];
 assert.equal((await f.write({op:'payrun.reconcile',employeeId:f.id,date:'2026-10-27',choice:'off',note:'실제 미근무',version:1,scheduleVersion:1})).status,200);
 schedule.published.assignments['2026-10-27']=[f.id];schedule.version++;schedule.payers['2026-10-27']={[f.id]:'at'};
 let r=(await f.call()).data;assert.ok(r.report.rows[0].issues.some(i=>i.date==='2026-10-27'&&i.changed));assert.equal((await f.write({op:'payrun.finalize',version:2,source:r.source})).status,409);
 assert.equal((await f.write({op:'payrun.reconcile',employeeId:f.id,date:'2026-10-27',choice:'off',note:'공개 이후에도 미근무 재확인',version:2,scheduleVersion:2})).status,200);
 r=(await f.call()).data;assert.deepEqual(r.blockers,[]);assert.equal(r.report.totals.total,198000);assert.equal(r.report.rows[0].reconciliations[0].choice,'off');
 assert.equal((await f.write({op:'payrun.reconcile-reset',employeeId:f.id,date:'2026-10-27',version:3})).status,200);assert.equal((await f.call()).data.report.totals.total,264000);
});
