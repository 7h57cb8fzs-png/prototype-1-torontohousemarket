import {loadPropertyForReport,sellerReportEmail,propertyReportEmail} from '../worker-v11.js';
import {buildVersion7Report} from '../worker-v12.js';
import {coreEnv} from '../worker-v22.js';
import {createReportRuntime,reportFetch,reportStage,runtimeSummary} from '../report-runtime.js';
const native=globalThis.fetch;
globalThis.fetch=(input,init={})=>{
  const url=new URL(String(input)),method=String(init.method||'GET').toUpperCase();
  if(url.hostname.includes('resend')||(/supabase\.co$/.test(url.hostname)&&!['GET','HEAD'].includes(method)))throw Error('QA forbids emails and database writes');
  return native(input,init);
};
function address(r){return `${r.StreetNumber} ${r.StreetName}${r.StreetSuffix&&!/n\/?a/i.test(r.StreetSuffix)?' '+r.StreetSuffix:''}${r.StreetDirSuffix?' '+r.StreetDirSuffix:''}${r.UnitNumber?' Unit '+r.UnitNumber:''}, ${String(r.City||'').replace(/^Toronto\s+[CEW]\d{2}$/i,'Toronto')}`;}
export default {async fetch(request,env){
  const u=new URL(request.url);
  if(Date.now()>Number(env.THM_LOOKUP_QA_EXPIRES)||request.headers.get('Authorization')!=='Bearer '+env.THM_LOOKUP_QA_NONCE)return new Response('Not found',{status:404});
  if(u.pathname==='/prior'&&request.method==='GET'){
    const addresses=[];
    for(let offset=0;offset<10000;offset+=1000){
      const r=await fetch('https://pwbtxyavjjotxtvegrqe.supabase.co/rest/v1/analysis_sessions?select=property_input,resolved_address&order=created_at.asc&limit=1000&offset='+offset,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
      if(!r.ok)throw Error('Prior-search exclusion unavailable');const rows=await r.json();addresses.push(...rows.flatMap(x=>[x.resolved_address,x.property_input]).filter(Boolean));if(rows.length<1000)return Response.json({addresses},{headers:{'Cache-Control':'no-store'}});
    }
    throw Error('Prior-search exclusions incomplete');
  }
    if(u.pathname==='/catalog'&&request.method==='GET'){
      const cities=['Toronto','Mississauga','Vaughan','Richmond Hill','Markham','Oakville','Brampton'];
      const index=Number(u.searchParams.get('city')),buyer=u.searchParams.get('mode')==='buyer';
      if(!Number.isInteger(index)||index<0||index>=cities.length)return new Response('Invalid city',{status:400});
      const communities=['Waterfront','Lakeview','Maple','Crosby','Unionville','Bronte','Brampton'];
      const base='https://query.ampre.ca/odata/Property',filter=`contains(City,'${cities[index]}') and contains(CityRegion,'${communities[index]}')`;
      const headers={Authorization:'Bearer '+(buyer?env.AMPRE_TOKEN:env.AMPRE_VOW_TOKEN),Accept:'application/json'};
      const query=async p=>{const r=await fetch(base+'?'+new URLSearchParams(p).toString().replaceAll('+','%20'),{headers,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Catalog HTTP '+r.status+' '+JSON.stringify(p)+' '+(await r.text()).slice(0,350));return r.json();};
      const count=Number((await query({'$filter':filter,'$count':'true','$top':'1'}))['@odata.count']);
      const bounded=Math.min(count,100000);
      const offsets=buyer?[0,100,200]:[Math.max(0,bounded-100),Math.max(0,bounded-300),Math.max(0,bounded-600)];
      const records=[];
      for(const skip of [...new Set(offsets)])records.push(...((await query({'$filter':filter,'$top':'100','$skip':String(skip)})).value||[]));
      const rows=records.filter(r=>r.ListingKey&&r.StreetNumber&&r.StreetName&&/Detached|Semi-Detached|Townhouse|Condo Apartment/i.test(r.PropertySubType||'')&&!/lease|rent/i.test(r.TransactionType||'')&&r.InternetEntireListingDisplayYN!==false&&r.InternetAddressDisplayYN!==false).filter(r=>buyer?/active|new/i.test(r.StandardStatus+' '+r.MlsStatus)&&!/sold|closed|terminat|expir|cancel/i.test(r.StandardStatus+' '+r.MlsStatus):/sold|closed|terminat|expir|cancel/i.test(r.StandardStatus+' '+r.MlsStatus));
      return Response.json({count,rows:rows.map(r=>({address:address(r),listingKey:r.ListingKey,city:r.City,type:r.PropertySubType,mode:buyer?'buyer':'seller'}))},{headers:{'Cache-Control':'no-store'}});
    }
    if(u.pathname!=='/run'||request.method!=='POST')return new Response('Not found',{status:404});
  const c=await request.json();
  if(!['buyer','seller'].includes(c.mode)||typeof c.address!=='string'||c.address.length>250)return new Response('Invalid',{status:400});
  const runtime=createReportRuntime({id:'external-qa-'+c.id,attempts:1});
  runtime.fetch=(e,input,init,lifecycle)=>c.skipArchive&&String(input).includes('/seller_subject_archives')?Promise.resolve(Response.json([])):reportFetch(e,input,init,lifecycle);
  const scoped={...coreEnv(env),THM_REPORT_RUNTIME:runtime,RESEND_API_KEY:null};
  const lead={lead_mode:c.mode,resolved_address:c.address,metadata:{property_input:c.address},property_snapshot:c.mode==='seller'?{sellerProfile:{}}:{}};
  let property,report,error,rendered;
  try{
    property=await reportStage(scoped,'mls_evidence',50000,e=>loadPropertyForReport(e,lead,'external-qa-'+c.id));
    if(c.forceFallback){property.comparableContext={...property.comparableContext,available:false,comparables:[],rangeLow:null,midpoint:null,rangeHigh:null};runtime.rawRows.clear();runtime.completedFilters.clear();runtime.queryCache.clear();}
    report=await reportStage(scoped,'analysis',scoped.OPENAI_EXTERNAL_COMP_SEARCH==='true'?95000:55000,e=>buildVersion7Report(e,lead,property,'external-qa-'+c.id));
    rendered=c.mode==='seller'?sellerReportEmail(c.address,report):propertyReportEmail(c.address,{},report);
  }catch(e){error=String(e?.message||e);}
  return Response.json({case:c,report,error,telemetry:runtimeSummary(runtime),html:rendered?.html,text:rendered?.text},{headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
}};
