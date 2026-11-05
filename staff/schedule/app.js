import { $, el, api, today, monthMove, dateLabel } from '../shared.js';
import { calendarDates } from '../admin/calendar.js';

const currentMonth = today().slice(0, 7);
const minMonth = monthMove(currentMonth, -1), maxMonth = monthMove(currentMonth, 12);
const validMonth = value => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value || '') && value >= minMonth && value <= maxMonth;
const initial = new URL(location.href).searchParams.get('month');
let month = validMonth(initial) ? initial : currentMonth;
let data = null, requestId = 0, loading = false;
$('#month').min = minMonth; $('#month').max = maxMonth;
function message(text, error = false) { $('#status').textContent = text; $('#status').dataset.error = String(error); }
function controls() {
  $('#month').value = month;
  $('#previous').disabled = month <= minMonth;
  $('#next').disabled = month >= maxMonth;
  $('#monthTitle').textContent = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;
}
function render() {
  const selected = $('#person').value;
  const days = new Map(data.days.map(day => [day.date, day]));
  $('#calendar').replaceChildren();
  for (const date of calendarDates(month)) {
    const cell = el('div', null, 'day');
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    cell.dataset.weekday = weekday;
    if (!date.startsWith(month)) { cell.classList.add('outside'); cell.setAttribute('aria-hidden', 'true'); $('#calendar').append(cell); continue; }
    const day = days.get(date);
    cell.setAttribute('role', 'listitem');
    cell.dataset.today = String(date === data.today);
    const number = el('time', String(Number(date.slice(8))), 'day-number'); number.dateTime = date;
    if (date === data.today) number.setAttribute('aria-label', `${dateLabel(date)} 오늘`);
    cell.append(number);
    const members = selected ? day.members.filter(member => member.name === selected) : day.members;
    if (members.length) {
      const names = el('div', null, 'members');
      for (const member of members) {
        const badge = el('span', member.name, 'member'); badge.dataset.member = member.name.trim().toLowerCase(); names.append(badge);
      }
      const hours = el('div', null, 'hours');
      hours.append(el('span', day.start), el('span', `–${day.end}`));
      cell.append(names, hours);
    } else {
      const state = day.state === 'off' ? '휴무' : day.state === 'pending' ? '미확정' : day.state === 'unassigned' ? '배정 없음' : '—';
      cell.append(el('span', state, 'day-state'));
    }
    const label = members.length ? `${members.map(member => member.name).join(', ')} ${day.start}~${day.end}` : cell.querySelector('.day-state').textContent;
    cell.setAttribute('aria-label', `${dateLabel(date)} · ${label}`);
    $('#calendar').append(cell);
  }
  const count = data.days.filter(day => day.members.some(member => !selected || member.name === selected)).length;
  $('#summary').textContent = selected ? `${selected} · ${count}일` : `근무 확정 ${count}일`;
}
async function load(next = month) {
  if (!validMonth(next)) { $('#month').value = month; return; }
  const changed = next !== month || data?.month !== next;
  month = next; controls();
  const id = ++requestId; loading = true;
  $('#calendarPanel').setAttribute('aria-busy', 'true');
  if (changed) { $('#calendar').replaceChildren(); $('#summary').textContent = ''; $('#updated').textContent = ''; }
  message('근무표를 불러오고 있습니다.');
  try {
    const result = await api(`/api/staff/schedule?month=${encodeURIComponent(month)}`);
    if (id !== requestId) return;
    data = result;
    const selected = $('#person').value;
    $('#person').replaceChildren(new Option('전체 근무자', ''));
    const names = [...new Set(data.days.flatMap(day => day.members.map(member => member.name)))];
    for (const name of names) $('#person').append(new Option(name, name));
    $('#person').value = names.includes(selected) ? selected : '';
    render();
    $('#updated').textContent = `${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date())} 확인`;
    message(data.days.some(day => day.state !== 'pending') ? '' : '아직 확정된 일정이 없어요. 확정되면 여기에 표시돼요.');
    const url = new URL(location.href); url.searchParams.set('month', month); history.replaceState(null, '', url);
  } catch (error) {
    if (id === requestId) message(`${error.message}${!changed && data ? ' 현재 화면은 이전에 확인한 일정입니다.' : ''}`, true);
  } finally { if (id === requestId) { loading = false; $('#calendarPanel').setAttribute('aria-busy', 'false'); } }
}
$('#previous').onclick = () => load(monthMove(month, -1));
$('#next').onclick = () => load(monthMove(month, 1));
$('#thisMonth').onclick = () => load(currentMonth);
$('#month').onchange = () => load($('#month').value);
$('#person').onchange = () => { if (data?.month === month) render(); };
$('#refresh').onclick = () => load();
$('#copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/staff/schedule/`); message('공유 링크를 복사했어요.'); }
  catch { message(`공유 주소: ${location.origin}/staff/schedule/`); }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && !loading) load(); });
setInterval(() => { if (!document.hidden && !loading) load(); }, 60000);
await load();
