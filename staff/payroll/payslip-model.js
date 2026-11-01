export const PAYERS = ['at', 'ho', 'ce', 'athoce'];
export const money = n => `${Number(n).toLocaleString('ko-KR')}원`;
export const duration = m => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;

export function availablePayers(row) {
  return PAYERS.filter(p => row.shifts.some(s => s.payer === p) || row.adjustments?.[p] || row.items?.some(i => i.payer === p));
}

// Input is the API's report: finalized reports already contain the immutable snapshot.
export function buildPayslip(data, employeeId, payer, issuer, paydate) {
  const row = data.report.rows.find(r => r.id === employeeId);
  if (!row || !availablePayers(row).includes(payer)) throw Error('이 지급 주체의 급여 내역이 없습니다.');
  if (typeof issuer !== 'string' || !issuer.trim() || issuer.length > 120) throw Error('사업자명을 입력해 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paydate) || Number.isNaN(Date.parse(`${paydate}T00:00:00Z`)) || new Date(`${paydate}T00:00:00Z`).toISOString().slice(0,10) !== paydate) throw Error('지급일을 확인해 주세요.');
  const shifts = row.shifts.filter(s => s.payer === payer).map(s => ({ ...s }));
  if (shifts.length && (!Number.isSafeInteger(row.hourlyRate) || row.hourlyRate <= 0)) throw Error('시급을 먼저 설정해 주세요.');
  const allowances = [], deductions = [];
  for (const item of row.items || []) if (item.payer === payer) (item.kind === 'deduction' ? deductions : allowances).push({ ...item });
  const legacy = row.adjustments?.[payer];
  if (legacy?.amount) (legacy.amount < 0 ? deductions : allowances).push({ name:'기존 합산 조정', amount:Math.abs(legacy.amount), calculation:legacy.note, legacy:true });
  const base = shifts.reduce((n,s) => n+s.amount,0);
  const gross = base + allowances.reduce((n,i)=>n+i.amount,0);
  const deducted = deductions.reduce((n,i)=>n+i.amount,0);
  const net = gross-deducted;
  if (net !== row.payers[payer] || net < 0) throw Error('지급액이 맞지 않습니다. 수당·공제와 지급 주체를 확인해 주세요.');
  const unassigned = row.shifts.some(s=>!PAYERS.includes(s.payer));
  // An old net adjustment cannot prove its constituent earnings and deductions.
  const review = data.state !== 'finalized' || !!legacy?.amount || unassigned;
  return { name:row.name, employeeId:row.id, payer, issuer:issuer.trim(), paydate, month:data.report.month,
    start:data.report.start, end:data.report.end, hourlyRate:row.hourlyRate, shifts, allowances, deductions,
    base, gross, deducted, net, minutes:shifts.reduce((n,s)=>n+s.minutes,0), days:shifts.filter(s=>s.minutes>0).length,
    review, legacy:!!legacy?.amount, confirmedAt:data.confirmedAt, revision:data.revision || 0,
    sourceChanged:!!data.sourceChanged, asOf:data.report.asOf };
}

export function payslipFilename(slip) {
  const name = slip.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,60);
  return `급여명세서_${slip.month}_${name}_${slip.payer}_${slip.review ? '검토용' : '확정'}.pdf`;
}
