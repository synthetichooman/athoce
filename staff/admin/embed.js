const routes={'/staff/admin/schedule.html':'schedule','/staff/admin/':'schedule','/staff/payroll/':'payroll','/staff/contracts/':'contracts','/staff/labor/':'labor'};
export function registerAdminPanel(isDirty=()=>false){
 const tab=routes[location.pathname];
 if(window===window.top){if(tab)location.replace('/staff/admin/#'+tab);return;}
 document.documentElement.classList.add('admin-embedded');
 const send=m=>parent.postMessage(m,location.origin);
 let last;const report=()=>{const dirty=!!isDirty();if(dirty!==last){last=dirty;send({type:'staff:dirty',dirty});}};
 setInterval(report,300);document.addEventListener('input',()=>queueMicrotask(report));report();
 document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;const u=new URL(a.href,location.href),next=u.origin===location.origin&&routes[u.pathname];if(next){e.preventDefault();send({type:'staff:tab',tab:next});}});
 window.addEventListener('staff-api-saved',()=>{report();send({type:'staff:saved'});});
 window.addEventListener('staff-api-unauthorized',()=>send({type:'staff:unauthorized'}));
}
