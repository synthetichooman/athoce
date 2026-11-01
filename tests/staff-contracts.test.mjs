import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { StaffSchedule } from '../workers/staff-schedule/index.js';
import { onRequest } from '../functions/api/staff/[[path]].js';
import { createStaffAdminCookie } from '../functions/_staff-admin-access.js';
import { CONTRACT_COOKIE, validateSignature, validateTerms } from '../functions/_staff-contracts.js';
import { defaultTerms, defaultShiftSchedule, shiftWorkDays, EMPLOYER_CONSENT, WORKER_CONSENT } from '../staff/contracts/model.js';
import { tokenHash } from '../functions/_staff-schedule.js';

async function fixture(t) {
  t.mock.method(Date,'now',()=>Date.parse('2026-11-01T13:00:00+09:00'));
  const employeeId=randomUUID(),id=randomUUID(), token='a'.repeat(64),code='ABCDEF0123456789';
  const state=new Map([['employees',[{id:employeeId,name:'최건',active:true,role:'staff',credential:await tokenHash('employee-secret')}]]]);
  const storage={get:async k=>structuredClone(state.get(k)),put:async(k,v)=>state.set(k,structuredClone(v)),delete:async k=>state.delete(k),list:async({prefix})=>new Map([...state].filter(([k])=>k.startsWith(prefix))),transaction:async fn=>fn(storage)};
  const object=new StaffSchedule({storage});const env={ADMIN_PASSWORD:'owner-fixture',STAFF_ADMIN_PASSWORD_SHA256:'a'.repeat(64),STAFF_SCHEDULE:{idFromName:n=>n,get:()=>({fetch:(url,options)=>object.fetch(new Request(url,options))})}};
  async function call(path='admin/contracts',body,cookie,origin='https://athoce.kr') {
    if(cookie===undefined)cookie=(await createStaffAdminCookie(env)).split(';')[0];
    const request=new Request(`https://athoce.kr/api/staff/${path}`,{method:body?'POST':'GET',headers:{cookie,...(body?{'content-type':'application/json',origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const response=await onRequest({request,env,params:{path:path.split('?')[0]}});return {status:response.status,headers:response.headers,data:await response.json()};
  }
  const terms={...defaultTerms('최건'),employerName:'테스트 고용주',representative:'홍길동',employerAddress:'서울 마포구 방울내로 56',employerContact:'02-0000-0000',workerAddress:'서울 마포구 테스트로 1',workerContact:'010-0000-0000',startDate:'2026-11-01',workDays:'매주 토요일 13:00~20:00\n매주 일요일 13:00~20:00',breaks:'16:00~17:00 무급 휴게',hourlyRate:11000,holidays:'주휴일 월요일. 관계 법령에 따른 유급휴일 적용.',insurance:'가입 요건에 따른 고용·산재·국민연금·건강보험 적용'};
  const record=()=>state.get(`contract:${id}`);
  const write=body=>call('admin/contracts',{id,version:record()?.version||0,...body});
  const save=()=>write({op:'contract.save',employeeId,terms});
  const issue=()=>write({op:'contract.issue',token,code,signature:{typed:'홍길동'},consent:EMPLOYER_CONSENT});
  async function access(accessToken=token,pin=code){const r=await call('contract/login',{token:accessToken,code:pin},'');return {...r,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
  async function sign(cookie,body={}){return call('contract',{name:'최건',email:'staff@example.com',signature:{typed:'최건'},documentHash:record().documentHash,version:record().version,consent:WORKER_CONSENT,...body},cookie);}
  return {id,employeeId,state,record,call,write,save,issue,access,sign,terms,token,code,object};
}
test('contracts require staff-admin authentication and same-origin JSON; credentials are never listed',async t=>{
  const f=await fixture(t);assert.equal((await f.call('admin/contracts',undefined,'')).status,401);assert.equal((await f.call('admin/contracts',{op:'contract.save'},undefined,'https://evil.test')).status,403);
  assert.equal((await f.save()).status,200);const listed=await f.call();assert.equal(listed.data.contracts.length,1);assert.equal(JSON.stringify(listed).includes('employee-secret'),false);assert.equal(listed.headers.get('cache-control'),'no-store');
  const r=await f.object.fetch(new Request('https://staff.internal',{method:'POST',body:JSON.stringify({action:'employee-write',credential:await tokenHash('employee-secret'),body:{op:'contract.save',id:f.id,version:0,terms:f.terms}})}));assert.equal(r.status,400);
});
test('drafts can be incomplete, but issue requires every material term and valid dates',async t=>{
  const f=await fixture(t);assert.equal((await f.write({op:'contract.save',employeeId:f.employeeId,terms:defaultTerms('최건')})).status,200);assert.equal((await f.issue()).status,400);
  assert.equal(validateTerms({...f.terms,startDate:'2026-02-30'}),null);assert.equal(validateTerms({...f.terms,endDate:'2026-01-01'}),null);assert.equal(validateTerms({...f.terms,hourlyRate:-1}),null);assert.equal(validateTerms({...f.terms,payDay:32}),null);
  assert.equal((await f.save()).status,200);assert.equal((await f.issue()).status,200);assert.equal(f.record().status,'requested');
});
test('shift drafts require agreed scope, time patterns and notice before issuance',async t=>{
  const f=await fixture(t);const shiftSchedule=defaultShiftSchedule();
  const save=()=>f.write({op:'contract.save',employeeId:f.employeeId,terms:{...f.terms,shiftSchedule,workDays:'임의로 바꾼 문구'}});
  assert.equal((await save()).status,200);assert.equal((await f.issue()).status,400);
  shiftSchedule.workload='주 1~2일, 주 6~12시간 (휴게 제외)';
  assert.equal((await save()).status,200);assert.equal((await f.issue()).status,400);
  shiftSchedule.patterns='13:00~20:00. 실제 근로일과 시간은 주간 근무표로 합의';
  assert.equal((await save()).status,200);
  assert.deepEqual(f.record().terms.shiftSchedule,shiftSchedule);
  assert.equal(f.record().terms.workDays,shiftWorkDays(shiftSchedule));
  assert.match(f.record().terms.workDays,/매주 동일한 근무 요일.*고정하지 않는다/);
  assert.match(f.record().terms.workDays,/확인하고 서명/);
  assert.equal((await f.issue()).status,200);
  const {cookie}=await f.access();const read=await f.call('contract',undefined,cookie);
  assert.equal(read.status,200);assert.equal(read.data.contract.terms.workDays,shiftWorkDays(shiftSchedule));
  assert.equal((await f.sign(cookie)).status,200);
  f.record().terms.shiftSchedule.notice='일방 변경';
  assert.equal((await f.call('contract',undefined,cookie)).status,409);
});
test('shift metadata is bounded, normalized and cannot bypass required terms',async t=>{
  const f=await fixture(t);const good={workload:'  주 6~12시간  ',patterns:'13:00~20:00',notice:'월요일 근무 전'};
  const valid=validateTerms({...f.terms,shiftSchedule:good},true);
  assert.equal(valid.shiftSchedule.workload,'주 6~12시간');assert.equal(valid.workDays,shiftWorkDays(valid.shiftSchedule));
  for(const shiftSchedule of [null,[],{},'shift',{...good,workload:'x'.repeat(501)},{...good,patterns:'bad\u0000'},{...good,notice:7}])assert.equal(validateTerms({...f.terms,shiftSchedule}),null);
  assert.equal(validateTerms({...f.terms,shiftSchedule:{...good,notice:'  '}},true),null);
  assert.equal(validateTerms({...f.terms,shiftSchedule:good,breaks:''},true),null);
  assert.deepEqual(validateTerms(f.terms,true),f.terms);assert.equal(Object.hasOwn(validateTerms(f.terms),'shiftSchedule'),false);
});
test('saving uses optimistic versions, stable employee identity and snapshots names independently',async t=>{
  const f=await fixture(t);await f.save();assert.equal((await f.write({op:'contract.save',employeeId:f.employeeId,terms:f.terms,version:0})).status,409);
  assert.equal((await f.write({op:'contract.save',employeeId:randomUUID(),terms:f.terms})).status,400);
  f.state.get('employees')[0].name='최건 변경';const record=(await f.call(`admin/contracts?id=${f.id}`)).data.contract;assert.equal(record.terms.workerName,'최건');
  assert.equal((await f.issue()).status,200);assert.equal((await f.save()).status,409);
});
test('employer signature consent is mandatory and typed signatures match the designated signer',async t=>{
  const f=await fixture(t);await f.save();assert.equal((await f.write({op:'contract.issue',token:f.token,code:f.code,signature:{typed:'다른사람'},consent:EMPLOYER_CONSENT})).status,400);
  assert.equal((await f.write({op:'contract.issue',token:f.token,code:f.code,signature:{typed:'홍길동'},consent:'yes'})).status,400);
  assert.equal((await f.issue()).status,200);assert.match(f.record().documentHash,/^[a-f0-9]{64}$/);assert.equal(f.record().employer.name,'홍길동');
});
test('link alone or a staff session cannot read contracts; a separate code exchanges for a secure scoped cookie',async t=>{
  const f=await fixture(t);await f.save();await f.issue();assert.equal((await f.call('contract',undefined,'')).status,401);
  assert.equal((await f.access(f.token,'wrongcode')).status,401);const login=await f.access();assert.equal(login.status,200);assert.deepEqual(login.data,{ok:true});assert.match(login.headers.get('set-cookie'),/Path=\/api\/staff\/contract; HttpOnly; Secure; SameSite=Strict/);
  const read=await f.call('contract',undefined,login.cookie);assert.equal(read.status,200);const text=JSON.stringify(read.data);assert.equal(text.includes('codeHash'),false);assert.equal(text.includes('sessions'),false);assert.equal(text.includes(f.token),false);assert.equal(text.includes(f.code),false);
  assert.equal((await f.call('admin/contracts',undefined,login.cookie)).status,401);assert.equal((await f.call('me',undefined,login.cookie)).status,401);
});
test('five incorrect codes trigger server-side lockout and recover after ten minutes',async t=>{
  const f=await fixture(t);await f.save();await f.issue();for(let n=0;n<5;n++)assert.equal((await f.access(f.token,'incorrect')).status,401);
  assert.equal((await f.access()).status,429);Date.now.mock.mockImplementation(()=>Date.parse('2026-11-01T13:11:00+09:00'));assert.equal((await f.access()).status,200);
});
test('request links expire and new links invalidate all old sessions',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const old=await f.access();
  Date.now.mock.mockImplementation(()=>Date.parse('2026-12-02T13:00:00+09:00'));assert.equal((await f.access()).status,410);assert.equal((await f.call('contract',undefined,old.cookie)).status,401);
  assert.equal((await f.write({op:'contract.link',token:'b'.repeat(64),code:'NEWWORKERCODE1'})).status,200);assert.equal((await f.access()).status,401);assert.equal((await f.access('b'.repeat(64),'NEWWORKERCODE1')).status,200);
});
test('recipient validates consent, email, full name and document revision before signing',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const {cookie}=await f.access();
  for(const body of [{consent:false},{email:'not-email'},{name:'다른사람'},{signature:{typed:'다른사람'}}])assert.equal((await f.sign(cookie,body)).status,400);
  assert.equal((await f.sign(cookie,{documentHash:'0'.repeat(64)})).status,409);assert.equal((await f.sign(cookie,{version:0})).status,409);
  assert.equal((await f.sign(cookie)).status,200);assert.equal(f.record().status,'signed');assert.equal(f.record().worker.email,'staff@example.com');assert.equal(f.record().delivery,undefined);
});
test('duplicate signatures are idempotent and neither admin nor recipient can overwrite a signed original',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const {cookie}=await f.access();await f.sign(cookie);const original=structuredClone(f.record());
  const again=await f.sign(cookie,{email:'changed@example.com'});assert.equal(again.status,200);assert.equal(again.data.alreadySigned,true);assert.deepEqual(f.record(),original);
  assert.equal((await f.save()).status,409);assert.equal((await f.write({op:'contract.withdraw',reason:'정정'})).status,409);assert.equal((await f.issue()).status,409);
});
test('request withdrawal retains content and audit but disables bearer link and active session',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const {cookie}=await f.access();assert.equal((await f.write({op:'contract.withdraw',reason:''})).status,400);assert.equal((await f.write({op:'contract.withdraw',reason:'근무 조건 정정'})).status,200);
  assert.equal((await f.call('contract',undefined,cookie)).status,401);assert.equal((await f.access()).status,401);assert.equal(f.record().terms.workerName,'최건');assert.equal(f.record().events.at(-1).detail,'근무 조건 정정');
});
test('signed copies require a real manual delivery attestation; delivery and link rotation do not alter signed hashes',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const {cookie}=await f.access();await f.sign(cookie);const hash=f.record().signedHash,employer=structuredClone(f.record().employer),worker=structuredClone(f.record().worker);
  assert.equal((await f.write({op:'contract.delivery',note:'이메일 발송',confirm:false})).status,400);assert.equal((await f.write({op:'contract.delivery',note:'수령 이메일로 HTML 사본 발송',confirm:true})).status,200);assert.equal(f.record().delivery.destination,'staff@example.com');
  assert.equal((await f.write({op:'contract.delivery',note:'또 전달',confirm:true})).status,409);
  assert.equal((await f.write({op:'contract.link',token:'c'.repeat(64),code:'REISSUECODE123'})).status,200);assert.equal((await f.call('contract',undefined,cookie)).status,401);
  assert.equal(f.record().signedHash,hash);assert.deepEqual(f.record().employer,employer);assert.deepEqual(f.record().worker,worker);
  const newLogin=await f.access('c'.repeat(64),'REISSUECODE123');assert.equal((await f.call('contract',undefined,newLogin.cookie)).status,200);
});
test('document and signature tampering is detected before display or acceptance',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const {cookie}=await f.access();f.record().terms.hourlyRate=9000;assert.equal((await f.call('contract',undefined,cookie)).status,409);
  f.record().terms.hourlyRate=11000;await f.sign(cookie);f.record().worker.email='tampered@example.com';assert.equal((await f.call('contract',undefined,cookie)).status,409);
});
test('contract history prevents employee deletion and remains available after deactivation',async t=>{
  const f=await fixture(t);await f.save();assert.equal((await f.call('admin',{op:'employee.delete',id:f.employeeId})).status,409);await f.issue();const {cookie}=await f.access();
  assert.equal((await f.call('admin',{op:'employee.archive',id:f.employeeId})).status,200);assert.equal((await f.call(`admin/contracts?id=${f.id}`)).status,200);assert.equal((await f.call('contract',undefined,cookie)).status,200);
});
test('drawn signatures reject empty clicks, unbounded coordinates, arbitrary SVG and excessive data',()=>{
  assert.equal(validateSignature([]),null);assert.equal(validateSignature([[[0,0],[0,0]]]),null);assert.equal(validateSignature('<svg onload=evil()>'),null);assert.equal(validateSignature([[[0,0],[1.1,1]]]),null);
  const stroke=Array.from({length:6},(_,i)=>[i/10,i%2/2]);assert.ok(validateSignature([stroke]));assert.equal(validateSignature([Array.from({length:601},(_,i)=>[i%2,0])]),null);
});
test('recipient sessions expire and a different contract cannot use another contract session',async t=>{
  const f=await fixture(t);await f.save();await f.issue();const {cookie}=await f.access();const forged=cookie.replace(f.id,randomUUID());assert.equal((await f.call('contract',undefined,forged)).status,401);
  Date.now.mock.mockImplementation(()=>Date.parse('2026-11-02T13:01:00+09:00'));assert.equal((await f.call('contract',undefined,cookie)).status,401);
  assert.equal((await f.call('contract/logout',{},cookie)).status,200);assert.equal((await f.call('contract/logout',{},cookie)).headers.get('set-cookie').includes('Max-Age=0'),true);
});
