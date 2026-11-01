import { $, api, status } from '../shared.js';
import { WORKER_CONSENT } from '../contracts/model.js';
import { renderDocument, signaturePad, labelState, when, downloadContract } from '../contracts/shared.js?v=20261101-shift1';
let contract,busy=false,pad;
// A fragment never reaches server access logs or the Referer header.
const fragment=new URLSearchParams(location.hash.slice(1));const initial=fragment.get('token')||'';
if(location.hash)history.replaceState(null,'',location.pathname);
if(/^[a-f0-9]{64}$/.test(initial))$('#accessLink').value=`${location.origin}/staff/contract/#token=${initial}`;
$('#workerConsentText').textContent=WORKER_CONSENT;
function access(){contract=null;$('#content').hidden=true;$('#logout').hidden=true;$('#accessPanel').hidden=false;$('#document').replaceChildren();$('#workerPad').replaceChildren();$('#signName').value='';$('#receiptEmail').value='';}
function render() {
  $('#accessPanel').hidden=true;$('#content').hidden=false;$('#logout').hidden=false;$('#accessCode').value='';$('#accessLink').value='';
  $('#state').textContent=labelState(contract);$('#intro').textContent=`${contract.terms.workerName} 님 · ${contract.terms.employerName} · ${contract.terms.startDate}부터`;
  renderDocument($('#document'),contract);const signed=contract.status==='signed';$('#signPanel').hidden=signed;$('#signedPanel').hidden=!signed;
  $('#download').textContent=signed?'서명된 사본 내려받기':'서명 전 사본 내려받기';
  if(signed){$('#signedInfo').textContent=`${when(contract.worker.signedAt)} · 사본 수령 이메일 ${contract.worker.email}`;}
  else{$('#workerPad').replaceChildren();pad=signaturePad($('#workerPad'),'근로자');$('#workerConsent').checked=false;}
}
async function load() {contract=(await api('/api/staff/contract')).contract;render();status('');}
async function run(fn) {
  if(busy)return;busy=true;$('#content').inert=true;$('#accessForm').inert=true;
  try{await fn();}catch(error){if(error.status===401||error.status===410)access();status(error.message,true);}
  finally{busy=false;$('#content').inert=false;$('#accessForm').inert=false;}
}
$('#accessForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  let token='';try{const link=new URL($('#accessLink').value);if(link.origin!==location.origin||!['/staff/contract/','/staff/contract'].includes(link.pathname))throw Error();token=new URLSearchParams(link.hash.slice(1)).get('token')||'';}catch{throw Error('관리자에게 받은 계약서 링크를 그대로 입력해 주세요.');}
  await api('/api/staff/contract/login',{token,code:$('#accessCode').value.trim()});await load();
});};
$('#signForm').onsubmit=event=>{event.preventDefault();if(!$('#workerConsent').checked)return;run(async()=>{
  if($('#signName').value.trim()!==contract.terms.workerName)throw Error('계약서의 근로자 성명과 동일하게 입력해 주세요.');
  const result=await api('/api/staff/contract',{version:contract.version,documentHash:contract.documentHash,name:$('#signName').value.trim(),email:$('#receiptEmail').value.trim(),signature:pad.value(),consent:WORKER_CONSENT});
  contract=result.contract;render();status('서명된 계약서를 보관했습니다. 사본을 내려받아 주세요.');$('#signedPanel').scrollIntoView({behavior:'smooth',block:'center'});
});};
$('#download').onclick=$('#signedDownload').onclick=()=>downloadContract(contract);
$('#print').onclick=$('#signedPrint').onclick=()=>window.print();
$('#logout').onclick=()=>run(async()=>{await api('/api/staff/contract/logout',{});access();status('접속을 종료했습니다. 다시 열려면 링크와 확인코드를 입력하세요.');});
run(async()=>{if(initial){access();status('관리자에게 받은 확인코드를 입력해 주세요.');}else await load();});
