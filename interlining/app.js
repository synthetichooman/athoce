const form = document.querySelector('#interliningForm');
const submitButton = document.querySelector('#submitButton');
const status = document.querySelector('#formStatus');
const addressSearch = document.querySelector('#addressSearch');
const postcodePanel = document.querySelector('#postcodePanel');
const address = document.querySelector('#address');
const addressDetail = document.querySelector('#addressDetail');
const postcode = document.querySelector('#postcode');
let submitting = false;
const submissionId = crypto.randomUUID();
let postcodeWidget;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function closeAddressSearch() {
  postcodePanel.hidden = true;
  addressSearch.setAttribute('aria-expanded', 'false');
}

addressSearch.addEventListener('click', () => {
  if (!window.daum?.Postcode) {
    setStatus('주소 검색을 불러오지 못했습니다. 주소와 우편번호를 직접 입력해 주세요.', true);
    address.readOnly = false;
    postcode.type = 'text';
    postcode.required = true;
    document.querySelector('#postcodeLabel').hidden = false;
    address.focus();
    return;
  }
  setStatus('');
  postcodePanel.hidden = false;
  addressSearch.setAttribute('aria-expanded', 'true');
  postcodeWidget = new window.daum.Postcode({
    width: '100%',
    height: '100%',
    oncomplete(data) {
      address.value = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
      postcode.value = data.zonecode;
      closeAddressSearch();
      addressDetail.focus();
    },
  });
  postcodeWidget.embed(document.querySelector('#postcodeSearch'));
});

address.addEventListener('click', () => {
  if (address.readOnly) addressSearch.click();
});
address.addEventListener('keydown', (event) => {
  if (address.readOnly && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    addressSearch.click();
  }
});

const guestsDetail = document.querySelector('#guestsDetail');
const guestsOther = document.querySelector('#guestsOther');
form.addEventListener('change', (event) => {
  const other = guestsOther.checked;
  guestsDetail.hidden = !other;
  guestsDetail.disabled = !other;
  guestsDetail.required = other;
  if (other && event.target === guestsOther) guestsDetail.focus();
});

document.querySelector('#addressClose').addEventListener('click', () => {
  closeAddressSearch();
  addressSearch.focus();
});
postcodePanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeAddressSearch();
    addressSearch.focus();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting || !form.reportValidity()) return;
  if (!address.value.trim() || !/^\d{5}$/.test(postcode.value)) {
    setStatus('주소 검색에서 주소를 선택해 주세요.', true);
    addressSearch.focus();
    return;
  }
  submitting = true;
  submitButton.disabled = true;
  form.setAttribute('aria-busy', 'true');
  setStatus('접수 중입니다.');
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), submissionId }),
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
    document.querySelector('#confirmationTitle').textContent = result.message || '정상적으로 접수되었습니다.';
    confirmation.focus();
  } catch {
    setStatus('접수 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.', true);
  } finally {
    submitting = false;
    submitButton.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
