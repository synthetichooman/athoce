import { addDays, weekOf, monthDates, today, tokenHash, json, fail } from './_staff-schedule.js';
import { PAYROLL_PAYERS, payrollPeriod } from './_staff-payroll.js';

// Payroll history must remain accessible after the scheduling calendar moves on.
export function validPayMonth(month) {
  return monthDates(month).length > 0 && month >= '2020-01' && month <= `${Number(today().slice(0, 4)) + 1}-12`;
}
const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
const fresh = () => ({ version: 0, settings: {}, shifts: {}, adjustments: {}, snapshot: null, history: [], reconciliations: {} });
const shiftSignature = (schedule, date, id) => JSON.stringify([(schedule?.draft?.[date] || []).includes(id), (schedule?.published?.assignments?.[date] || []).includes(id), schedule?.start, schedule?.end, schedule?.published?.start, schedule?.published?.end]);
const stamp = () => new Date(Date.now()).toISOString();
const validRate = n => Number.isSafeInteger(n) && n > 0 && n <= 1000000;
const validMinutes = n => Number.isInteger(n) && n >= 0 && n <= 1440;
const noteOK = n => typeof n === 'string' && n.trim().length > 0 && n.length <= 300;
const payerTotals = () => Object.fromEntries([...PAYROLL_PAYERS, 'unassigned'].map(p => [p, 0]));

export function calculatePayrun(month, employees, schedules, record, asOf = today()) {
  const { start, end } = payrollPeriod(month); const blockers = []; const rows = [];
  const staff = employees.filter(e => e.role !== 'core');
  for (const employee of staff) {
    const setting = record.settings[employee.id] || {};
    const row = { id: employee.id, name: employee.name, active: employee.active, hourlyRate: setting.hourlyRate ?? null, breakMinutes: setting.breakMinutes ?? 0, shifts: [], issues: [], weekdays: [0,0,0,0,0,0,0], reconciliations: [], minutes: 0, base: 0, adjustment: 0, total: 0, payers: payerTotals(), adjustments: record.adjustments[employee.id] || {} };
    for (let date = start; date <= end && date <= asOf; date = addDays(date, 1)) {
      const schedule = schedules.get(weekOf(date));
      const published = schedule?.published;
      const assigned = published?.assignments?.[date] || [];
      const draft = schedule?.draft?.[date] || [];
      const mismatch = (draft.includes(employee.id) !== assigned.includes(employee.id)) || (draft.includes(employee.id) && published && (schedule.start !== published.start || schedule.end !== published.end));
      const saved = record.reconciliations?.[date]?.[employee.id];
      const resolution = saved?.signature === shiftSignature(schedule, date, employee.id) ? saved : null;
      if ((mismatch || saved) && !resolution) {
        blockers.push(`${date} ${employee.name}: 미확정 근무를 확인해 주세요.`);
        row.issues.push({ date, changed:!!saved, published:assigned.includes(employee.id), draft:draft.includes(employee.id), start:schedule?.start, end:schedule?.end, publishedStart:published?.start, publishedEnd:published?.end });
      }
      if (resolution) row.reconciliations.push({ date, choice:resolution.choice, note:resolution.note });
      const source = resolution ? resolution.choice : 'published';
      const included = source === 'draft' ? draft.includes(employee.id) : source === 'published' ? assigned.includes(employee.id) : false;
      if (!included) continue;
      const startTime = source === 'draft' ? schedule.start : published.start;
      const endTime = source === 'draft' ? schedule.end : published.end;
      const shiftMinutes = minutes(endTime) - minutes(startTime);
      const override = record.shifts[date]?.[employee.id];
      const paidMinutes = override?.minutes ?? (Number.isFinite(shiftMinutes) ? Math.max(0, shiftMinutes - row.breakMinutes) : 0);
      const payer = schedule.payers?.[date]?.[employee.id] || '';
      const amount = validRate(row.hourlyRate) ? Math.round(row.hourlyRate * paidMinutes / 60) : 0;
      if (!validRate(row.hourlyRate)) blockers.push(`${employee.name}: 시급을 설정해 주세요.`);
      if (!Object.hasOwn(setting, 'breakMinutes')) blockers.push(`${employee.name}: 무급 휴게시간을 확인하고 시급 설정을 저장해 주세요.`);
      if (!Number.isFinite(shiftMinutes) || shiftMinutes <= 0 || !validMinutes(paidMinutes)) blockers.push(`${date} ${employee.name}: 근무 시간을 확인해 주세요.`);
      if (!PAYROLL_PAYERS.includes(payer)) blockers.push(`${date} ${employee.name}: 지급 주체를 선택해 주세요.`);
      row.shifts.push({ date, start: startTime, end: endTime, reconciliation: resolution ? { choice:resolution.choice, note:resolution.note } : null, minutes: paidMinutes, override: !!override, note: override?.note || '', payer, amount });
      if (date === end && paidMinutes > 0) {
        const cutoff = Date.parse(`${date}T00:00:00+09:00`) + Math.max(minutes(endTime), minutes(startTime) + paidMinutes + row.breakMinutes) * 60000;
        if (Date.now() < cutoff) blockers.push(`${date} ${employee.name}: 마지막 근무 종료 후 확정할 수 있습니다.`);
      }
      row.weekdays[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]++;
      row.minutes += paidMinutes; row.base += amount;
      row.payers[PAYROLL_PAYERS.includes(payer) ? payer : 'unassigned'] += amount;
    }
    for (const payer of PAYROLL_PAYERS) {
      const adjustment = row.adjustments[payer];
      if (adjustment) { row.adjustment += adjustment.amount; row.payers[payer] += adjustment.amount; }
    }
    row.total = row.base + row.adjustment;
    if (row.total < 0 || Object.values(row.payers).some(n => n < 0)) blockers.push(`${employee.name}: 지급 주체별 금액이 음수입니다. 공제를 확인해 주세요.`);
    if (row.active || row.shifts.length || row.issues.length || row.reconciliations.length || row.adjustment || Object.keys(row.adjustments).length) rows.push(row);
  }
  const totals = { base: 0, adjustment: 0, total: 0, minutes: 0, shifts: 0, payers: payerTotals() };
  for (const row of rows) { for (const key of ['base','adjustment','total','minutes']) totals[key] += row[key]; totals.shifts += row.shifts.length; for (const payer in totals.payers) totals.payers[payer] += row.payers[payer]; }
  if (asOf < end) blockers.push(`${end} 정산 기간이 끝난 뒤 확정할 수 있습니다.`);
  if (!totals.shifts && !rows.some(r => r.adjustment)) blockers.push('확정할 급여 내역이 없습니다.');
  return { month, start, end, payday: end, asOf, rows, totals, blockers: [...new Set(blockers)] };
}

