const $ = selector => document.querySelector(selector);
let busy = false;
let generation = 0;
function status(text, error = false) { $('#status').textContent = text; $('#status').dataset.error = String(error); }
function login() { generation++; $('#rows').replaceChildren(); $('#count').textContent = '0'; $('#dashboard').hidden = true; $('#loginPanel').hidden = false; $('#logout').hidden = true; }
async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok || !result.ok) { if (response.status === 401) login(); throw new Error(result.error?.message || '요청을 완료하지 못했습니다.'); }
  return result;
}
function time(value) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
async function load() {
  if (busy) return;
  const current = generation;
  busy = true; $('#refresh').disabled = true; status('예약을 불러오고 있습니다.');
  try {
    const result = await api('/api/recruit/rsvp/submissions');
    if (current !== generation) return;
    $('#rows').replaceChildren(); $('#count').textContent = result.list.length; $('#empty').hidden = result.list.length > 0;
    for (const row of result.list) {
      const tr = document.createElement('tr');
      for (const text of [row.slot, row.fullName, row.phone, time(row.submittedAt)]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      const td = document.createElement('td'); const button = document.createElement('button'); button.type = 'button'; button.textContent = '예약 취소';
      button.addEventListener('click', async () => {
        if (busy || !confirm(`${row.fullName} 님의 ${row.slot} 예약을 취소할까요? 취소하면 다른 분이 이 시간을 예약할 수 있습니다.`)) return;
        busy = true; button.disabled = true; $('#refresh').disabled = true;
        try { await api('/api/recruit/rsvp/submissions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: row.id }) }); busy = false; await load(); }
        catch (error) { status(error.message, true); }
        finally { busy = false; button.disabled = false; $('#refresh').disabled = false; }
      });
      td.append(button); tr.append(td); $('#rows').append(tr);
    }
    $('#loginPanel').hidden = true; $('#dashboard').hidden = false; $('#logout').hidden = false;
    status('시간순으로 표시됩니다. 예약 취소 시 해당 시간은 다시 열립니다.');
  } catch (error) { $('#rows').replaceChildren(); $('#dashboard').hidden = true; status(error.message, true); }
  finally { busy = false; $('#refresh').disabled = false; }
}
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#loginButton').disabled = true;
  try { await api('/api/recruit/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; await load(); }
  catch (error) { status(error.message, true); }
  finally { $('#loginButton').disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  $('#logout').disabled = true;
  try { await api('/api/recruit/logout', { method: 'POST' }); login(); status('로그아웃했습니다.'); }
  catch (error) { status(error.message, true); }
  finally { $('#logout').disabled = false; }
});
$('#refresh').addEventListener('click', load);
try { const result = await api('/api/recruit/session'); if (result.authenticated) await load(); else { login(); status('채용 관리자 비밀번호로 로그인해 주세요.'); } }
catch (error) { login(); status(error.message, true); }
