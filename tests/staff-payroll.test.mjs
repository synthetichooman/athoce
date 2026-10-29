import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payrollPeriod, payrollSummary } from '../functions/_staff-payroll.js';
import { weekOf } from '../functions/_staff-schedule.js';
import { employeeLabel } from '../staff/names.js';

test('payroll spans previous 26th through payday 25th across years and leap months', () => {
  assert.equal(payrollPeriod('2027-01').start, '2026-12-26');
  assert.equal(payrollPeriod('2027-01').end, '2027-01-25');
  const leap = payrollPeriod('2028-03');
  assert.equal(leap.start, '2028-02-26'); assert.equal(leap.end, '2028-03-25');
  assert.ok(leap.weeks.includes(weekOf('2028-02-29')));
});

test('payroll counts published shifts by weekday through today, including prior-month dates and inactive staff history', () => {
  const employees = [{ id: 'at', name: 'aategois', role: 'core', active: true }, { id: 's', name: '민수', role: 'staff', active: true }, { id: 'old', name: '이전 스태프', role: 'staff', active: false }, { id: 'zero', name: '신규', role: 'staff', active: true }, { id: 'unused', name: '중지', role: 'staff', active: false }];
  const schedules = new Map();
  for (const [date, ids] of Object.entries({ '2026-09-25': ['s'], '2026-09-26': ['s', 's'], '2026-09-27': ['s'], '2026-09-28': ['s','at'], '2026-10-05': ['s'], '2026-10-06': ['old'], '2026-10-07': ['s'], '2026-10-08': ['s'], '2026-10-25': ['s'], '2026-10-26': ['s'] })) {
    const week = weekOf(date); if (!schedules.has(week)) schedules.set(week, { draft: {}, published: { assignments: {} } });
    schedules.get(week).published.assignments[date] = ids;
  }
  schedules.get(weekOf('2026-10-05')).draft['2026-10-05'] = ['old'];
  const full = payrollSummary('2026-10', employees, schedules, '2026-10-29');
  assert.deepEqual(full.rows.map(r => r.id), ['s','old','zero']);
  assert.deepEqual(full.rows[0].weekdays, [2,0,1,1,0,1,2]); assert.equal(full.rows[0].total, 7);
  assert.equal(full.rows[1].weekdays[1], 1); assert.equal(full.rows[2].total, 0);
  const partial = payrollSummary('2026-10', employees, schedules, '2026-10-07');
  assert.equal(partial.rows[0].total, 5); assert.equal(partial.rows[0].weekdays[2], 1);
  assert.equal(payrollSummary('2026-11', employees, schedules, '2026-10-25').rows[0].total, 0);
});

test('operator abbreviations change display only and preserve ordinary staff names', () => {
  for (const [name, alias] of [['aategois','at'],[' hooman ','ho'],['Cementbay','ce']]) assert.equal(employeeLabel({name,role:'core'}),alias);
  assert.equal(employeeLabel({name:'hooman',role:'staff'}),'hooman');
  assert.equal(employeeLabel({name:'다른 이름',role:'core'}),'다른 이름');
});
