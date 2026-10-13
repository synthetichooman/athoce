import { submissionsCsv } from './csv.js';

const $ = (selector) => document.querySelector(selector);
const loginPanel = $('#loginPanel');
const dashboard = $('#dashboard');
const connectionPanel = $('#connectionPanel');
let data = null;
let loading = false;
let exporting = false;
let generation = 0;
let access = null;

function status(message, error = false) { $('#status').textContent = message; $('#status').dataset.error = String(error); }
function clearData() { data = null; $('#rows').replaceChildren(); $('#detailAnswers').replaceChildren(); $('#detail').close(); dashboard.hidden = true; }
function showLogin() { generation++; access = null; $('#search').value = ''; clearData(); connectionPanel.hidden = true; loginPanel.hidden = false; $('#logout').hidden = true; }

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    const error = new Error(result.error?.message || '요청을 완료하지 못했습니다.');
    error.code = result.error?.code;
    error.status = response.status;
    throw error;
  }
  return result;
}

function time(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || '—' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function detail(row) {
  const entries = [{ label: '제출 시각 (한국 시간)', value: time(row.submittedAt) }, ...row.answers];
  $('#detailAnswers').replaceChildren();
  for (const entry of entries) {
    const label = document.createElement('dt'); label.textContent = entry.label;
    const value = document.createElement('dd'); value.textContent = entry.value || '—';
    $('#detailAnswers').append(label, value);
  }
  $('#detail').showModal();
}
function render() {
  if (!data) return;
  const search = $('#search').value.trim().toLowerCase();
  const rows = data.list.filter((row) => [row.fullName, row.instagram, row.phone].some((value) => value.toLowerCase().includes(search)));
  $('#rows').replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const text of [time(row.submittedAt), row.fullName, row.instagram, row.phone, row.guests, row.filmingConsent]) {
      const cell = document.createElement('td'); cell.textContent = text || '—'; tr.append(cell);
    }
    const cell = document.createElement('td'); const button = document.createElement('button');
    button.type = 'button'; button.textContent = '보기'; button.setAttribute('aria-label', `${row.fullName || '신청자'} 상세 보기`);
    button.addEventListener('click', () => detail(row)); cell.append(button); tr.append(cell); $('#rows').append(tr);
  }
  $('#totalCount').textContent = data.totalCount.toLocaleString('ko-KR');
  $('#pageLabel').textContent = `${data.page} / ${Math.max(1, data.totalPage)}`;
  $('#previous').disabled = data.page <= 1 || loading || exporting;
  $('#next').disabled = data.page >= data.totalPage || loading || exporting;
  $('#empty').hidden = rows.length > 0;
  $('#empty').textContent = data.totalCount === 0 ? '접수된 신청이 없습니다.' : '현재 페이지에 검색 결과가 없습니다.';
}
function busy() {
  for (const selector of ['#refresh', '#connectionRefresh', '#export']) $(selector).disabled = loading || exporting;
  render();
}
function failure(error) {
  if (error.status === 401) showLogin();
  if (['COMMUNITY_PERMISSION_REQUIRED', 'IMWEB_CONNECTION_REQUIRED'].includes(error.code)) { clearData(); connectionPanel.hidden = false; $('#connectLink').hidden = access !== 'owner'; $('#connectionMessage').textContent = access === 'owner' ? '아임웹에서 커뮤니티 조회 권한을 승인한 뒤 이 페이지로 돌아와 연결을 확인해 주세요.' : '신청 목록의 아임웹 연결이 필요합니다. athoce 담당자에게 연결을 요청해 주세요.'; }
  status(error.message || '연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
}
async function load(page = 1) {
  if (loading || exporting) return;
  const current = generation; loading = true; busy(); status('신청 목록을 불러오고 있습니다.');
  try {
    const result = await api(`/api/interlining/submissions?page=${page}&limit=50`);
    if (current !== generation) return;
    data = result.data; dashboard.hidden = false; connectionPanel.hidden = true;
    status('제출 시각은 한국 시간으로 표시됩니다.'); render();
  } catch (error) { if (current === generation) { clearData(); failure(error); } }
  finally { loading = false; busy(); }
}
$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#loginButton').disabled = true;
  try {
    const login = await api('/api/interlining/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) });
    access = login.access; $('#password').value = ''; loginPanel.hidden = true; $('#logout').hidden = false; await load();
  } catch (error) { failure(error); }
  finally { $('#loginButton').disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  $('#logout').disabled = true;
  try { await api('/api/interlining/logout', { method: 'POST' }); showLogin(); status('로그아웃했습니다.'); }
  catch (error) { failure(error); }
  finally { $('#logout').disabled = false; }
});
$('#refresh').addEventListener('click', () => load(data?.page || 1));
$('#connectionRefresh').addEventListener('click', () => load());
$('#previous').addEventListener('click', () => load(data.page - 1));
$('#next').addEventListener('click', () => load(data.page + 1));
$('#search').addEventListener('input', render);
$('#closeDetail').addEventListener('click', () => $('#detail').close());
$('#export').addEventListener('click', async () => {
  if (loading || exporting || !data) return;
  const current = generation; exporting = true; busy();
  try {
    const rows = new Map(); let total; let pages;
    for (let page = 1; ; page++) {
      status(`CSV를 준비하고 있습니다. ${page}${pages ? ` / ${pages}` : ''}페이지`);
      const result = (await api(`/api/interlining/submissions?page=${page}&limit=100`)).data;
      if (current !== generation) return;
      total ??= result.totalCount; pages ??= Math.max(1, result.totalPage);
      if (result.totalCount !== total || Math.max(1, result.totalPage) !== pages) throw new Error('내보내기 중 신청 목록이 변경되었습니다. 다시 다운로드해 주세요.');
      for (const row of result.list) rows.set(row.code, row);
      if (page >= pages) break;
    }
    if (rows.size !== total) throw new Error('전체 신청 목록을 확인하지 못했습니다. 다시 다운로드해 주세요.');
    const url = URL.createObjectURL(new Blob([submissionsCsv([...rows.values()])], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `interlining-${new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul'}).format(new Date())}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`${total}건의 신청 목록을 다운로드했습니다.`);
  } catch (error) { if (current === generation) failure(error); }
  finally { exporting = false; busy(); }
});

try {
  const session = await api('/api/interlining/session');
  if (session.authenticated) { access = session.access; $('#logout').hidden = false; await load(); }
  else { showLogin(); status(session.adminConfigured ? '' : '관리자 비밀번호가 아직 설정되지 않았습니다.', !session.adminConfigured); }
} catch (error) { showLogin(); failure(error); }
