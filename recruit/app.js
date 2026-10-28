const form = document.querySelector('#recruitForm');
const submitButton = document.querySelector('#submitButton');
const status = document.querySelector('#formStatus');
const toggle = document.querySelector('#weekdaysToggle');
const options = document.querySelector('#weekdaysOptions');
const combo = document.querySelector('#weekdaysCombo');
const days = [...options.querySelectorAll('input')];
const submissionId = crypto.randomUUID();
let submitting = false;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}
function closeDays(focus = false) {
  options.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  if (focus) toggle.focus();
}
toggle.addEventListener('click', () => {
  options.hidden = !options.hidden;
  toggle.setAttribute('aria-expanded', String(!options.hidden));
});
options.addEventListener('change', () => {
  document.querySelector('#weekdaysValue').textContent = days.filter(day => day.checked).map(day => day.value).join(', ') || '요일 선택 (복수 선택 가능)';
  toggle.removeAttribute('aria-invalid');
});
document.querySelector('#weekdaysDone').addEventListener('click', () => closeDays(true));
combo.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeDays(true); }
});
combo.addEventListener('focusout', event => {
  if (!combo.contains(event.relatedTarget)) closeDays();
});
document.addEventListener('click', event => {
  if (!combo.contains(event.target)) closeDays();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !form.reportValidity()) return;
  const selected = days.filter(day => day.checked).map(day => day.value);
  if (!selected.length) {
    setStatus('근무 가능 요일을 하나 이상 선택해 주세요.', true);
    toggle.setAttribute('aria-invalid', 'true');
    toggle.focus();
    return;
  }
  closeDays();
  submitting = true;
  submitButton.disabled = true;
  form.setAttribute('aria-busy', 'true');
  setStatus('접수 중입니다.');
  try {
    const response = await fetch(form.action, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), availableDays: selected, submissionId }),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      setStatus(result.message || '접수하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
      return;
    }
    form.hidden = true;
    form.reset();
    const confirmation = document.querySelector('#confirmation');
    confirmation.hidden = false;
    document.querySelector('#confirmationTitle').textContent = result.message || '지원서가 정상적으로 접수되었습니다.';
    confirmation.focus();
  } catch {
    setStatus('접수 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.', true);
  } finally {
    submitting = false;
    submitButton.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
