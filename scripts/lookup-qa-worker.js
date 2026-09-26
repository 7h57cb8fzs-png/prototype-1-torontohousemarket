import {loadPropertyForReport,sellerReportEmail,propertyReportEmail} from '../worker-v11.js';
import {buildVersion7Report} from '../worker-v12.js';
import {coreEnv} from '../worker-v22.js';
import {createReportRuntime,reportStage,runtimeSummary} from '../report-runtime.js';
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url||String(input));
  const method=String(init.method||input.method||'GET').toUpperCase();
  if(url.hostname.includes('resend')||(/supabase\.co$/.test(url.hostname)&&!['GET','HEAD'].includes(method)))throw Error('QA forbids email and database mutations');
  return nativeFetch(input,init);
};
const DB='https://pwbtxyavjjotxtvegrqe.supabase.co';
async function db(env,path){const r=await fetch(DB+'/rest/v1/'+path,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});if(!r.ok)throw Error('Read-only QA data unavailable');return r.json();}
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function address(r){return `${r.StreetNumber} ${r.StreetName}${r.StreetSuffix&&!/n\/?a/i.test(r.StreetSuffix)?' '+r.StreetSuffix:''}${r.StreetDirSuffix?' '+r.StreetDirSuffix:''}${r.UnitNumber?' Unit '+r.UnitNumber:''}, ${String(r.City||'').replace(/^Toronto\s+[CEW]\d{2}$/i,'Toronto')}`;}
export default {async fetch(request,env){
  const u=new URL(request.url);
  if(Date.now()>Number(env.THM_LOOKUP_QA_EXPIRES)||request.headers.get('Authorization')!=='Bearer '+env.THM_LOOKUP_QA_NONCE)return new Response('Not found',{status:404});
  try{
    if(u.pathname==='/baseline'&&request.method==='GET'){
      const reports=await db(env,"property_reports?select=id,created_at,report_payload&report_payload->>report_type=eq.THM%20Seller%20Price%20Perspective&order=created_at.desc&limit=13");
      const searches=await db(env,'analysis_sessions?select=property_input,resolved_address&limit=2000');
      return Response.json({reports,excluded:searches.map(r=>r.resolved_address||r.property_input)},{headers:{'Cache-Control':'no-store'}});
    }
    if(u.pathname==='/catalog'&&request.method==='GET'){
      const cities=['Toronto','Mississauga','Vaughan','Richmond Hill','Markham','Oakville','Brampton'];
      const index=Number(u.searchParams.get('city')),buyer=u.searchParams.get('mode')==='buyer';
      if(!Number.isInteger(index)||index<0||index>=cities.length)return new Response('Invalid city',{status:400});
      const base='https://query.ampre.ca/odata/Property',filter=`contains(City,'${cities[index]}')`;
      const headers={Authorization:'Bearer '+(buyer?env.AMPRE_TOKEN:env.AMPRE_VOW_TOKEN),Accept:'application/json'};
      const query=async p=>{const r=await fetch(base+'?'+new URLSearchParams(p).toString().replaceAll('+','%20'),{headers,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Catalog HTTP '+r.status+' '+JSON.stringify(p)+' '+(await r.text()).slice(0,350));return r.json();};
      const count=Number((await query({'$filter':filter,'$count':'true','$top':'1'}))['@odata.count']);
      const offsets=buyer?[0,100,200]:[Math.max(0,count-100),Math.max(0,count-300),Math.max(0,count-600)];
      const records=[];
      for(const skip of [...new Set(offsets)])records.push(...((await query({'$filter':filter,'$top':'100','$skip':String(skip)})).value||[]));
      const rows=records.filter(r=>r.ListingKey&&r.StreetNumber&&r.StreetName&&/Detached|Semi-Detached|Townhouse|Condo Apartment/i.test(r.PropertySubType||'')&&!/lease|rent/i.test(r.TransactionType||'')&&r.InternetEntireListingDisplayYN!==false&&r.InternetAddressDisplayYN!==false).filter(r=>buyer?/active|new/i.test(r.StandardStatus+' '+r.MlsStatus)&&!/sold|closed|terminat|expir|cancel/i.test(r.StandardStatus+' '+r.MlsStatus):/sold|closed|terminat|expir|cancel/i.test(r.StandardStatus+' '+r.MlsStatus));
      return Response.json({count,rows:rows.map(r=>({address:address(r),listingKey:r.ListingKey,city:r.City,type:r.PropertySubType,mode:buyer?'buyer':'seller'}))},{headers:{'Cache-Control':'no-store'}});
    }
    if(u.pathname!=='/run'||request.method!=='POST')return new Response('Not found',{status:404});
    const c=await request.json();if(!['buyer','seller'].includes(c.mode)||typeof c.address!=='string'||c.address.length>350||!/^\d/.test(c.address))return new Response('Invalid case',{status:400});
    const runtime=createReportRuntime({id:'lookup-qa-'+c.id,attempts:1},{totalMs:110000});
    const scoped={...coreEnv(env),THM_REPORT_RUNTIME:runtime,RESEND_API_KEY:null};
    const lead={lead_mode:c.mode,resolved_address:c.address,metadata:{property_input:c.address},property_snapshot:c.mode==='buyer'?{listingKey:c.listingKey}:{sellerProfile:{}}};
    let property,report,error;
    try{
      property=await reportStage(scoped,'mls_evidence',50000,e=>loadPropertyForReport(e,lead,'lookup-qa-'+c.id));
      report=await reportStage(scoped,'analysis',55000,e=>buildVersion7Report(e,lead,property,'lookup-qa-'+c.id));
    }catch(e){error=String(e?.message||e);}
    const rendered=report?(c.mode==='seller'?sellerReportEmail(c.address,report):propertyReportEmail(c.address,report)):null;
    return Response.json({case:c,report,error,telemetry:runtimeSummary(runtime),diagnostics:property?.sellerEvidence?.diagnostics||property?.comparableContext?.diagnostics||null,html:rendered?.html||null,text:rendered?.text||null},{headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
  }catch(e){return Response.json({error:String(e?.message||e)},{status:500,headers:{'Cache-Control':'no-store'}});}
}};