async function context(db, month, employees) {
  const record = await db.get(`payrun:${month}`) || fresh();
  const schedules = new Map(await Promise.all(payrollPeriod(month).weeks.map(async week => [week, await db.get(`week:${week}`)])));
  const live = calculatePayrun(month, employees, schedules, record);
  // Whole-week versions also catch concurrent changes at month boundaries.
  const source = await tokenHash(JSON.stringify({ version: record.version, employees: employees.map(e => ({ id:e.id, name:e.name, active:e.active, role:e.role })), schedules: [...schedules], live }));
  const basis = await tokenHash(JSON.stringify({ rows: live.rows, totals: live.totals }));
  return { record, schedules, live, source, basis };
}
export async function readPayrun(db, month, employees) {
  if (!validPayMonth(month)) return fail('급여 월을 확인해 주세요.');
  const { record, schedules, live, source, basis } = await context(db, month, employees);
  return json({ ok: true, version: record.version, source, scheduleVersions: Object.fromEntries([...schedules].map(([week, schedule]) => [week, schedule?.version ?? 0])), state: record.snapshot ? 'finalized' : 'draft', report: record.snapshot?.report || live, blockers: record.snapshot ? [] : live.blockers, sourceChanged: !!record.snapshot && record.snapshot.basis !== basis, confirmedAt: record.snapshot?.confirmedAt || null, revision: record.history.length + (record.snapshot ? 1 : 0), history: record.history.map(s => ({ confirmedAt:s.confirmedAt, reopenedAt:s.reopenedAt, reason:s.reason, total:s.report.totals.total })), settings: record.settings });
}
export async function writePayrun(db, body, employees) {
  if (!validPayMonth(body.month)) return fail('급여 월을 확인해 주세요.');
  const ctx = await context(db, body.month, employees); const { record, live } = ctx;
  if (record.version !== body.version) return fail('급여 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.', 409);
  if (body.op === 'payrun.reopen') {
    if (!record.snapshot) return fail('아직 확정하지 않은 급여입니다.', 409);
    if (!noteOK(body.reason)) return fail('확정 취소 사유를 입력해 주세요.');
    record.history.push({ ...record.snapshot, reopenedAt: stamp(), reason: body.reason.trim() }); record.snapshot = null;
  } else {
    if (record.snapshot) return fail('확정된 급여입니다. 확정을 취소한 뒤 수정해 주세요.', 409);
    if (body.op === 'payrun.finalize') {
      if (body.source !== ctx.source) return fail('근무표 또는 급여 정보가 변경되었습니다. 새로고침 후 검토해 주세요.', 409);
      if (live.blockers.length) return fail(live.blockers[0], 409);
      record.snapshot = { report: structuredClone(live), confirmedAt: stamp(), basis: ctx.basis };
    } else if (body.op === 'payrun.copy') {
      const previous = new Date(`${body.month}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1);
      const prior = await db.get(`payrun:${previous.toISOString().slice(0,7)}`);
      if (!prior || !Object.keys(prior.settings).length) return fail('이전 달에 저장된 시급 설정이 없습니다.');
      for (const employee of employees.filter(e => e.role !== 'core')) if (!record.settings[employee.id] && prior.settings[employee.id]) record.settings[employee.id] = structuredClone(prior.settings[employee.id]);
    } else {
      const employee = employees.find(e => e.id === body.employeeId && e.role !== 'core');
      if (!employee) return fail('스태프를 찾지 못했습니다.', 404);
      if (body.op === 'payrun.reconcile-reset') {
        const saved = record.reconciliations?.[body.date]?.[employee.id];
        if (!saved || !live.rows.find(r => r.id === employee.id)?.reconciliations.some(r => r.date === body.date)) return fail('다시 확인할 근무 기록이 없습니다.', 409);
        delete record.reconciliations[body.date][employee.id];
      } else if (body.op === 'payrun.reconcile') {
        const issue = live.rows.find(r => r.id === employee.id)?.issues.find(i => i.date === body.date);
        if (!issue || !['published','draft','off'].includes(body.choice) || (body.choice === 'published' && !issue.published) || (body.choice === 'draft' && !issue.draft) || !noteOK(body.note)) return fail('미확정 근무의 처리 방식과 확인 사유를 입력해 주세요.');
        if (body.choice !== 'off' && !PAYROLL_PAYERS.includes(body.payer)) return fail('지급 주체를 선택해 주세요.');
        const week = weekOf(body.date); const schedule = ctx.schedules.get(week);
        if (body.scheduleVersion !== schedule.version) return fail('근무표가 변경되었습니다. 새로고침 후 다시 확인해 주세요.', 409);
        record.reconciliations ||= {}; record.reconciliations[body.date] ||= {};
        record.reconciliations[body.date][employee.id] = { choice:body.choice, note:body.note.trim(), signature:shiftSignature(schedule,body.date,employee.id), savedAt:stamp() };
        if (body.choice !== 'off') {
          schedule.payers ||= {}; schedule.payers[body.date] ||= {}; schedule.payers[body.date][employee.id] = body.payer;
          schedule.version++; schedule.updatedAt = stamp(); await db.put(`week:${week}`, schedule);
        }
      } else if (body.op === 'payrun.settings') {
        if (!validRate(body.hourlyRate) || !validMinutes(body.breakMinutes)) return fail('시급(1~1,000,000원)과 무급 휴게시간(0~1,440분)을 확인해 주세요.');
        record.settings[employee.id] = { hourlyRate:body.hourlyRate, breakMinutes:body.breakMinutes };
      } else if (body.op === 'payrun.shift') {
        const row = live.rows.find(r => r.id === employee.id); const shift = row?.shifts.find(s => s.date === body.date);
        if (!shift || !validMinutes(body.minutes) || !PAYROLL_PAYERS.includes(body.payer)) return fail('확정된 근무의 시간과 지급 주체를 확인해 주세요.');
        if (typeof body.note !== 'string' || body.note.length > 300 || (body.minutes !== shift.minutes && !body.note.trim())) return fail('시간을 변경한 사유를 입력해 주세요.');
        record.shifts[body.date] ||= {};
        if (body.useDefault === true || (!shift.override && body.minutes === shift.minutes)) delete record.shifts[body.date][employee.id];
        else record.shifts[body.date][employee.id] = { minutes:body.minutes, note:body.note.trim() };
        const week = weekOf(body.date); const schedule = ctx.schedules.get(week);
        if (body.scheduleVersion !== schedule.version) return fail('근무표가 변경되었습니다. 새로고침 후 다시 확인해 주세요.', 409);
        schedule.payers ||= {}; schedule.payers[body.date] ||= {}; schedule.payers[body.date][employee.id] = body.payer;
        schedule.version++; schedule.updatedAt = stamp(); await db.put(`week:${week}`, schedule);
      } else if (body.op === 'payrun.adjustment') {
        if (!PAYROLL_PAYERS.includes(body.payer) || !Number.isSafeInteger(body.amount) || Math.abs(body.amount) > 100000000 || (body.amount !== 0 && !noteOK(body.note))) return fail('지급 주체, 조정 금액과 사유를 확인해 주세요.');
        record.adjustments[employee.id] ||= {};
        if (body.amount === 0) delete record.adjustments[employee.id][body.payer];
        else record.adjustments[employee.id][body.payer] = { amount:body.amount, note:body.note.trim() };
      } else return fail('잘못된 급여 요청입니다.');
    }
  }
  record.version++; record.updatedAt = stamp(); await db.put(`payrun:${body.month}`, record);
  return json({ ok: true, version: record.version });
}
