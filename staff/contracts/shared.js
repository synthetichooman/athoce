import { el } from '../shared.js';
import { FIELDS, STATES } from './model.js';
export const when = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
export const labelState = c => c.status==='signed' ? c.delivery || c.deliveredAt ? '사본 전달 완료' : '서명 완료 · 사본 전달 대기' : c.status==='requested' && Date.parse(c.expiresAt)<=Date.now() ? '요청 만료' : STATES[c.status];
const NS='http://www.w3.org/2000/svg';
export function signatureGraphic(value) {
  if(value?.typed)return el('div',value.typed,'typed-signature');
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 500 170');svg.setAttribute('aria-label','서명');svg.setAttribute('role','img');
  for(const points of value||[]) { const line=document.createElementNS(NS,'polyline');line.setAttribute('points',points.map(([x,y])=>`${x*500},${y*170}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#283c30');line.setAttribute('stroke-width','2');line.setAttribute('stroke-linecap','round');line.setAttribute('stroke-linejoin','round');svg.append(line); }
  return svg;
}
export function signaturePad(container,name) {
  let strokes=[],active=null;const canvas=el('canvas');canvas.width=1000;canvas.height=340;canvas.setAttribute('aria-label',`${name} 서명란`);canvas.setAttribute('role','img');
  const context=canvas.getContext('2d');context.lineWidth=4;context.lineCap='round';context.lineJoin='round';context.strokeStyle='#283c30';
  const typedLabel=el('label',null,'check');const typed=el('input');typed.type='checkbox';typedLabel.append(typed,document.createTextNode('이름으로 서명 (직접 그리기 대신)'));
  const typedName=el('input');typedName.type='text';typedName.maxLength=80;typedName.placeholder='성명을 그대로 입력';typedName.setAttribute('aria-label','이름으로 서명');typedName.hidden=true;typedName.autocomplete='name';
  const hint=el('p','손가락이나 마우스로 서명하세요.','small');const clear=el('button','다시 쓰기');clear.type='button';clear.onclick=()=>{strokes=[];active=null;context.clearRect(0,0,1000,340);typedName.value='';};
  typed.onchange=()=>{canvas.hidden=typed.checked;hint.hidden=typed.checked;clear.hidden=typed.checked;typedName.hidden=!typed.checked;};
  const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  const total=()=>strokes.reduce((sum,s)=>sum+s.length,0);
  canvas.onpointerdown=e=>{if(e.button!==0||active||strokes.length>=30||total()>=580)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);active=[point(e)];strokes.push(active);};
  canvas.onpointermove=e=>{if(!active||total()>=600)return;const p=point(e),last=active.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])<.003)return;active.push(p);context.beginPath();context.moveTo(last[0]*1000,last[1]*340);context.lineTo(p[0]*1000,p[1]*340);context.stroke();};
  const stop=()=>{if(active?.length<2)strokes.pop();active=null;};canvas.onpointerup=stop;canvas.onpointercancel=stop;
  container.append(canvas,hint,clear,typedLabel,typedName);
  return {value:()=>typed.checked?{typed:typedName.value.trim()}:structuredClone(strokes),clear:clear.onclick};
}
export function renderDocument(container,contract) {
  const t=contract.terms;container.replaceChildren();container.classList.add('contract-document');
  container.append(el('p','ATHOCE SEOUL / EMPLOYMENT','document-eyebrow'),el('h2','근로계약서'));
  container.append(el('p','고용주와 근로자는 아래 근로조건에 합의합니다.'));
  const sections=[['계약 당사자',['employerName','representative','employerAddress','employerContact','workerName','workerAddress','workerContact']],['근무 조건',['startDate','endDate','workplace','duties','workDays','breaks']],['임금',['hourlyRate','wageItems','wageCalculation','payPeriod','payDay','payMethod']],['휴일 및 그 밖의 조건',['holidays','annualLeave','insurance','otherTerms']]];
  for(const [title,fields] of sections) {
    const section=el('section');section.append(el('h3',title));const dl=el('dl');
    for(const field of fields) {
      const def=FIELDS.find(([key])=>key===field);let value=t[field];let label=def[1];
      if(field==='endDate'){label='계약 종료일';value=value||'기간의 정함 없음';}
      if(field==='hourlyRate')value=value?`${Number(value).toLocaleString('ko-KR')}원`:'';
      if(field==='payDay')value=value?`매월 ${value}일`:'';
      if(field==='otherTerms'&&!value)continue;
      dl.append(el('dt',label),el('dd',value||'미작성'));
    }
    section.append(dl);container.append(section);
  }
  const signs=el('div',null,'document-signatures');
  for(const [label,value,name] of [['고용주',contract.employer,t.representative],['근로자',contract.worker,t.workerName]]) {
    const box=el('section');box.append(el('h3',`${label} · ${name||'미작성'}`));if(value){box.append(signatureGraphic(value.signature),el('p',when(value.signedAt),'small'),el('p',value.consent,'small'));}else box.append(el('p','서명 전','small'));signs.append(box);
  }
  container.append(signs);
  if(contract.worker)container.append(el('p',`사본 수령 이메일: ${contract.worker.email}`,'small'));
  const meta=el('div',null,'document-meta');meta.append(el('p',`계약 번호 ${contract.id} · 내용 버전 ${contract.revision||0}`));
  if(contract.documentHash)meta.append(el('p',`원문 SHA-256: ${contract.documentHash}`));
  if(contract.signedHash)meta.append(el('p',`서명 기록 SHA-256: ${contract.signedHash}`));
  if(contract.status==='draft')meta.append(el('p','작성 중인 미서명 초안입니다.'));
  container.append(meta);
}
export const DOCUMENT_CSS = `body{color:#25352c;background:white;font:14px/1.8 system-ui,sans-serif;margin:32px auto;max-width:800px;padding:0 24px}h2{text-align:center;font-size:27px;letter-spacing:.12em;margin:20px 0 32px}h3{font-size:15px;margin:24px 0 12px}dl{display:grid;grid-template-columns:180px 1fr;margin:0}dt,dd{margin:0;padding:9px 12px;border-bottom:1px solid #dde2da;white-space:pre-wrap;overflow-wrap:anywhere}dt{color:#52634f}svg{width:100%;max-height:130px}.document-eyebrow{font-size:10px;letter-spacing:.1em;color:#677361}.document-signatures{display:grid;grid-template-columns:1fr 1fr;gap:32px;border-top:1px solid #ccd5c7;margin-top:32px}.document-signatures section{break-inside:avoid}.document-signatures p,.small{font-size:11px;color:#60705c}.typed-signature{font-family:serif;font-size:28px;padding:30px 8px}.document-meta{border-top:1px solid #ccd5c7;margin-top:24px;padding-top:12px;overflow-wrap:anywhere;font-size:10px;color:#60705c}@media(max-width:600px){body{padding:0 12px;margin:20px auto}dl{grid-template-columns:1fr}dt{padding-bottom:0;border:0}dd{padding-top:4px}.document-signatures{gap:12px}}@media print{body{max-width:none;margin:0}h3{break-after:avoid}dt,dd{break-inside:avoid}.document-signatures{break-inside:avoid}}`;
export function downloadFile(filename,body,type) {const link=el('a');link.href=URL.createObjectURL(new Blob([body],{type}));link.download=filename;document.body.append(link);link.click();setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove();},1000);}
export function downloadContract(contract) {
  const holder=el('article');renderDocument(holder,contract);
  const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>근로계약서 사본</title><style>${DOCUMENT_CSS}</style></head><body>${holder.innerHTML}</body></html>`;
  downloadFile(`근로계약서-${contract.id}.html`,html,'text/html;charset=utf-8');
}
