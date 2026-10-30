import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarDates, calendarWeeks, daySummary } from '../staff/admin/calendar.js';
import { addDays, weekOf, monthDates, validWeek } from '../functions/_staff-schedule.js';

test('month calendars show complete Monday to Sunday rows, including six-row months and leap days', () => {
  const november = calendarDates('2026-11');
  assert.equal(november.length, 42); assert.equal(november[0], '2026-10-26'); assert.equal(november.at(-1), '2026-12-06');
  assert.equal(calendarDates('2027-02').length, 28);
  assert.ok(calendarDates('2028-02').includes('2028-02-29'));
  assert.equal(calendarWeeks('2027-01')[0], '2026-12-28');
  for (const month of ['2026-11', '2027-02', '2028-02', '2027-01']) {
    assert.equal(calendarDates(month).filter(d => d.startsWith(month)).length, monthDates(month).length);
    assert.equal(new Set(calendarDates(month)).size, calendarDates(month).length);
  }
});

test('the first week of the oldest supported month remains readable across a month boundary', t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-29T15:00:00+09:00'));
  for (const week of calendarWeeks('2026-09')) assert.ok(validWeek(week), week);
  assert.equal(validWeek('2026-08-24'), false); assert.equal(validWeek('2027-11-01'), false);
});

function fixture(month = '2026-11') {
  const availability = { [month]: {
    core: { dates: ['2026-11-02'], submittedAt: '2026-10-29' },
    staff: { dates: ['2026-11-02', '2026-11-03'], submittedAt: '2026-10-29' },
    other: { dates: ['2026-11-03'], submittedAt: '2026-10-29' },
  } };
  return new Map(calendarWeeks(month).map(week => [week, {
    today: '2026-11-02', employees: [{ id: 'core', active: true, role: 'core' }, { id: 'staff', active: true, role: 'staff' }, { id: 'other', active: true, role: 'staff' }], availability,
    schedule: { week, workflow: 'staged', openedAt: null, draft: {}, published: null, start: '13:00', end: '20:00', required: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays(week, i), 1])) },
    workflow: { coreAssignments: {} },
  }]));
}

test('calendar distinguishes staff applicants, core coverage and assignments without claiming an applicant is assigned', () => {
  const record = fixture().get('2026-11-02'); record.schedule.openedAt = '2026-10-29';
  record.workflow.coreAssignments['2026-11-02'] = ['core']; record.schedule.draft['2026-11-02'] = ['core'];
  const core = daySummary(record, '2026-11-02'); assert.equal(core.remaining, 0); assert.equal(core.unfilled, 0); assert.equal(core.applicants.length, 1);
  const staff = daySummary(record, '2026-11-03'); assert.equal(staff.applicants.length, 2); assert.equal(staff.assigned.length, 0); assert.equal(staff.unfilled, 1);
  record.schedule.draft['2026-11-03'] = ['staff']; assert.equal(daySummary(record, '2026-11-03').unfilled, 0);
});

test('published and edited drafts are distinct, independent of assignment order', () => {
  const record = fixture().get('2026-11-02'); const date = '2026-11-03';
  record.schedule.draft[date] = ['staff', 'other'];
  record.schedule.published = { assignments: { [date]: ['other', 'staff'] }, start: '13:00', end: '20:00' };
  assert.equal(daySummary(record, date).phase, 'confirmed');
  record.schedule.draft[date] = ['staff']; assert.equal(daySummary(record, date).phase, 'changed');
  record.schedule.draft[date] = ['other', 'staff']; record.schedule.end = '19:00'; assert.equal(daySummary(record, date).phase, 'changed');
});

test('a closed week shows an assigned draft as pending confirmation', () => {
  const record = fixture().get('2026-11-02'); const date = '2026-11-03';
  assert.equal(daySummary(record, date).phase, 'waiting');
  record.schedule.draft[date] = ['staff'];
  assert.equal(daySummary(record, date).phase, 'draft');
  assert.equal(daySummary(record, date).label, '배정 중');
});

test('manual closure immediately replaces stale automatic core coverage in the calendar', () => {
  const record=fixture().get('2026-11-02'); const date='2026-11-02';
  record.workflow.coreAssignments[date]=['core'];
  record.schedule.manualAssignments={[date]:[]}; record.schedule.required[date]=0;
  assert.equal(daySummary(record,date).label,'휴무'); assert.equal(daySummary(record,date).unfilled,0);
  record.schedule.manualAssignments[date]=['other']; record.schedule.required[date]=1; record.schedule.draft[date]=['other'];
  assert.deepEqual(daySummary(record,date).assigned,['other']); assert.equal(daySummary(record,date).unfilled,0);
});
