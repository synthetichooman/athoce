import { addDays, weekOf } from './_staff-schedule.js';

// A payday on the 25th covers the previous month's 26th through this month's 25th.
export function payrollPeriod(month) {
  const previous = new Date(`${month}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const start = `${previous.toISOString().slice(0, 7)}-26`;
  const end = `${month}-25`;
  const weeks = [];
  for (let week = weekOf(start); week <= end; week = addDays(week, 7)) weeks.push(week);
  return { start, end, weeks };
}

export function payrollSummary(month, employees, schedules, asOf) {
  const { start, end } = payrollPeriod(month);
  const rows = employees.filter(e => e.role !== 'core').map(e => ({ id: e.id, name: e.name, active: e.active, weekdays: [0, 0, 0, 0, 0, 0, 0], total: 0 }));
  const byId = new Map(rows.map(row => [row.id, row]));
  for (let date = start; date <= end && date <= asOf; date = addDays(date, 1)) {
    const schedule = schedules.get(weekOf(date));
    for (const id of new Set(schedule?.published?.assignments[date] || [])) {
      const row = byId.get(id);
      if (!row) continue;
      row.weekdays[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]++;
      row.total++;
    }
  }
  return { start, end, asOf, rows: rows.filter(row => row.active || row.total) };
}
