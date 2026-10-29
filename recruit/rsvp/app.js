const form = document.querySelector('#rsvpForm');
const slots = document.querySelector('#slots');
const status = document.querySelector('#formStatus');
const submit = document.querySelector('#submitButton');
const refresh = document.querySelector('#refreshSlots');
let submissionId = crypto.randomUUID();
let loading = false;
let submitting = false;
let finished = false;
let pendingPayload = null;
let scheduleSignature = '';

function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
function updateSubmit() { submit.disabled = loading || submitting || (!pendingPayload && !slots.querySelector('input:checked')); }
async function loadSlots() {
  if (loading || submitting || finished || pendingPayload) return;
  const previous = slots.querySelector('input:checked')?.value;
  loading = true; refresh.disabled = true; slots.setAttribute('aria-busy', 'true'); updateSubmit();
  try {
    const response = await fetch('/api/recruit/rsvp', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || '예약 시간을 불러오지 못했습니다.');
    const signature = JSON.stringify(result.slots);
    if (signature !== scheduleSignature) {
      slots.replaceChildren();
      for (const slot of result.slots) {
        const label = document.createElement('label'); label.className = 'slot';
        const group = document.createElement('span'); group.className = 'slot-time';
        const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'slot'; radio.value = slot.time; radio.required = true; radio.disabled = !slot.available; radio.checked = slot.available && slot.time === previous;
        group.append(radio, `${slot.time} – ${slot.end}`);
        const state = document.createElement('span'); state.className = 'slot-state'; state.textContent = slot.available ? '예약 가능' : '마감';
        label.append(group, state); slots.append(label);
      }
      scheduleSignature = signature;
    }
    document.querySelector('#slotStatus').textContent = result.slots.some(slot => slot.available) ? '예약이 완료된 시간은 선택할 수 없습니다.' : '현재 예약 가능한 시간이 없습니다. 채용 담당자에게 문의해 주세요.';
    if (previous && !slots.querySelector('input:checked')) message('선택하신 시간이 마감되었습니다. 다른 시간을 선택해 주세요.', true);
  } catch (error) {
    // Do not retain a selectable stale schedule after a failed availability check.
    for (const radio of slots.querySelectorAll('input')) { radio.checked = false; radio.disabled = true; }
    scheduleSignature = '';
    document.querySelector('#slotStatus').textContent = '예약 시간을 확인하지 못했습니다. 가능한 시간 새로고침을 눌러 주세요.';
  } finally { loading = false; refresh.disabled = false; slots.setAttribute('aria-busy', 'false'); updateSubmit(); }
}
slots.addEventListener('change', () => { updateSubmit(); message(''); });
refresh.addEventListener('click', loadSlots);
window.addEventListener('focus', loadSlots);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSlots(); });
setInterval(() => { if (!document.hidden) loadSlots(); }, 30000);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || loading || finished || !form.reportValidity()) return;
  const phone = form.elements.phone.value.replace(/[\s()-]/g, '');
  if (!/^0[1-9]\d{7,9}$/.test(phone)) { message('연락처를 확인해 주세요.', true); form.elements.phone.focus(); return; }
  const payload = pendingPayload || { ...Object.fromEntries(new FormData(form)), submissionId };
  submitting = true; refresh.disabled = true; form.setAttribute('aria-busy', 'true'); updateSubmit(); message('예약을 확인하고 있습니다.');
  // Keep the same payload when the network result is uncertain, so retries cannot book a second slot.
  pendingPayload = payload;
  let refreshAfter = false;
  try {
    const response = await fetch(form.action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (response.status < 500) {
        pendingPayload = null;
        refreshAfter = true;
        scheduleSignature = '';
        if (result.error?.code === 'ID_CONFLICT') submissionId = crypto.randomUUID();
      }
      throw new Error(result.error?.message || '예약 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
    }
    finished = true; pendingPayload = null; form.hidden = true; form.reset();
    document.querySelector('#confirmedTime').textContent = `${result.event.dateLabel} ${result.reservation.slot} (한국 시간) · 면접 30분`;
    const confirmation = document.querySelector('#confirmation'); confirmation.hidden = false; confirmation.focus();
  } catch (error) { message(error instanceof TypeError ? '예약 결과를 확인하지 못했습니다. 확정 버튼을 다시 눌러 같은 예약을 확인해 주세요.' : error.message || '예약 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.', true); }
  finally {
    submitting = false; refresh.disabled = Boolean(pendingPayload); form.removeAttribute('aria-busy');
    for (const input of form.querySelectorAll('input:not([type="radio"])')) input.readOnly = Boolean(pendingPayload);
    if (pendingPayload) for (const input of slots.querySelectorAll('input')) input.disabled = true;
    updateSubmit();
    if (refreshAfter) { const selected = slots.querySelector('input:checked'); if (selected) selected.checked = false; await loadSlots(); }
  }
});
loadSlots();
