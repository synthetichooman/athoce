const $=s=>document.querySelector(s);
const paths={schedule:'/staff/admin/schedule.html?embed=1',payroll:'/staff/payroll/?embed=1',labor:'/staff/labor/?embed=1',contracts:'/staff/contracts/?embed=1'};
const panels=new Map();let active='schedule',authenticated=false,busy=false;
function selected(){const key=location.hash.slice(1);return Object.hasOwn(paths,key)?key:'schedule';}
function notices(){ $('#updateNotice').hidden=!panels.get(active)?.stale; }
function show(key){
 if(!authenticated)return;
 active=Object.hasOwn(paths,key)?key:'schedule';
 if(!panels.has(active)){
  const panel=document.createElement('section');panel.className='panel';panel.id='panel-'+active;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','tab-'+active);
  const frame=document.createElement('iframe');frame.src=paths[active];frame.title=$('#tab-'+active).textContent;panel.append(frame);$('#panels').append(panel);panels.set(active,{panel,frame,dirty:false,stale:false});
 }
 for(const [key,p] of panels)p.panel.hidden=key!==active;
 for(const tab of document.querySelectorAll('[role=tab]')){const yes=tab.dataset.tab===active;tab.setAttribute('aria-selected',String(yes));tab.tabIndex=yes?0:-1;}
 notices();
}
async function request(path,body){const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error?.message||'접속을 확인해 주세요.');return data;}
function login(message=''){authenticated=false;$('#workspace').hidden=true;$('#logout').hidden=true;$('#loginPanel').hidden=false;$('#loading').hidden=true;$('#loginStatus').textContent=message;}
function ready(){authenticated=true;$('#workspace').hidden=false;$('#logout').hidden=false;$('#loginPanel').hidden=true;$('#loading').hidden=true;show(selected());}
for(const tab of document.querySelectorAll('[role=tab]'))tab.onclick=()=>{location.hash=tab.dataset.tab;show(tab.dataset.tab);};
$('.tabs').onkeydown=e=>{const tabs=[...document.querySelectorAll('[role=tab]')],i=tabs.indexOf(document.activeElement);if(i<0)return;let j;if(e.key==='ArrowRight')j=(i+1)%tabs.length;else if(e.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')j=0;else if(e.key==='End')j=tabs.length-1;else return;e.preventDefault();tabs[j].focus();tabs[j].click();};
window.addEventListener('hashchange',()=>show(selected()));
$('#refreshPanel').onclick=()=>{const p=panels.get(active);if(p.dirty&&!confirm('이 탭의 저장하지 않은 입력을 버리고 새로고침할까요?'))return;p.dirty=false;p.stale=false;p.frame.src=paths[active];$('#tab-'+active).dataset.dirty='false';$('#tab-'+active).dataset.stale='false';notices();};
window.addEventListener('message',e=>{
 if(e.origin!==location.origin)return;const entry=[...panels].find(([,p])=>p.frame.contentWindow===e.source);if(!entry)return;const [key,p]=entry,m=e.data;
 if(m?.type==='staff:tab'&&Object.hasOwn(paths,m.tab)){location.hash=m.tab;show(m.tab);}
 if(m?.type==='staff:dirty'){p.dirty=!!m.dirty;$('#tab-'+key).dataset.dirty=String(p.dirty);}
 if(m?.type==='staff:saved'){
  p.stale=false;$('#tab-'+key).dataset.stale='false';
  for(const [other,q] of panels)if(other!==key){q.stale=true;$('#tab-'+other).dataset.stale='true';}notices();
 }
 if(m?.type==='staff:unauthorized')login('로그인이 만료되었습니다. 다시 로그인하면 작성 중인 화면으로 돌아갑니다.');
});
window.addEventListener('beforeunload',e=>{if([...panels.values()].some(p=>p.dirty)){e.preventDefault();e.returnValue='';}});
$('#loginForm').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{await request('/api/staff/admin/login',{password:$('#password').value});$('#password').value='';ready();$('#loginStatus').textContent='';}catch(error){$('#loginStatus').textContent=error.message;}finally{busy=false;}};
$('#logout').onclick=async()=>{if(busy)return;if([...panels.values()].some(p=>p.dirty)&&!confirm('저장하지 않은 입력이 있습니다. 모두 닫고 로그아웃할까요?'))return;busy=true;try{await request('/api/staff/admin/logout',{});for(const p of panels.values())p.panel.remove();panels.clear();for(const t of document.querySelectorAll('[role=tab]')){delete t.dataset.dirty;delete t.dataset.stale;}login('로그아웃했습니다.');}catch(error){alert(error.message);}finally{busy=false;}};
try{await request('/api/staff/admin');ready();}catch(error){login(error.message);}
