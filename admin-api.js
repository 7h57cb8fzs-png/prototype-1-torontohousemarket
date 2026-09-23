// Protected operations only. No public routes, report generation or email sending.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEAD_SELECT='id,name,email,mobile,resolved_address,lead_mode,showing_requested,showing_timing,preferred_showing_at,confirmed_showing_at,status,stage,owner_agent_id,created_at,updated_at,archived_at,source,property_snapshot,metadata,agents(id,display_name),property_reports(id,status,generated_at,error_message),automation_jobs(id,job_type,status,attempts,available_at,created_at,updated_at,last_error)';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function adminOps(request,env){
 const supplied=request.headers.get('Authorization')||'',expected='Bearer '+env.ADMIN_API_KEY;
 if(!env.ADMIN_API_KEY||supplied.length!==expected.length||!constantEqual(supplied,expected))return json({ok:false,error:'Your admin key is missing or incorrect.'},401);
 if(!env.SUPABASE_SERVICE_ROLE_KEY)return json({ok:false,error:'Admin database connection is not configured.'},503);
 const url=new URL(request.url),path=url.pathname.replace('/api/admin/ops','');
 try{
  if(request.method==='GET'){
   if(path==='/counts')return json({ok:true,...await rpc(env,'admin_ops_counts',{})});
   if(path==='/agents')return json({ok:true,...await rpc(env,'admin_ops_agents',{})});
   if(path==='/analytics'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    if(!validDate(from)||!validDate(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>365)return json({ok:false,error:'Choose valid dates covering up to 366 days.'},400);
    return json({ok:true,...await rpc(env,'admin_ops_analytics',{p_from:from,p_to:to,p_include_tests:url.searchParams.get('tests')==='1'})});
   }
   if(path==='/marketing')return json({ok:true,...await rpc(env,'admin_ops_marketing_list',{p_page:Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page')))||1)),p_query:String(url.searchParams.get('q')||'').slice(0,120),p_status:String(url.searchParams.get('status')||'')})});
   if(path==='/leads'||path==='/jobs')return await list(request,env,path==='/jobs');
   if(/^\/leads\/[0-9a-f-]+$/i.test(path)){
    const id=path.split('/')[2];if(!UUID.test(id))return json({ok:false,error:'Invalid lead.'},400);
    const rows=await db(env,'leads?'+new URLSearchParams({id:'eq.'+id,select:LEAD_SELECT,limit:'1'}));
    if(rows[0]?.lead_mode==='seller')rows[0].seller_marketing=await rpc(env,'admin_seller_marketing_status',{p_lead_id:id});
    return rows[0]?json({ok:true,lead:rows[0]}):json({ok:false,error:'Lead not found.'},404);
   }
  }
  if(request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>100000)return json({ok:false,error:'Selection is too large.'},413);
   const body=await request.json().catch(()=>null);if(!body)return json({ok:false,error:'Invalid request.'},400);
   if(/^\/agents\/[0-9a-f-]+\/delete$/i.test(path)){
    const id=path.split('/')[2];if(!UUID.test(id))return json({ok:false,error:'Invalid agent.'},400);
    return json({ok:true,...await rpc(env,'admin_ops_delete_agent',{p_agent_id:id})});
   }
   if(path==='/leads/export'){
    if(!validIds(body.ids,UUID))return json({ok:false,error:'Choose 1–1000 leads to export.'},400);
    return json({ok:true,...await rpc(env,'admin_ops_export_leads',{p_ids:[...new Set(body.ids)]})});
   }
   if(path==='/leads/assign'){
    if(!validIds(body.ids,UUID)||!(body.agent_id===null||UUID.test(body.agent_id||'')))return json({ok:false,error:'Choose leads and an agent, or choose unassigned.'},400);
    return json({ok:true,...await rpc(env,'admin_ops_assign_leads',{p_ids:body.ids,p_agent_id:body.agent_id})});
   }
   if(path==='/marketing/unsubscribe'){
    if(typeof body.email!=='string'||body.email.length>254||!body.email.includes('@'))return json({ok:false,error:'Choose a marketing contact.'},400);
    return json({ok:true,unsubscribed:await rpc(env,'admin_ops_marketing_unsubscribe',{p_email:body.email})===true});
   }
   if(/^\/leads\/[0-9a-f-]+\/marketing-unsubscribe$/i.test(path)){
    const id=path.split('/')[2];if(!UUID.test(id))return json({ok:false,error:'Invalid lead.'},400);
    return json({ok:true,unsubscribed:await rpc(env,'admin_seller_marketing_unsubscribe',{p_lead_id:id})===true});
   }
   if(path==='/leads/bulk'){
    if(!validIds(body.ids,UUID)||!['archive','restore','delete'].includes(body.action))return json({ok:false,error:'Choose 1–1000 leads and an action.'},400);
    return json({ok:true,...await rpc(env,'admin_ops_lead_action',{p_ids:body.ids,p_action:body.action})});
   }
   if(path==='/jobs/cancel'){
    if(!validIds(body.ids,/^[0-9]{1,16}$/))return json({ok:false,error:'Choose 1–1000 jobs.'},400);
    return json({ok:true,...await rpc(env,'admin_ops_cancel_jobs',{p_ids:body.ids})});
   }
   if(path==='/agents'){
    const name=String(body.display_name||'').trim(),email=String(body.email||'').trim(),mobile=String(body.mobile||'').trim();
    if(name.length<2||name.length>120||email.length>254||mobile.length>50||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({ok:false,error:'Check the agent’s name and email address.'},400);
    const agent=await rpc(env,'admin_ops_create_agent',{p_name:name,p_email:email,p_mobile:mobile,p_active:body.active!==false});
    return json({ok:true,agent},201);
   }
  }
  return json({ok:false,error:'Admin operation not found.'},404);
 }catch(e){return json({ok:false,error:e.message||'Unable to complete this admin request.'},e.status||502);}
}
function constantEqual(a,b){let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function validIds(ids,re){return Array.isArray(ids)&&ids.length>0&&ids.length<=1000&&ids.every(x=>re.test(String(x)));}
async function rpc(env,name,body){return db(env,'rpc/'+name,{method:'POST',body:JSON.stringify(body)});}
async function db(env,path,init={},raw=false){
 const r=await fetch((env.SUPABASE_URL||'https://pwbtxyavjjotxtvegrqe.supabase.co')+'/rest/v1/'+path,{...init,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,...init.headers}});
 if(raw&&r.ok)return r;
 const body=await r.json().catch(()=>null);
 if(!r.ok){const error=new Error(body?.code==='P0001'?body.message:body?.code==='23505'?'This agent already exists or its order was just used. Refresh and try again.':'Unable to load or save this record. Please refresh and try again.');error.status=r.status===409||body?.code==='P0001'?409:502;throw error;}
 return body;
}
export function listParams(url,jobs){
 const p=url.searchParams,ids=p.get('ids')==='1',page=Math.max(1,Math.min(100000,Math.floor(Number(p.get('page')))||1)),size=[25,50,100].includes(Number(p.get('size')))?Number(p.get('size')):25;
 const params=new URLSearchParams({select:ids?'id':jobs?'id,lead_id,report_id,job_type,status,recipient,attempts,available_at,locked_at,completed_at,created_at,updated_at,last_error,delivery_event:payload->>delivery_event,leads!inner(id,name,email,resolved_address,archived_at)':LEAD_SELECT,order:'created_at.desc,id.desc',limit:String(ids?1001:size),offset:String(ids?0:(page-1)*size)});
 if(!jobs)params.set('archived_at',p.get('archive')==='1'?'not.is.null':'is.null');
 const q=String(p.get('q')||'').trim().slice(0,120).replace(/[(),%*"\\]/g,' ');
 if(q){const fields=jobs?['name','email','resolved_address']:['name','email','mobile','resolved_address'];params.set(jobs?'leads.or':'or','('+fields.map(f=>`${f}.ilike.*${q}*`).join(',')+')');if(jobs&&ids)params.set('select','id,leads!inner(id)');}
 const status=p.get('status');
 if(jobs){if(status==='attention')params.set('status','in.(queued,processing,failed,blocked)');else if(['queued','processing','failed','blocked','completed','sent','cancelled'].includes(status))params.set('status','eq.'+status);if(['generate_report','email_buyer','email_recipient','notify_agent'].includes(p.get('kind')))params.set('job_type','eq.'+p.get('kind'));}
 else{
  if(['new','contacted','appointment_pending','appointment_confirmed','closed','lost'].includes(status))params.set('status','eq.'+status);
  const kind=p.get('kind');if(kind==='seller')params.set('lead_mode','eq.seller');if(kind==='showing')params.set('showing_requested','eq.true');if(kind==='report'){params.set('lead_mode','neq.seller');params.set('showing_requested','eq.false');}
  const owner=p.get('agent');if(owner==='unassigned')params.set('owner_agent_id','is.null');else if(UUID.test(owner||''))params.set('owner_agent_id','eq.'+owner);
 }
 return {params,page,size,ids};
}
async function list(request,env,jobs){
 const {params,page,size,ids}=listParams(new URL(request.url),jobs);
 const r=await db(env,(jobs?'automation_jobs':'leads')+'?'+params,{headers:{Prefer:'count=exact'}},true),rows=await r.json(),total=Number(r.headers.get('content-range')?.split('/')[1]||rows.length);
 if(ids&&(total>1000||rows.length>1000||rows.length<total))return json({ok:false,error:'Too many matches to select safely. Narrow your filters to 1,000 or fewer records.'},400);
 return json({ok:true,...ids?{ids:rows.map(x=>String(x.id))}:{[jobs?'jobs':'leads']:rows},total,page,size});
}
