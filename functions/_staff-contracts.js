import { json, fail, today, monthDates, tokenHash } from './_staff-schedule.js';
import { FIELDS, SCHEMA, EMPLOYER_CONSENT, WORKER_CONSENT } from '../staff/contracts/model.js';

const stamp = () => new Date(Date.now()).toISOString();
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const secret = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validCode = value => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const date = value => typeof value === 'string' && monthDates(value.slice(0,7)).includes(value);
const clean = (v,max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const equal = (a,b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let n=0; for(let i=0;i<a.length;i++) n |= a.charCodeAt(i)^b.charCodeAt(i); return n===0; };
const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join('');
const key = id => `contract:${id}`;
function publicRecord(record) {
  const { linkHash, codeHash, sessions, failedAttempts, blockedUntil, ...publicValue } = record;
  return publicValue;
}
function audit(record,event,detail='') { record.events.push({event,at:stamp(),detail}); record.updatedAt=stamp(); }
export function validateTerms(input, complete=false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const terms={};
  for (const [name,,type,max,,optional] of FIELDS) {
    let value=input[name] ?? '';
    if (type==='number') {
      if (value !== '' && (!Number.isSafeInteger(value) || value < 1 || value > max)) return null;
    } else {
      if (!clean(value,max)) return null;
      value=value.trim();
      if (type==='date' && value && !date(value)) return null;
    }
    if (complete && !optional && value==='') return null;
    terms[name]=value;
  }
  if (terms.startDate && terms.endDate && terms.endDate<terms.startDate) return null;
  return terms;
}
export function validateSignature(input, name) {
  if(input && !Array.isArray(input) && input.typed===name && clean(input.typed,80) && input.typed.trim()) return {typed:input.typed};
  if (!Array.isArray(input) || !input.length || input.length>30) return null;
  let points=0, distance=0;
  const result=[];
  for(const stroke of input) {
    if (!Array.isArray(stroke) || stroke.length<2) return null;
    const out=[];
    for(const point of stroke) {
      if (!Array.isArray(point) || point.length!==2 || point.some(v=>!Number.isFinite(v)||v<0||v>1)) return null;
      const p=point.map(v=>Math.round(v*10000)/10000);const prev=out.at(-1);
      if(prev) distance+=Math.hypot(p[0]-prev[0],p[1]-prev[1]);
      out.push(p);if(++points>600)return null;
    }
    result.push(out);
  }
  return points>=5 && distance>=0.1 ? result : null;
}
const documentDigest = record => tokenHash(JSON.stringify({schema:record.schema,id:record.id,employeeId:record.employeeId,terms:record.terms,revision:record.revision}));
async function intact(record) {
  return record.documentHash && equal(record.documentHash,await documentDigest(record)) && (record.status!=='signed' || equal(record.signedHash,await tokenHash(JSON.stringify({documentHash:record.documentHash,employer:record.employer,worker:record.worker}))));
}
export async function readContracts(db, id, employees) {
  if(id) { if(!validId(id))return fail('계약서를 찾지 못했습니다.',404);const record=await db.get(key(id));return record?json({ok:true,contract:publicRecord(record)}):fail('계약서를 찾지 못했습니다.',404); }
  const records=[...(await db.list({prefix:'contract:'})).values()];
  return json({ok:true,today:today(),employees:employees.map(({id,name,active,role})=>({id,name,active,role})),contracts:records.map(r=>({id:r.id,employeeId:r.employeeId,name:r.terms.workerName,status:r.status,version:r.version,startDate:r.terms.startDate,endDate:r.terms.endDate,employerName:r.terms.employerName,hourlyRate:r.terms.hourlyRate,updatedAt:r.updatedAt,requestedAt:r.requestedAt,signedAt:r.worker?.signedAt,deliveredAt:r.delivery?.at,expiresAt:r.expiresAt})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
}
export async function writeContract(db, body, employees) {
  if(!validId(body.id))return fail('계약서 번호를 확인해 주세요.');
  let record=await db.get(key(body.id));
  if(body.op==='contract.save') {
    if(record && record.status!=='draft')return fail('서명을 요청한 계약서는 수정할 수 없습니다. 새 계약서를 작성해 주세요.',409);
    if((record?.version||0)!==body.version)return fail('다른 창에서 계약서가 변경되었습니다. 다시 열어 주세요.',409);
    const target=employees.find(e=>e.id===body.employeeId&&e.active);
    if(!target || (record&&record.employeeId!==body.employeeId))return fail('사용 중인 직원을 선택해 주세요.');
    const terms=validateTerms(body.terms);if(!terms)return fail('계약 내용의 형식과 날짜를 확인해 주세요.');
    if(!record)record={id:body.id,employeeId:target.id,schema:SCHEMA,status:'draft',revision:0,version:0,events:[],createdAt:stamp()};
    record.terms=terms;record.version++;record.revision++;audit(record,'draft.saved');
    await db.put(key(record.id),record);return json({ok:true,contract:publicRecord(record)});
  }
  if(!record)return fail('계약서를 찾지 못했습니다.',404);
  if(record.version!==body.version)return fail('계약서 상태가 변경되었습니다. 다시 열어 주세요.',409);
  if(body.op==='contract.issue' || body.op==='contract.link') {
    if(!secret(body.token)||!validCode(body.code))return fail('새 링크와 확인코드를 다시 만들어 주세요.');
    const linkHash=await tokenHash(body.token);
    if(await db.get(`contract-link:${linkHash}`))return fail('다른 링크를 생성해 주세요.',409);
    if(body.op==='contract.issue') {
      if(record.status!=='draft')return fail('작성 중인 계약서만 요청할 수 있습니다.',409);
      if(!employees.some(e=>e.id===record.employeeId&&e.active))return fail('사용 중지된 직원입니다.',409);
      if(!validateTerms(record.terms,true))return fail('고용주·근로자 정보, 근로일별 시간, 휴게, 임금, 휴일과 사회보험을 모두 작성해 주세요.');
      const signature=validateSignature(body.signature,record.terms.representative);
      if(!signature||body.consent!==EMPLOYER_CONSENT)return fail('고용주 서명과 동의가 필요합니다.');
      record.documentHash=await documentDigest(record);
      record.employer={name:record.terms.representative,signature,consent:EMPLOYER_CONSENT,signedAt:stamp()};
      record.requestedAt=stamp();record.status='requested';audit(record,'signature.requested');
    } else {
      if(!['requested','signed'].includes(record.status))return fail('서명 대기 또는 완료된 계약서만 링크를 발급할 수 있습니다.',409);
      audit(record,'access.rotated');
    }
    if(record.linkHash)await db.delete(`contract-link:${record.linkHash}`);
    record.linkHash=linkHash;record.codeHash=await tokenHash(`${linkHash}:${body.code}`);record.sessions=[];record.failedAttempts=0;record.blockedUntil=0;
    record.expiresAt=new Date(Date.now()+30*86400000).toISOString();record.version++;
    await db.put(`contract-link:${linkHash}`,record.id);await db.put(key(record.id),record);
    return json({ok:true,contract:publicRecord(record)});
  }
  if(body.op==='contract.withdraw') {
    if(record.status!=='requested')return fail('서명 대기 중인 요청만 취소할 수 있습니다.',409);
    if(!clean(body.reason,300)||!body.reason.trim())return fail('취소 사유를 입력해 주세요.');
    record.status='withdrawn';record.sessions=[];record.version++;audit(record,'request.withdrawn',body.reason.trim());
    await db.put(key(record.id),record);return json({ok:true,contract:publicRecord(record)});
  }
  if(body.op==='contract.delivery') {
    if(record.status!=='signed')return fail('서명 완료 후 사본 전달을 기록할 수 있습니다.',409);
    if(record.delivery)return fail('이미 사본 전달이 기록되었습니다.',409);
    if(!clean(body.note,500)||!body.note.trim()||body.confirm!==true)return fail('실제로 사본을 전달한 후 방법을 기록해 주세요.');
    record.delivery={at:stamp(),note:body.note.trim(),destination:record.worker.email};record.version++;audit(record,'copy.delivered',body.note.trim());
    await db.put(key(record.id),record);return json({ok:true,contract:publicRecord(record)});
  }
  return fail('지원하지 않는 계약서 요청입니다.');
}
export const CONTRACT_COOKIE='athoce_contract_session';
export const contractCookie = session => `${CONTRACT_COOKIE}=${session}; Path=/api/staff/contract; HttpOnly; Secure; SameSite=Strict; Max-Age=${session?86400:0}`;
export const contractSession = request => (request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${CONTRACT_COOKIE}=`))?.slice(CONTRACT_COOKIE.length+1)||'';
export async function contractRecipient(db, payload) {
  const body=payload.body||{};
  if(payload.action==='contract-login') {
    if(!secret(body.token)||!validCode(body.code))return fail('링크와 확인코드를 확인해 주세요.',401);
    const linkHash=await tokenHash(body.token),id=await db.get(`contract-link:${linkHash}`);
    const record=id&&await db.get(key(id));
    if(!record||record.linkHash!==linkHash||!['requested','signed'].includes(record.status))return fail('사용할 수 없는 계약서 링크입니다. 관리자에게 문의해 주세요.',401);
    if(record.status==='requested' && Date.parse(record.expiresAt)<=Date.now())return fail('서명 요청이 만료되었습니다. 관리자에게 새 링크를 요청해 주세요.',410);
    if(record.blockedUntil>Date.now())return fail('확인코드를 여러 번 잘못 입력했습니다. 10분 뒤 다시 시도해 주세요.',429);
    if(!equal(record.codeHash,await tokenHash(`${linkHash}:${body.code}`))) {
      record.failedAttempts=record.blockedUntil?1:(record.failedAttempts||0)+1;record.blockedUntil=record.failedAttempts>=5?Date.now()+600000:0;
      await db.put(key(record.id),record);return fail('확인코드가 올바르지 않습니다.',401);
    }
    const session=randomSecret();record.failedAttempts=0;record.blockedUntil=0;
    record.sessions=(record.sessions||[]).filter(s=>s.exp>Date.now()).slice(-4);
    record.sessions.push({hash:await tokenHash(session),exp:Date.now()+86400000});
    // Access logs do not alter the document's optimistic revision.
    if(!record.viewedAt){record.viewedAt=stamp();audit(record,'recipient.opened');}
    await db.put(key(record.id),record);return json({ok:true,session:`${record.id}.${session}`});
  }
  const parts=String(payload.session||'').split('.');
  if(!validId(parts[0])||!secret(parts[1]))return fail('받은 링크와 확인코드로 접속해 주세요.',401);
  const record=await db.get(key(parts[0]));const hash=await tokenHash(parts[1]);
  if(!record||!['requested','signed'].includes(record.status)||!(record.sessions||[]).some(s=>s.exp>Date.now()&&equal(s.hash,hash)))return fail('접속이 만료되었습니다. 받은 링크로 다시 접속해 주세요.',401);
  if(record.status==='requested' && Date.parse(record.expiresAt)<=Date.now())return fail('서명 요청이 만료되었습니다. 관리자에게 문의해 주세요.',410);
  if(!await intact(record))return fail('계약서 원문을 확인하지 못했습니다. 관리자에게 문의해 주세요.',409);
  if(payload.action==='contract-read')return json({ok:true,contract:publicRecord(record)});
  if(payload.action!=='contract-sign')return fail('지원하지 않는 요청입니다.');
  if(record.status==='signed')return json({ok:true,alreadySigned:true,contract:publicRecord(record)});
  if(!equal(body.documentHash,record.documentHash)||body.version!==record.version)return fail('계약서가 변경되었습니다. 새로고침 후 다시 확인해 주세요.',409);
  const signature=validateSignature(body.signature,record.terms.workerName);
  if(body.name!==record.terms.workerName||!signature||body.consent!==WORKER_CONSENT||!email(body.email))return fail('계약자 성명, 서명, 사본 수령 이메일 및 동의를 확인해 주세요.');
  record.worker={name:body.name,email:body.email,signature,consent:WORKER_CONSENT,signedAt:stamp(),accessMethod:'recipient-link-and-separate-code'};
  record.signedHash=await tokenHash(JSON.stringify({documentHash:record.documentHash,employer:record.employer,worker:record.worker}));
  record.status='signed';record.version++;audit(record,'worker.signed');
  await db.put(key(record.id),record);return json({ok:true,contract:publicRecord(record)});
}
