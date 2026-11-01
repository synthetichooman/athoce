import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateForecast,readForecast} from '../functions/_staff-forecast.js';
import {readPayrun,calculatePayrun} from '../functions/_staff-payrun.js';
import {readLabor} from '../functions/_staff-labor.js';
import {addDays,weekOf} from '../functions/_staff-schedule.js';
import {days} from '../staff/labor/model.js';

function fixture(){
 const employee={id:'s1',name:'테스트',active:true,role:'staff'},schedules=new Map();
 const profile={employer:'예시 사업주',startDate:'2026-01-01',holidayDay:0,referenceDays:[1,2,3,4,5],segments:[{start:'2026-01-01',minutes:[360,360,360,0,0,0,0],rate:11000}]};
 const facts={standardCase:'yes',age:'18to59',duration:'3plus',over65:'unknown',pensionCharge:'full',healthCharge:'full',pensionIncome:9999999,pensionBase:9999999,healthBase:9999999,employmentBase:9999999,accidentBase:9999999,stabilityRate:.25,accidentRate:.86};
 const record={version:1,settings:{s1:{hourlyRate:11000,breakMinutes:60}},shifts:{},adjustments:{},reconciliations:{},history:[],snapshot:null},payruns={'2026-11':record};
 const records={'2026-11':{version:1,facts,overrides:{},attendance:{}}};
 function shift(date,{published=true,assigned=true}={}){const week=weekOf(date);if(!schedules.has(week))schedules.set(week,{week,version:1,start:'13:00',end:'20:00',draft:{},payers:{},published:{start:'13:00',end:'20:00',assignments:{}}});const s=schedules.get(week);s.draft[date]=assigned?['s1']:[];if(published)s.published.assignments[date]=assigned?['s1']:[];s.payers[date]={s1:'at'};return s;}
 const calc=(m='2026-11',p=profile)=>calculateForecast(m,employee,schedules,payruns,p,records,'2026-11-01');
 return {employee,schedules,profile,records,payruns,record,shift,calc};
}
test('forecast includes future published and saved draft shifts once; applications and core staff are not payroll',async()=>{
 const f=fixture();f.shift('2026-10-30');f.shift('2026-11-05');f.shift('2026-11-07',{published:false});
 const r=f.calc();assert.equal(r.payday.shifts.length,3);assert.equal(r.payday.base,198000);assert.equal(r.payday.future,2);assert.equal(r.payday.provisional,1);assert.equal(r.calendar.base,132000);
 const before=JSON.stringify([...f.schedules]);f.calc();assert.equal(JSON.stringify([...f.schedules]),before);
 const actual=calculatePayrun('2026-11',[f.employee],f.schedules,f.record,'2026-11-01');assert.equal(actual.totals.base,66000);assert.equal(actual.totals.shifts,1);
});
test('a saved replacement or day off replaces a published assignment, never adds both',()=>{
 const f=fixture(),s=f.shift('2026-11-06');s.draft['2026-11-06']=[];assert.equal(f.calc().payday.base,0);
 s.draft['2026-11-06']=['other'];assert.equal(f.calc().payday.shifts.length,0);
 delete s.draft['2026-11-06'];assert.equal(f.calc().payday.base,66000);
 s.draft['2026-11-06']=['s1'];s.end='19:00';assert.equal(f.calc().payday.base,55000);assert.equal(f.calc().payday.provisional,1);
});
test('missing rate, unpaid break or invalid hours remain unknown rather than zero; earlier settings are explicit assumptions',()=>{
 const f=fixture();f.shift('2026-11-09');delete f.record.settings.s1;assert.equal(f.calc().payday.base,null);assert.ok(f.calc().payday.shifts[0].missing.includes('시급'));
 f.payruns['2026-10']={settings:{s1:{hourlyRate:10000,breakMinutes:30}}};assert.equal(f.calc().payday.base,65000);assert.deepEqual(f.calc().payday.carryMonths,['2026-10']);assert.deepEqual(f.record.settings,{});
 f.record.settings.s1={hourlyRate:12000};assert.equal(f.calc().payday.base,null);assert.equal(f.calc().payday.minutes,null);
 f.record.settings.s1.breakMinutes=0;f.schedules.values().next().value.end='12:00';assert.equal(f.calc().payday.base,null);
});
test('25th payday and calendar insurance use different periods, rates and future shifts',()=>{
 const f=fixture();for(const d of ['2026-10-26','2026-11-25','2026-11-26','2026-11-30'])f.shift(d);
 f.payruns['2026-12']={settings:{s1:{hourlyRate:15000,breakMinutes:0}}};const r=f.calc();
 assert.equal(r.payday.base,132000);assert.equal(r.calendar.base,276000);assert.equal(r.payday.end,'2026-11-25');assert.equal(r.calendar.end,'2026-11-30');assert.equal(r.calendar.shifts.at(-1).amount,105000);
 delete f.payruns['2026-12'];assert.equal(f.calc().calendar.base,198000);assert.deepEqual(f.calc().calendar.carryMonths,['2026-11']);
});
test('insurance uses projected monthly wages and scheduled hours, leaving declared bases unchanged',()=>{
 const f=fixture();for(const d of days('2026-09-29','2026-11-30'))if([1,2,3].includes(new Date(d+'T00:00:00Z').getUTCDay()))f.shift(d);
 f.payruns['2026-10']={...f.record,settings:{s1:{hourlyRate:11000,breakMinutes:60}}};
 const before=JSON.stringify(f.records),r=f.calc();assert.equal(r.calendar.base,858000);assert.ok(r.calendar.holiday>0);assert.ok(r.insurance.total>0);assert.equal(r.insurance.rows[0].status,'yes');assert.equal(r.cost,r.calendar.gross+r.insurance.total);
 assert.equal(r.insurance.rows.find(i=>i.key==='employment').amount,Math.floor(r.calendar.gross*.0115/10)*10);
 assert.equal(JSON.stringify(f.records),before);assert.ok(r.insurance.total<200000);assert.ok(r.payday.holidayConditional);
});
test('no profile or unknown insurance facts do not invent holiday entitlement, eligibility or zero premiums',()=>{
 const f=fixture();f.shift('2026-11-03');const r=f.calc('2026-11',null);assert.equal(r.payday.base,66000);assert.equal(r.payday.holiday,null);assert.equal(r.cost,null);assert.equal(r.insurance.total,null);assert.equal(r.profileMissing,true);
 f.records['2026-11'].facts={};assert.equal(f.calc().insurance.total,null);
});
test('a 60-hour planned month qualifies pension and health; fewer hours may be excluded, never inferred from declared bases',()=>{
 const f=fixture();for(const d of days('2026-11-01','2026-11-10'))f.shift(d);let r=f.calc();assert.equal(r.calendar.minutes,3600);assert.equal(r.insurance.rows[0].status,'yes');assert.equal(r.insurance.rows[1].status,'yes');
 f.shift('2026-11-10',{assigned:false});r=f.calc();assert.equal(r.insurance.rows[0].status,'no');assert.equal(r.insurance.rows[1].status,'no');
});
test('normal-month premium assumption is labeled; entry month and unverified years remain pending',()=>{
 const f=fixture();for(const d of days('2026-11-01','2026-11-10'))f.shift(d);f.records['2026-11'].facts.pensionCharge='unknown';f.records['2026-11'].facts.healthCharge='unknown';
 assert.deepEqual(f.calc().assumedCharges,['pensionCharge','healthCharge']);
 f.profile.startDate='2026-11-02';assert.equal(f.calc().insurance.total,null);assert.deepEqual(f.calc().assumedCharges,[]);
 const next=f.calc('2027-01');assert.equal(next.insurance.verified,false);assert.equal(next.insurance.total,null);
});
test('finalized payrun shift snapshots and explicit past reconciliation choices win over changed schedules',()=>{
 const f=fixture();const s=f.shift('2026-10-30');f.record.shifts['2026-10-30']={s1:{minutes:300,note:'정정'}};
 assert.equal(f.calc().payday.base,55000);
 const signature=JSON.stringify([true,true,s.start,s.end,s.published.start,s.published.end]);f.record.reconciliations['2026-10-30']={s1:{signature,choice:'off'}};assert.equal(f.calc().payday.base,0);
 f.record.snapshot={report:{rows:[{id:'s1',hourlyRate:11000,shifts:[{date:'2026-10-30',start:'13:00',end:'20:00',minutes:300,amount:55000,payer:'ce'}]}]}};
 s.draft['2026-10-30']=[];const r=f.calc();assert.equal(r.payday.base,55000);assert.equal(r.payday.shifts[0].source,'finalized');assert.equal(r.payday.payers.ce.amount,55000);
});
test('admin payrun and labor expose the same forecasts read-only, without leaking credentials or changing finalization',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-01T12:00:00+09:00'));
 const f=fixture();f.shift('2026-11-05');const state=new Map([...f.schedules].map(([w,v])=>['week:'+w,v]));state.set('payrun:2026-11',f.record);state.set('labor:profile:s1',f.profile);state.set('labor:month:s1:2026-11',f.records['2026-11']);
 const before=JSON.stringify([...state]);const db={get:async k=>structuredClone(state.get(k)),list:async({prefix})=>new Map([...state].filter(([k])=>k.startsWith(prefix)))};
 const staff=[{...f.employee,credential:'secret-token'},{id:'core',role:'core',active:true}];
 const p=await (await readPayrun(db,'2026-11',staff)).json(),l=await (await readLabor(db,'2026-11','s1',staff)).json();
 assert.deepEqual(p.forecast,l.forecast);assert.equal(p.forecast.rows.length,1);assert.equal(p.forecast.totals.base,66000);assert.equal(p.report.totals.base,0);assert.ok(p.blockers.some(b=>b.includes('기간')));assert.equal(JSON.stringify(p.forecast).includes('secret-token'),false);assert.equal(JSON.stringify([...state]),before);
 const filtered=await readForecast(db,'2026-11',[{...f.employee,active:false}]);assert.equal(filtered.rows.length,1);
});
