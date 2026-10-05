// Admin-only TEST mail. No live key, paid send, scheduler or public-site changes.
import {mailingSubject} from './admin-prospects-api.js';
const encoder=new TextEncoder(),API='https://api.postgrid.com/print-mail/v1';
const MAX_PDF=8*1024*1024,MAX_BODY=12*1024*1024;
class MailError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status)=>{throw new MailError(message,status);};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
function testKey(env){const key=String(env.POSTGRID_TEST_API_KEY||'').trim();if(!/^test_/i.test(key))fail('PostGrid Test key is missing or is not a test key. Live sending is disabled.',503);return key;}
export function contact(value){
 if(!value||typeof value!=='object')fail('Enter the recipient and return address.');
 const out={};for(const k of ['firstName','lastName','companyName','addressLine1','addressLine2','city','provinceOrState','postalOrZip']){const v=String(value[k]||'').trim();if(v.length>150||/[\x00-\x1f\x7f]/.test(v))fail('Invalid address field.');if(v)out[k]=v;}
 if(!out.firstName&&!out.companyName)fail('Enter a recipient name or company.');
 if(!out.addressLine1||!out.city)fail('Enter a street address and city.');
 out.provinceOrState=String(out.provinceOrState||'').toUpperCase();if(!['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'].includes(out.provinceOrState))fail('Choose a Canadian province or territory.');
 const postal=String(out.postalOrZip||'').toUpperCase().replace(/\s/g,'');if(!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(postal))fail('Enter a complete Canadian postal code.');
 out.postalOrZip=postal.slice(0,3)+' '+postal.slice(3);out.countryCode='CA';return out;
}
export function pdfBytes(value){
 if(typeof value!=='string'||value.length>Math.ceil(MAX_PDF/3)*4||(value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)))fail('Upload a PDF of 8 MB or less.');
 let bytes;try{bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{fail('Invalid PDF upload.');}
 if(bytes.length<20||bytes.length>MAX_PDF||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')fail('The uploaded file must be a PDF of 8 MB or less.');return bytes;
}
async function bodyOf(request){
 if(Number(request.headers.get('content-length'))>MAX_BODY)fail('Request is too large.',413);
 const reader=request.body?.getReader();if(!reader)fail('Missing request.');let size=0,parts=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();fail('Request is too large.',413);}parts.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid request.');}
}
async function db(env,query='',method='GET',body,prefer='return=representation'){
 if(!env.SUPABASE_SERVICE_ROLE_KEY)fail('Private mailing storage is unavailable.',503);
 const r=await fetch((env.SUPABASE_URL||'https://pwbtxyavjjotxtvegrqe.supabase.co')+'/rest/v1/admin_postgrid_orders'+query,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:prefer},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 if(!r.ok){await r.body?.cancel();fail('Private mailing history could not be saved or loaded.',503);}const text=await r.text();return text?JSON.parse(text):[];
}
async function pg(env,path,options={}){
 const r=await fetch(API+path,{...options,headers:{'x-api-key':testKey(env),...options.headers},redirect:'manual',signal:AbortSignal.timeout(45000)});
 if(!r.ok){
  let data;try{data=await r.json();}catch{}
  let detail=typeof data?.error?.message==='string'?data.error.message:typeof data?.message==='string'?data.message:'';
  detail=detail.replaceAll(testKey(env),'[redacted]').replace(/(?:test|live)_sk_[A-Za-z0-9_-]+/gi,'[redacted]').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,600);
  const rejected=[400,422].includes(r.status),error=new MailError('PostGrid '+(rejected?'rejected the test request':'request failed')+' (HTTP '+r.status+').'+(detail?' '+detail:' Check the test dashboard for details.'),rejected?422:502);
  error.rejected=rejected;throw error;
 }return r.json();
}
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function orderView(row){return {id:row.id,listingKey:row.listing_key,property:row.property_address,recipient:row.recipient,sender:row.sender,printOptions:row.print_options,updatedAt:row.updated_at,deletedAt:row.deleted_at||null,pdfName:row.pdf_name,status:row.status,postgridId:row.postgrid_id,previewUrl:safeUrl(row.preview_url),createdAt:row.created_at,error:row.error,mode:'test'};}
async function update(env,id,values){return (await db(env,'?id=eq.'+encodeURIComponent(id),'PATCH',{...values,updated_at:new Date().toISOString()}))[0];}
async function create(body,env){
 testKey(env);if(body.mode&&body.mode!=='test')fail('Live sending is disabled.',403);if(body.confirmed!==true)fail('Review the recipient and PDF before creating a test order.');
 const to=contact(body.to),from=contact(body.from),bytes=pdfBytes(body.pdfBase64);
 if(typeof body.color!=='boolean'||typeof body.doubleSided!=='boolean')fail('Choose print options.');
 const options={color:body.color,doubleSided:body.doubleSided,addressPlacement:'insert_blank_page',size:'us_letter'};
 let subject;try{subject=await mailingSubject(body.reviewProof,env);}catch{fail('The property could not be reverified. Refresh the expired/terminated search before mailing.',409);}
 const digest=await hash(bytes),fingerprint=await hash(JSON.stringify(['test',subject.propertyIdentity,to,from,digest,options]));
 const prior=await db(env,'?fingerprint=eq.'+fingerprint+'&limit=1');if(prior.length&&prior[0].status!=='rejected'){const existing=prior[0].deleted_at?await update(env,prior[0].id,{deleted_at:null}):prior[0];return {ok:true,duplicate:true,order:orderView(existing)};}
 const id=prior[0]?.id||crypto.randomUUID(),pdfName=String(body.pdfName||'letter.pdf').replace(/[^a-zA-Z0-9 ._-]/g,'_').slice(0,120);
 const reserved=prior.length?await db(env,'?id=eq.'+encodeURIComponent(id)+'&status=eq.rejected','PATCH',{status:'submitting',error:null,deleted_at:null,updated_at:new Date().toISOString()}):await db(env,'?on_conflict=fingerprint','POST',{id,fingerprint,mode:'test',listing_key:subject.listingKey,property_address:subject.address,recipient:to,sender:from,pdf_name:pdfName,pdf_hash:digest,print_options:options,status:'submitting'},'resolution=ignore-duplicates,return=representation');
 if(!reserved.length){const existing=await db(env,'?fingerprint=eq.'+fingerprint+'&limit=1');return {ok:true,duplicate:true,order:orderView(existing[0])};}
 const form=new FormData();for(const [prefix,c]of [['to',to],['from',from]])for(const [k,v]of Object.entries(c))form.append(prefix+'['+k+']',v);
 for(const [k,v]of Object.entries(options))form.append(k,String(v));form.append('pdf',new Blob([bytes],{type:'application/pdf'}),pdfName);form.append('description','THM TEST '+id);form.append('metadata[thm_job_id]',id);form.append('metadata[thm_listing_key]',subject.listingKey);
 let order;
 try{order=await pg(env,'/letters',{method:'POST',headers:{'Idempotency-Key':id},body:form});if(order.live!==false||!/^letter_[A-Za-z0-9]+$/.test(order.id||''))fail('PostGrid returned an unexpected order. Check the dashboard.',502);}
 catch(error){await update(env,id,{status:error.rejected?'rejected':'needs_review',error:error.rejected?error.message:'Submission outcome needs checking in the PostGrid test dashboard. Automatic resubmission is blocked.'}).catch(()=>{});throw error;}
 const saved=await update(env,id,{postgrid_id:order.id,status:order.status||'ready',preview_url:safeUrl(order.url),error:null});return {ok:true,order:orderView(saved)};
}
export async function adminPostgrid(request,env){
 const expected=String(env.ADMIN_API_KEY||'');const a=await hash(request.headers.get('Authorization')||''),b=await hash('Bearer '+expected);let different=0;for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
 if(!expected||different)return json({ok:false,error:'Your admin key is missing or incorrect.'},401);
 if(request.method!=='POST')return json({ok:false,error:'Use the admin mailing panel.'},405);
 try{
  const body=await bodyOf(request),path=new URL(request.url).pathname;if(!body||typeof body!=='object'||Array.isArray(body))fail('Invalid request.');
  if(path.endsWith('/status')){testKey(env);await db(env,'?select=id&limit=1');await pg(env,'/letters?limit=1');return json({ok:true,mode:'test',connected:true,liveEnabled:false});}
  if(path.endsWith('/subject')){let s;try{s=await mailingSubject(body.reviewProof,env);}catch{fail('Refresh the search: this property could not be reverified.',409);}return json({ok:true,listingKey:s.listingKey,address:s.mailingAddress,reviewProof:s.reviewProof});}
  if(path.endsWith('/create'))return json(await create(body,env));
  if(path.endsWith('/history'))return json({ok:true,orders:(await db(env,'?mode=eq.test&deleted_at=is.null&order=created_at.desc&limit=100')).map(orderView)});
  if(path.endsWith('/delete')){
   if(body.confirmed!==true)fail('Confirm deletion from mailing history.');
   if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>100||body.ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)))fail('Choose up to 100 valid history records.');
   const ids=[...new Set(body.ids)],now=new Date().toISOString();
   const removed=await db(env,'?mode=eq.test&deleted_at=is.null&id=in.('+ids.join(',')+')&select=id','PATCH',{deleted_at:now,updated_at:now});
   return json({ok:true,deletedIds:removed.map(row=>row.id)});
  }
  if(path.endsWith('/refresh')){
   if(!/^[a-f0-9-]{36}$/.test(body.id||''))fail('Invalid order.');const rows=await db(env,'?id=eq.'+body.id+'&mode=eq.test&deleted_at=is.null&limit=1'),row=rows[0];if(!row)fail('Order not found.',404);
   if(!row.postgrid_id)return json({ok:true,order:orderView(row)});
   const letter=await pg(env,'/letters/'+encodeURIComponent(row.postgrid_id));if(letter.live!==false)fail('Expected a test order.',502);
   const saved=await update(env,row.id,{status:letter.status||row.status,preview_url:safeUrl(letter.url)||row.preview_url});return json({ok:true,order:orderView(saved)});
  }
  return json({ok:false,error:'Unknown mailing action.'},404);
 }catch(e){return json({ok:false,error:e instanceof MailError?e.message:'Mailing request could not finish. Check mailing history before retrying.'},e instanceof MailError?e.status:502);}
}
