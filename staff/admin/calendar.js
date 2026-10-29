import { addDays, weekOf, monthDates } from '../shared.js';

export function calendarDates(month) {
  const days = monthDates(month);
  const start = weekOf(days[0]);
  const end = addDays(weekOf(days.at(-1)), 6);
  const result = [];
  for (let date = start; date <= end; date = addDays(date, 1)) result.push(date);
  return result;
}

export const calendarWeeks = month => calendarDates(month).filter((_, i) => i % 7 === 0);

export function daySummary(record, date) {
  const { schedule, workflow, availability, employees } = record;
  const staged = schedule.workflow === 'staged';
  const core = staged ? workflow.coreAssignments[date] || [] : [];
  const assigned = schedule.draft[date] || [];
  const required = Math.max(schedule.required[date], core.length);
  const applicants = employees.filter(e => e.active && (!staged || e.role === 'staff') && availability[date.slice(0, 7)]?.[e.id]?.dates.includes(date));
  const published = schedule.published;
  const changed = !!published && (JSON.stringify([...assigned].sort()) !== JSON.stringify([...(published.assignments[date] || [])].sort()) || schedule.start !== published.start || schedule.end !== published.end);
  const phase = published ? changed ? 'changed' : 'confirmed' : !required ? 'off' : !staged || schedule.openedAt ? 'open' : assigned.length ? 'draft' : 'waiting';
  const label = { changed: '수정 중', confirmed: required ? '확정' : '휴무 확정', off: '휴무', open: '신청 중', draft: '배정 중', waiting: '입력 대기' }[phase];
  return { core, assigned, required, applicants, phase, label, unfilled: Math.max(0, required - assigned.length), remaining: Math.max(0, required - core.length) };
}
