import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayslip, availablePayers, payslipFilename } from '../staff/payroll/payslip-model.js';
const fixture=()=>({state:'finalized',confirmedAt:'2026-10-25T12:00:00Z',revision:2,report:{month:'2026-10',start:'2026-09-26',end:'2026-10-25',asOf:'2026-10-25',rows:[{id:'staff-1',name:'최건',hourlyRate:11000,shifts:[{date:'2026-10-01',start:'13:00',end:'20:00',payer:'at',minutes:360,amount:66000},{date:'2026-10-02',payer:'ho',minutes:360,amount:66000},{date:'2026-10-03',payer:'at',minutes:0,amount:0}],adjustments:{},items:[{payer:'at',kind:'allowance',name:'주휴수당',amount:39600,calculation:'11,000 × 3.6'},{payer:'at',kind:'deduction',name:'국민연금',amount:3000,calculation:'확인 세액'}],payers:{at:102600,ho:66000}}]}});
test('payslips isolate employer amounts, separate gross and deductions and omit nonworked days',()=>{
 const d=fixture(),s=buildPayslip(d,'staff-1','at','사업자명','2026-10-25');
 assert.equal(s.gross,105600);assert.equal(s.deducted,3000);assert.equal(s.net,102600);assert.equal(s.days,1);assert.equal(s.minutes,360);assert.equal(s.review,false);assert.equal(s.revision,2);
 const ho=buildPayslip(d,'staff-1','ho','다른 사업주','2026-10-25');assert.equal(ho.net,66000);assert.equal(ho.allowances.length,0);
 assert.deepEqual(availablePayers(d.report.rows[0]),['at','ho']);
});
test('drafts and legacy net adjustments cannot masquerade as finalized itemized statements',()=>{
 const d=fixture();d.state='draft';assert.equal(buildPayslip(d,'staff-1','at','사업자','2026-10-25').review,true);
 d.state='finalized';const r=d.report.rows[0];delete r.items;r.adjustments.at={amount:-1000,note:'기존 합산액'};r.payers.at=65000;
 const s=buildPayslip(d,'staff-1','at','사업자','2026-10-25');assert.equal(s.review,true);assert.equal(s.deducted,1000);assert.equal(s.net,65000);assert.equal(s.legacy,true);
});
test('invalid input, negative or inconsistent amounts stop export; filenames are safe',()=>{
 const d=fixture();for(const args of [['missing','at','사업자','2026-10-25'],['staff-1','ce','사업자','2026-10-25'],['staff-1','at','','2026-10-25'],['staff-1','at','사업자','2026-02-30']])assert.throws(()=>buildPayslip(d,...args));
 d.report.rows[0].payers.at++;assert.throws(()=>buildPayslip(d,'staff-1','at','사업자','2026-10-25'));
 assert.equal(payslipFilename({name:'가/나:다',month:'2026-10',payer:'at',review:true}),'급여명세서_2026-10_가_나_다_at_검토용.pdf');
});
