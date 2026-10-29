import { EVENT, SLOTS, json, failure, validateBooking } from '../../functions/_recruit-rsvp.js';

export class RecruitRsvp {
  constructor(ctx) { this.storage = ctx.storage; this.queue = Promise.resolve(); }
  fetch(request) {
    const result = this.queue.then(() => this.handle(request));
    this.queue = result.catch(() => {});
    return result;
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') {
      const rows = await this.storage.get('reservations') || [];
      if (path === '/availability') return json({ ok: true, event: EVENT, slots: SLOTS.map(slot => ({
        ...slot, available: Date.parse(slot.startsAt) > Date.now() && !rows.some(row => row.slot === slot.time),
      })) });
      if (path === '/reservations') return json({ ok: true, event: EVENT, list: rows.sort((a, b) => a.slot.localeCompare(b.slot)) });
    }
    if (request.method === 'POST' && path === '/reservations') {
      const fields = validateBooking(await request.json().catch(() => null));
      if (!fields) return failure('INVALID_INPUT', '이름, 연락처와 면접 시간을 확인해 주세요.');
      return this.storage.transaction(async txn => {
        const rows = await txn.get('reservations') || [];
        const existing = rows.find(row => row.id === fields.id);
        if (existing) {
          if (['fullName', 'phone', 'slot'].some(key => existing[key] !== fields[key])) return failure('ID_CONFLICT', '이 접수 번호로 예약이 완료되었습니다. 기존 예약을 관리자에게 확인해 주세요.', 409);
          return json({ ok: true, reservation: { code: existing.id, slot: existing.slot }, event: EVENT });
        }
        const slot = SLOTS.find(slot => slot.time === fields.slot);
        if (Date.parse(slot.startsAt) <= Date.now()) return failure('CLOSED', '이미 지난 시간입니다. 다른 시간을 선택해 주세요.', 409);
        if (rows.some(row => row.phone === fields.phone)) return failure('DUPLICATE_PHONE', '이 연락처로 이미 예약되었습니다. 시간 변경은 담당자에게 문의해 주세요.', 409);
        if (rows.some(row => row.slot === fields.slot)) return failure('SLOT_TAKEN', '방금 다른 분이 예약한 시간입니다. 다른 시간을 선택해 주세요.', 409);
        const record = { ...fields, submittedAt: new Date().toISOString() };
        await txn.put('reservations', [...rows, record]);
        return json({ ok: true, reservation: { code: record.id, slot: record.slot }, event: EVENT });
      });
    }
    if (request.method === 'DELETE' && path === '/reservations') {
      const id = (await request.json().catch(() => null))?.id;
      return this.storage.transaction(async txn => {
        const rows = await txn.get('reservations') || [];
        if (!rows.some(row => row.id === id)) return failure('NOT_FOUND', '예약을 찾지 못했습니다.', 404);
        await txn.put('reservations', rows.filter(row => row.id !== id));
        return json({ ok: true });
      });
    }
    return failure('NOT_FOUND', '잘못된 요청입니다.', 404);
  }
}
export default { fetch() { return new Response('Not found', { status: 404 }); } };
