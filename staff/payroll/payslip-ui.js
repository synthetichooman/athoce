import { $, el, status } from '../shared.js';
import { availablePayers, buildPayslip, payslipFilename, money, duration } from './payslip-model.js';
import { createPayslipPdf } from './payslip-pdf.js';

export function setupPayslips(getData, hasUnsaved) {
  const dialog=$('#payslipDialog'), employee=$('#payslipEmployee'), payer=$('#payslipPayer'), issuer=$('#payslipIssuer'), date=$('#payslipDate');
  let data, slip, downloading=false; const issuers={};
  function preview() {
    const row=data?.report.rows.find(r=>r.id===employee.value);
    $('#payslipPreview').replaceChildren(); $('#downloadPayslip').disabled=true; slip=null;
    if(!row || !payer.value) { $('#payslipNote').textContent='추출할 지급 주체의 급여 내역이 없습니다.'; return; }
    try {
      slip=buildPayslip(data,row.id,payer.value,issuer.value,date.value);
      const heading=el('div',null,'payslip-person'); heading.append(el('strong',row.name),el('span',`${payer.value} · ${slip.review?'검토용':'확정본'}`,'small'));
      const list=el('dl');
      for(const [label,value] of [['정산 기간',`${slip.start} ~ ${slip.end}`],['유급 근무',`${slip.days}일 · ${duration(slip.minutes)}`],['지급 총액',money(slip.gross)],['공제 합계',money(slip.deducted)],['실지급액',money(slip.net)]]) list.append(el('dt',label),el('dd',value));
      $('#payslipPreview').append(heading,list);
      $('#payslipNote').textContent=slip.legacy?'기존 합산 조정이 있어 검토용으로만 추출합니다. 수당·공제를 항목별로 나눈 뒤 다시 확정해 주세요.':slip.review?'미확정 급여는 검토용 PDF로 저장됩니다. 수당·공제 검토 후 급여를 확정하세요.':'확정 당시의 근무·시급·수당·공제로 추출합니다.';
      $('#downloadPayslip').disabled=downloading;
    } catch(error) { $('#payslipNote').textContent=error.message; }
  }
  function changeEmployee() {
    const row=data.report.rows.find(r=>r.id===employee.value); const previous=payer.value;
    payer.replaceChildren(...(row?availablePayers(row):[]).map(p=>{const option=el('option',p);option.value=p;return option;}));
    if([...payer.options].some(o=>o.value===previous))payer.value=previous;
    issuer.value=issuers[payer.value]||''; preview();
  }
  payer.onchange=()=>{issuer.value=issuers[payer.value]||'';preview();};
  employee.onchange=changeEmployee;
  issuer.oninput=()=>{issuers[payer.value]=issuer.value;preview();}; date.oninput=preview;
  $('#closePayslip').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(downloading)event.preventDefault();});
  $('#payslipForm').onsubmit=async event=>{
    event.preventDefault(); if(!slip||downloading)return;
    if(hasUnsaved()) { status('작성 중인 급여 정보를 먼저 저장한 뒤 추출해 주세요.',true); return; }
    downloading=true; $('#payslipForm').inert=true; $('#closePayslip').disabled=true; $('#downloadPayslip').textContent='PDF 만드는 중…';
    try {
      // Refresh authentication and version before exporting; never silently issue stale payroll.
      const { api } = await import('../shared.js');
      const latest=await api(`/api/staff/admin?payrun=${encodeURIComponent(data.report.month)}`);
      if(latest.version!==data.version || latest.source!==data.source)throw Error('급여 또는 근무표가 변경되었습니다. 창을 닫고 새로고침해 주세요.');
      const bytes=await createPayslipPdf(slip);
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})); const link=el('a'); link.href=url; link.download=payslipFilename(slip); document.body.append(link); link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      $('#payslipNote').textContent='PDF 다운로드를 요청했습니다. 다른 스태프·지급 주체도 선택해서 추출할 수 있습니다.';
    }catch(error){$('#payslipNote').textContent=error.message;}
    finally{downloading=false;$('#payslipForm').inert=false;$('#closePayslip').disabled=false;$('#downloadPayslip').textContent='PDF 내려받기';}
  };
  return employeeId=>{
    if(hasUnsaved()){status('작성 중인 급여 정보를 먼저 저장한 뒤 추출해 주세요.',true);return;}
    data=getData(); employee.replaceChildren(...data.report.rows.map(row=>{const option=el('option',row.name);option.value=row.id;return option;}));
    if(employeeId)employee.value=employeeId;
    date.value=data.report.payday;changeEmployee();dialog.showModal();
  };
}
