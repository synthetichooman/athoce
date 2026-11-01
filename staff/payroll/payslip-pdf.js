import { money, duration } from './payslip-model.js';

// Dependencies and the Korean font are local assets. Payroll data never leaves the browser.
export async function createPayslipPdf(slip, dependencies) {
  if (!dependencies) {
    await Promise.all([import('./vendor/pdf-lib.min.js'), import('./vendor/fontkit.min.js')]);
    const response = await fetch('/staff/payroll/vendor/NanumGothic-Regular.ttf');
    if (!response.ok) throw Error('PDF 한글 글꼴을 불러오지 못했습니다. 다시 시도해 주세요.');
    dependencies = { PDFLib:globalThis.PDFLib, fontkit:globalThis.fontkit, fontBytes:new Uint8Array(await response.arrayBuffer()) };
  }
  const { PDFLib, fontkit, fontBytes } = dependencies;
  const pdf = await PDFLib.PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, {subset:true});
  const ink = PDFLib.rgb(.11,.11,.12), muted = PDFLib.rgb(.39,.39,.42), blue = PDFLib.rgb(0,.4,.8), line = PDFLib.rgb(.86,.86,.88);
  const width = 595.28, height = 841.89, left = 44, right = width-44, usable = right-left;
  let page, y; const pages=[];
  // Remove control characters and render unknown glyphs visibly instead of producing a broken PDF.
  const supported = new Set(font.getCharacterSet());
  const clean = value => [...String(value ?? '').replace(/[\u0000-\u001f\u007f]/g,' ')].map(c=>supported.has(c.codePointAt(0))?c:'?').join('');
  function wrapped(value, size=10, max=usable) {
    const lines=[]; let current='';
    for (const c of clean(value)) { if (current && font.widthOfTextAtSize(current+c,size)>max) { lines.push(current); current=''; } current+=c; }
    lines.push(current); return lines;
  }
  function draw(value, x, top, size=10, color=ink) { page.drawText(clean(value),{x,y:top,font,size,color}); }
  function newPage() {
    page=pdf.addPage([width,height]); pages.push(page); y=height-48;
    draw('ATHOCE / PAYROLL',left,y,9,muted); y-=36;
    draw('급여명세서',left,y,24); draw(slip.review?'검토용 · 지급 전 확인':'확정본',right-125,y+2,10,blue); y-=27;
    draw(`${slip.month} · ${slip.payer} · ${slip.name}`,left,y,10,muted); y-=22;
    page.drawLine({start:{x:left,y},end:{x:right,y},thickness:1,color:line}); y-=22;
  }
  function ensure(space) { if (y-space<60) newPage(); }
  function text(value,size=10,color=ink) { const lines=wrapped(value,size); for (const s of lines) { ensure(size+9); draw(s,left,y,size,color); y-=size+7; } }
  function section(title) { ensure(60); y-=12; text(title,12,blue); y-=4; }
  function entry(label, amount, calculation='') {
    const labelLines=wrapped(label,10,usable-120), calcLines=calculation?wrapped(calculation,9,usable):[];
    // Long calculation notes flow over pages rather than crossing the footer.
    ensure(Math.min(100,(labelLines.length+calcLines.length)*17+12));
    draw(money(amount),right-font.widthOfTextAtSize(money(amount),10),y,10);
    for(const s of labelLines) { ensure(18); draw(s,left,y); y-=17; }
    for(const s of calcLines) { ensure(17); draw(s,left,y,9,muted); y-=16; }
    y-=9;
  }
  newPage();
  text(`성명: ${slip.name}`); text(`사원 식별번호: ${slip.employeeId}` ,8,muted);
  text(`사업자명: ${slip.issuer} / 지급 주체: ${slip.payer}`);
  text(`정산 기간: ${slip.start} ~ ${slip.end}`); text(`임금 지급일: ${slip.paydate}`);
  text(`근무 ${slip.days}일 · 유급 ${duration(slip.minutes)} · 시급 ${money(slip.hourlyRate ?? 0)}`);
  section('지급 내역');
  entry('기본급',slip.base,`날짜별 시급 ${money(slip.hourlyRate ?? 0)} × 유급시간(분) ÷ 60, 원 단위 반올림 후 합산. 날짜별 내역 참조.`);
  for (const i of slip.allowances) entry(i.name,i.amount,i.calculation);
  entry('지급 총액 (공제 전)',slip.gross);
  section('공제 내역');
  for (const i of slip.deductions) entry(i.name,i.amount,i.calculation);
  if (!slip.deductions.length) text('등록된 공제 없음',10,muted);
  entry('공제 합계',slip.deducted);
  ensure(65); page.drawRectangle({x:left,y:y-42,width:usable,height:56,color:PDFLib.rgb(.94,.97,1)});
  draw('실지급액',left+14,y-9,12,blue); const net=money(slip.net); draw(net,right-14-font.widthOfTextAtSize(net,20),y-13,20,blue); y-=65;
  if(slip.review) text(slip.legacy?'검토용: 기존 합산 조정을 항목별 수당·공제로 나누고 다시 확정해 주세요.':'검토용: 아직 확정되지 않았거나 지급 주체가 미지정된 근무가 있습니다.',9,muted);
  if(slip.sourceChanged) text('확정 이후 변경 사항은 반영되지 않았습니다. 확정 당시 기록을 사용했습니다.',9,muted);
  section('날짜별 기본급 계산');
  if(!slip.shifts.length) text('이 지급 주체의 기본급 근무 내역이 없습니다.',9,muted);
  for(const s of slip.shifts) entry(`${s.date} · ${s.start}~${s.end} · 유급 ${duration(s.minutes)}`,s.amount,[`${money(slip.hourlyRate ?? 0)} × ${s.minutes}분 ÷ 60 (원 단위 반올림)`,s.note,s.reconciliation?.note].filter(Boolean).join(' / '));
  section('명세서 기준');
  text(slip.confirmedAt?`급여 확정: ${new Date(slip.confirmedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · ${slip.revision}차`:`급여 미확정 · ${slip.asOf}까지 집계`,9,muted);
  text('수당·공제는 관리자가 저장한 항목입니다. 노무·보험의 예상액은 자동 공제되지 않습니다.',9,muted);
  for(let i=0;i<pages.length;i++) { page=pages[i]; draw(`${slip.review?'검토용 · ':''}${slip.month} / ${slip.payer} / ${i+1} of ${pages.length}`,left,30,8,muted); }
  pdf.setTitle(`${slip.month} ${slip.name} 급여명세서`); pdf.setAuthor(slip.issuer); pdf.setLanguage('ko-KR');
  return pdf.save();
}
