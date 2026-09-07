const $=id=>document.getElementById(id);
// Keep the email capability out of query strings, analytics and referrers.
const token=new URLSearchParams(location.hash.slice(1)).get('token') || '';
const toronto=value=>new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',dateStyle:'full',timeStyle:'short'});
async function api(path,options={}){const r=await fetch(path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers},cache:'no-store'});const body=await r.json().catch(()=>null);if(!r.ok || !body?.ok)throw new Error(body?.error || 'We could not open your showing request. Please call us.');return body;}
function render(data){
  $('appointmentAddress').textContent=data.address;
  $('appointmentForm').hidden=!!data.confirmed_at;
  $('appointmentConfirmed').hidden=!data.confirmed_at;
  $('appointmentStatus').textContent=data.confirmed_at?'Confirmed by Golestan Team':data.preferred_at?`Requested: ${toronto(data.preferred_at)}. Awaiting confirmation.`:'Choose a time that works for you.';
  if(data.confirmed_at)$('confirmedTime').textContent=toronto(data.confirmed_at)+' · Toronto time';
}
$('appointmentDate').min=new Date().toLocaleDateString('en-CA',{timeZone:'America/Toronto'});
$('appointmentDate').max=new Date(Date.now()+29*86400000).toLocaleDateString('en-CA',{timeZone:'America/Toronto'});
$('appointmentTime').innerHTML='<option value="">Select a time</option>'+Array.from({length:24},(_,i)=>{const h=9+Math.floor(i/2),m=i%2?'30':'00';return `<option value="${String(h).padStart(2,'0')}:${m}">${h>12?h-12:h}:${m} ${h>=12?'PM':'AM'}</option>`;}).join('');
$('appointmentForm').addEventListener('submit',async e=>{e.preventDefault();if(!$('appointmentForm').reportValidity())return;$('appointmentSubmit').disabled=true;$('appointmentError').textContent='';try{const data=await api('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,date:$('appointmentDate').value,time:$('appointmentTime').value})});$('appointmentStatus').textContent=`Time requested: ${toronto(data.preferred_at)}. We’ll confirm by email. This is not yet a booking.`;$('appointmentSubmit').textContent='Update my preferred time';}catch(e){$('appointmentError').textContent=e.message;}finally{$('appointmentSubmit').disabled=false;}});
$('addCalendar').addEventListener('click',async()=>{try{const r=await fetch('/api/appointments/calendar',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok){const b=await r.json();throw new Error(b.error || 'Your appointment is not confirmed.');}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='golestan-showing.ics';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){$('appointmentError').textContent=e.message;}});
if(!token){$('appointmentAddress').textContent='Open the showing link in your AI report email.';$('appointmentError').textContent='Or call Golestan Team at 647-890-4704.';}else api('/api/appointments').then(render).catch(e=>{$('appointmentAddress').textContent='Let’s arrange your next step.';$('appointmentError').textContent=e.message;});
