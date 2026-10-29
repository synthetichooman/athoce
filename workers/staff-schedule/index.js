import { DEFAULT_SETTINGS, json, fail, today, addDays, weekOf, monthDates, allowedMonth, validWeek, tokenHash, nextMonth } from '../../functions/_staff-schedule.js';

const freshWeek = week => ({ week, version: 0, draft: {}, published: null, start: DEFAULT_SETTINGS.shiftStart, end: DEFAULT_SETTINGS.shiftEnd, required: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays(week, i), 1])) });
const timestamp = () => new Date(Date.now()).toISOString();
const publicEmployee = ({ id, name, active }) => ({ id, name, active });
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export class StaffSchedule {
  constructor(ctx) { this.storage = ctx.storage; this.queue = Promise.resolve(); }
  fetch(request) {
    const result = this.queue.then(async () => {
      try { return await this.storage.transaction(tx => this.handle(request, tx)); }
      catch { return fail('근무표를 처리하지 못했습니다. 새로고침 후 다시 시도해 주세요.', 503); }
    });
    this.queue = result.catch(() => {}); return result;
  }
  async handle(request, db) {
    const payload = await request.json().catch(() => null);
    if (!payload) return fail('잘못된 요청입니다.');
    const employees = await db.get('employees') || [];
    const admin = ['admin-read', 'admin-write'].includes(payload.action);
    const employee = !admin && employees.find(e => e.active && e.credential === payload.credential);
    if (!admin && !employee) return fail('직원 링크가 만료되었거나 사용 중지되었습니다. 관리자에게 새 링크를 요청해 주세요.', 401);
    if (payload.action === 'identity') return json({ ok: true, employee: publicEmployee(employee) });
    if (payload.action === 'admin-read') {
      const week = payload.week || addDays(weekOf(today()), 7);
      if (!validWeek(week)) return fail('조회할 주를 확인해 주세요.');
      const schedule = await db.get(`week:${week}`) || freshWeek(week);
      const months = [...new Set(Array.from({ length: 7 }, (_, i) => addDays(week, i).slice(0, 7)))];
      const availability = Object.fromEntries(await Promise.all(months.map(async month => [month, await db.get(`month:${month}`) || {}])));
      const requests = (await db.get('requests') || []).filter(r => r.status === 'pending');
      return json({ ok: true, today: today(), settings: DEFAULT_SETTINGS, employees: employees.map(publicEmployee), schedule, availability, requests });
    }
    if (payload.action === 'employee-read') {
      const month = payload.month || nextMonth();
      if (!allowedMonth(month)) return fail('조회 가능한 월을 선택해 주세요.');
      const data = (await db.get(`month:${month}`) || {})[employee.id] || { version: 0, dates: [], submittedAt: null, note: '' };
      const weeks = [...new Set(monthDates(month).map(weekOf))]; const confirmed = []; const locked = [];
      for (const week of weeks) {
        const record = await db.get(`week:${week}`);
        if (record?.published) {
          for (let i = 0; i < 7; i++) {
            const date = addDays(week, i); if (!date.startsWith(month)) continue;
            locked.push(date);
            if ((record.published.assignments[date] || []).includes(employee.id)) confirmed.push({ date, start: record.published.start, end: record.published.end });
          }
        }
      }
      const requests = (await db.get('requests') || []).filter(r => r.employeeId === employee.id && r.date.startsWith(month));
      return json({ ok: true, today: today(), employee: publicEmployee(employee), settings: DEFAULT_SETTINGS, month, availability: data, confirmed, locked, requests });
    }
    const body = payload.body;
    if (!body || typeof body !== 'object') return fail('잘못된 요청입니다.');
    if (payload.action === 'employee-write' && body.op === 'availability.save') {
      const { month, dates, note = '' } = body;
      const valid = monthDates(month);
      if (!allowedMonth(month) || !Array.isArray(dates) || dates.length > 31 || dates.some(d => !valid.includes(d)) || new Set(dates).size !== dates.length || typeof note !== 'string' || note.length > 300) return fail('가능한 날짜와 메모를 확인해 주세요.');
      const all = await db.get(`month:${month}`) || {};
      const current = all[employee.id] || { version: 0, dates: [] };
      if (current.version !== body.version) return fail('다른 창에서 내용이 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 409);
      const locked = new Set(valid.filter(d => d < today()));
      for (const week of new Set(valid.map(weekOf))) {
        if ((await db.get(`week:${week}`))?.published) valid.filter(d => weekOf(d) === week).forEach(d => locked.add(d));
      }
      if (valid.some(d => locked.has(d) && current.dates.includes(d) !== dates.includes(d))) return fail('확정되었거나 지난 날짜는 직접 수정할 수 없습니다. 변경 요청을 남겨 주세요.', 409);
      all[employee.id] = { dates: [...dates].sort(), note: note.trim(), version: current.version + 1, submittedAt: timestamp() };
      await db.put(`month:${month}`, all); return json({ ok: true });
    }
    if (payload.action === 'employee-write' && body.op === 'request.add') {
      if (!monthDates(String(body.date).slice(0, 7)).includes(body.date) || !allowedMonth(body.date.slice(0, 7)) || body.date < today() || typeof body.available !== 'boolean' || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 300 || !validId(body.id)) return fail('변경 날짜와 사유를 확인해 주세요.');
      if (!(await db.get(`week:${weekOf(body.date)}`))?.published) return fail('아직 확정되지 않은 날짜입니다. 달력에서 직접 수정해 주세요.', 409);
      const requests = await db.get('requests') || [];
      const existing = requests.find(r => r.id === body.id);
      if (existing) return existing.employeeId === employee.id && existing.date === body.date && existing.available === body.available && existing.reason === body.reason.trim() ? json({ ok: true }) : fail('중복 요청 번호입니다.', 409);
      if (requests.filter(r => r.status === 'pending').length >= 100 || requests.some(r => r.employeeId === employee.id && r.date === body.date && r.status === 'pending')) return fail('이미 대기 중인 요청이 있습니다. 관리자 확인 후 다시 요청해 주세요.', 409);
      requests.push({ id: body.id, employeeId: employee.id, date: body.date, available: body.available, reason: body.reason.trim(), status: 'pending', createdAt: timestamp() });
      await db.put('requests', requests.filter(r => r.status === 'pending').concat(requests.filter(r => r.status !== 'pending').slice(-100)));
      return json({ ok: true });
    }
    if (!admin || payload.action !== 'admin-write') return fail('잘못된 요청입니다.');
    if (body.op === 'employee.add' || body.op === 'employee.rotate') {
      if (!validId(body.id) || typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) return fail('직원 정보를 확인해 주세요.');
      const credential = await tokenHash(body.token);
      const target = employees.find(e => e.id === body.id);
      if (body.op === 'employee.add') {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 50 || /[\u0000-\u001f\u007f]/.test(body.name)) return fail('직원 이름을 확인해 주세요.');
        if (target) return target.credential === credential && target.name === body.name.trim() ? json({ ok: true }) : fail('이미 등록된 직원입니다.', 409);
        if (employees.length >= 50) return fail('직원은 최대 50명까지 등록할 수 있습니다.');
        employees.push({ id: body.id, name: body.name.trim(), credential, active: true, createdAt: timestamp() });
      } else {
        if (!target?.active) return fail('직원을 찾지 못했습니다.', 404);
        target.credential = credential;
      }
      await db.put('employees', employees); return json({ ok: true });
    }
    if (body.op === 'employee.archive' || body.op === 'employee.delete') {
      const target = employees.find(e => e.id === body.id);
      if (!target) return fail('직원을 찾지 못했습니다.', 404);
      const weeks = await db.list({ prefix: 'week:' });
      if ([...weeks.values()].some(w => Object.entries(w.published?.assignments || {}).some(([d, ids]) => d >= today() && ids.includes(body.id)))) return fail('먼저 앞으로의 확정 근무에서 이 직원을 해제하고 다시 확정해 주세요.', 409);
      if (body.op === 'employee.delete') {
        if ([...weeks.values()].some(w => Object.values(w.published?.assignments || {}).some(ids => ids.includes(body.id)))) return fail('확정 근무 이력이 있습니다. 삭제 대신 사용 중지해 주세요.', 409);
        for (const [key, month] of await db.list({ prefix: 'month:' })) { delete month[body.id]; await db.put(key, month); }
        for (const [key, week] of weeks) { let changed = false; for (const [date, ids] of Object.entries(week.draft)) { if (ids.includes(body.id)) { week.draft[date] = ids.filter(id => id !== body.id); changed = true; } } if (changed) { week.version++; await db.put(key, week); } }
        await db.put('requests', (await db.get('requests') || []).filter(r => r.employeeId !== body.id));
        await db.put('employees', employees.filter(e => e.id !== body.id));
      } else { target.active = false; await db.put('employees', employees); }
      return json({ ok: true });
    }
    if (body.op === 'week.save' || body.op === 'week.publish') {
      if (!validWeek(body.week) || addDays(body.week, 6) < today()) return fail('지난 근무표는 수정할 수 없습니다.');
      const schedule = await db.get(`week:${body.week}`) || freshWeek(body.week);
      if (schedule.version !== body.version) return fail('근무표가 변경되었습니다. 새로고침 후 다시 확인해 주세요.', 409);
      if (body.op === 'week.save') {
        if (!time(body.start) || !time(body.end) || body.end <= body.start || !body.assignments || typeof body.assignments !== 'object' || !body.required || typeof body.required !== 'object') return fail('근무 시간과 배정을 확인해 주세요.');
        const draft = {}; const required = {};
        for (let i = 0; i < 7; i++) {
          const date = addDays(body.week, i); const ids = body.assignments[date] || []; const need = body.required[date];
          if (!Number.isInteger(need) || need < 0 || need > 10 || !Array.isArray(ids) || ids.length > 10 || ids.some(id => !employees.some(e => e.id === id && (date < today() || e.active))) || new Set(ids).size !== ids.length) return fail('날짜별 필요 인원과 직원을 확인해 주세요.');
          if (date < today() && (JSON.stringify(ids) !== JSON.stringify(schedule.draft[date] || []) || need !== schedule.required[date] || body.start !== schedule.start || body.end !== schedule.end)) return fail('이미 지난 날짜의 배정과 시간은 변경할 수 없습니다.');
          const availability = await db.get(`month:${date.slice(0, 7)}`) || {};
          if (date >= today() && ids.some(id => !availability[id]?.dates.includes(date))) return fail('근무 가능 날짜를 제출한 직원만 배정할 수 있습니다.', 409);
          draft[date] = ids; required[date] = need;
        }
        schedule.draft = draft; schedule.required = required; schedule.start = body.start; schedule.end = body.end;
      } else {
        // Publishing revalidates availability: an employee may have edited it since the draft was saved.
        for (let i = 0; i < 7; i++) {
          const date = addDays(body.week, i); const ids = schedule.draft[date] || [];
          if (date < today()) continue;
          const availability = await db.get(`month:${date.slice(0, 7)}`) || {};
          if (ids.length !== schedule.required[date]) return fail('필요 인원과 배정 인원이 다른 날짜가 있습니다. 휴무일은 필요 인원을 0으로 설정해 주세요.', 409);
          if (date >= today() && ids.some(id => !employees.some(e => e.id === id && e.active) || !availability[id]?.dates.includes(date))) return fail('직원의 가능 날짜가 변경되었습니다. 배정을 다시 확인해 주세요.', 409);
        }
        schedule.published = { assignments: structuredClone(schedule.draft), start: schedule.start, end: schedule.end, confirmedAt: timestamp() };
      }
      schedule.version++; schedule.updatedAt = timestamp(); await db.put(`week:${body.week}`, schedule);
      return json({ ok: true, version: schedule.version });
    }
    if (body.op === 'request.resolve') {
      if (!['approved', 'rejected'].includes(body.decision)) return fail('처리 방식을 확인해 주세요.');
      const requests = await db.get('requests') || []; const item = requests.find(r => r.id === body.id);
      if (!item) return fail('요청을 찾지 못했습니다.', 404);
      if (item.status !== 'pending') return item.status === body.decision ? json({ ok: true }) : fail('이미 처리된 요청입니다.', 409);
      if (body.decision === 'approved' && item.date < today()) return fail('이미 지난 날짜의 변경은 승인할 수 없습니다.');
      if (body.decision === 'approved') {
        if (!employees.some(e => e.id === item.employeeId && e.active)) return fail('사용 중지된 직원입니다.', 409);
        const key = `month:${item.date.slice(0, 7)}`; const all = await db.get(key) || {}; const current = all[item.employeeId] || { dates: [], version: 0, note: '' };
        current.dates = current.dates.filter(d => d !== item.date); if (item.available) current.dates.push(item.date); current.dates.sort(); current.version++; current.submittedAt = timestamp(); all[item.employeeId] = current; await db.put(key, all);
        const week = await db.get(`week:${weekOf(item.date)}`);
        if (week && !item.available) {
          week.draft[item.date] = (week.draft[item.date] || []).filter(id => id !== item.employeeId);
          if (week.published) week.published.assignments[item.date] = (week.published.assignments[item.date] || []).filter(id => id !== item.employeeId);
          week.version++; week.updatedAt = timestamp(); await db.put(`week:${week.week}`, week);
        }
      }
      item.status = body.decision; item.resolvedAt = timestamp(); await db.put('requests', requests); return json({ ok: true });
    }
    return fail('잘못된 요청입니다.');
  }
}
export default { fetch() { return new Response('Not found', { status: 404 }); } };
