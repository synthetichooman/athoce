import { allowedMonth, monthDates, weekOf, today, json, fail } from './_staff-schedule.js';
import { employeeLabel } from '../staff/names.js';

// This projection is intentionally independent of admin/employee responses.
// Only published shifts are shared; no roster, identifiers or HR data leave here.
export async function readSharedSchedule(db, requestedMonth, employees) {
  const month = requestedMonth || today().slice(0, 7);
  if (!allowedMonth(month)) return fail('조회 가능한 월을 선택해 주세요.');
  const dates = monthDates(month);
  const weeks = new Map(await Promise.all([...new Set(dates.map(weekOf))].map(async week => [week, await db.get(`week:${week}`)])));
  const people = new Map(employees.map(employee => [employee.id, employee]));
  const days = dates.map(date => {
    const published = weeks.get(weekOf(date))?.published;
    if (!published) return { date, state: 'pending', members: [] };
    const assigned = published.assignments[date] || [];
    const members = assigned.map(id => {
      const employee = people.get(id);
      return { name: employee ? employeeLabel(employee) : '근무자', role: employee?.role === 'core' ? 'core' : 'staff' };
    });
    // Legacy snapshots do not contain closure information. Do not infer it
    // from editable draft requirements, or an unpublished closure could leak.
    const state = assigned.length ? 'confirmed' : published.required?.[date] === 0 ? 'off' : 'unassigned';
    return { date, state, members, start: published.start, end: published.end };
  });
  return json({ ok: true, month, today: today(), days });
}
