import test from 'node:test';
import assert from 'node:assert/strict';
import {externalSourceUrl,groundedListingLeads,researchExternalComparables,externalResearchHtml} from '../external-comp-research.js';
import {soldCandidates,buildVersion7Report,normalizeExpertResult} from '../worker-v12.js';
import {coreEnv} from '../worker-v22.js';
import {createReportRuntime,reportStage,remainingReportMs} from '../report-runtime.js';
import {sellerReportEmail,propertyReportEmail} from '../worker-v11.js';

const date=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
const property={address:'101 Example Avenue, Toronto',city:'Toronto',cityRegion:'Example',postalCode:'M1A 1A1',propertyType:'Residential Freehold',propertySubType:'Detached',beds:3,baths:2,livingAreaRange:'1500-2000',sellerProfile:{},sellerEvidence:{subjectMatched:true,listingMatched:true},comparableContext:{available:false,comparables:[]}};
const rows=[2,3,4].map(n=>({ListingKey:'C0000000'+n,UnparsedAddress:`${100+n} Example Avenue, Toronto`,StreetNumber:String(100+n),StreetName:'Example',StreetSuffix:'Avenue',City:'Toronto',CityRegion:'Example',PostalCode:'M1A 1A1',PropertyType:'Residential Freehold',PropertySubType:'Detached',StandardStatus:'Closed',MlsStatus:'Sold',TransactionType:'For Sale',PurchaseContractDate:date,ClosePrice:1000000+n*10000,BedroomsTotal:3,BathroomsTotalInteger:2,LivingAreaRange:'1500-2000'}));
const leads=rows.map(r=>({mlsNumber:r.ListingKey,address:r.UnparsedAddress,sourceUrl:'https://broker.example.ca/listing/'+r.ListingKey}));
const response=(list=leads)=>({status:'completed',model:'gpt-5.6-luna',id:'test-response',usage:{total_tokens:12},output:[{type:'web_search_call',status:'completed',action:{sources:leads.map(c=>({url:c.sourceUrl}))}},{type:'message',content:[{type:'output_text',text:JSON.stringify({listings:list})}]}]});
const options={eligibleSales:rs=>soldCandidates(property,rs),matchesAddress:(address,row)=>address===row.UnparsedAddress};
const env=()=>coreEnv({OPENAI_API_KEY:'synthetic',AMPRE_VOW_TOKEN:'synthetic',THM_REPORT_RUNTIME:createReportRuntime({id:'synthetic',attempts:1})});

test('only actual search-supported listing URLs and valid MLS identities survive',()=>{
  assert.equal(groundedListingLeads(response()).length,3);
  assert.equal(groundedListingLeads({...response(),output:response().output.slice(1)}).length,0);
  assert.equal(groundedListingLeads(response([{...leads[0],sourceUrl:'https://fabricated.ca/sale'},leads[1],leads[1]])).length,1);
  assert.equal(groundedListingLeads({...response(),status:'incomplete'}).length,0);
  for(const url of ['javascript:alert(1)','http://broker.ca/a','https://127.0.0.1/a','https://[::1]/','https://localhost/a','https://foo.internal/a','https://user:secret@broker.ca/','https://torontohousemarket.com/a'])assert.equal(externalSourceUrl(url),null,url);
});

test('outside lookup forces Luna web search and uses only licensed sold prices',async t=>{
  const e=env();let searches=0;
  t.mock.method(globalThis,'fetch',async(url,init={})=>{
    if(String(url).includes('api.openai.com')){searches++;const body=JSON.parse(init.body);assert.equal(body.model,'gpt-5.6-luna');assert.equal(body.tool_choice,'required');assert.equal(body.store,false);assert.equal(body.max_tool_calls,3);return Response.json(response(leads.map(c=>({...c,soldPrice:9000000}))));}
    assert.match(String(url),/^https:\/\/query\.ampre\.ca\/odata\/Property\('[A-Z]\d+'\)$/);
    return Response.json(rows.find(r=>String(url).includes(r.ListingKey)));
  });
  const result=await researchExternalComparables(e,property,options);
  assert.equal(searches,1);assert.equal(result.research.verified_count,3);assert.equal(result.comparables[0].soldPrice,rows[0].ClosePrice);assert.equal(e.THM_REPORT_RUNTIME.rawRows.size,3);assert.equal(e.THM_REPORT_RUNTIME.aiUsage[0].web_search_calls,1);
});

test('active, stale, mismatched and private records cannot become comparables',async t=>{
  let current=rows[0];
  t.mock.method(globalThis,'fetch',async url=>String(url).includes('api.openai.com')?Response.json(response([leads[0]])):Response.json(current));
  for(const change of [{MlsStatus:'Active',StandardStatus:'Active'},{PurchaseContractDate:'2001-01-01'},{PurchaseContractDate:'2099-01-01'},{PropertySubType:'Semi-Detached'},{CityRegion:'Different',PostalCode:'M9Z 9Z9'},{UnparsedAddress:'Wrong address'},{InternetEntireListingDisplayYN:false}]){
    current={...rows[0],...change};const result=await researchExternalComparables(env(),property,options);assert.equal(result.comparables.length,0,JSON.stringify(change));
  }
});

test('verification errors preserve research leads without creating a sale or price',async t=>{
  t.mock.method(globalThis,'fetch',async url=>String(url).includes('api.openai.com')?Response.json(response()):new Response('',{status:404}));
  const result=await researchExternalComparables(env(),property,options);
  assert.equal(result.comparables.length,0);assert.equal(result.research.candidates.length,3);assert.equal(result.research.candidates[0].status,'not_in_feed');assert(!JSON.stringify(result.research).includes('soldPrice'));
});

test('multiple MLS listings of one home cannot manufacture sufficient sale evidence',()=>{
  const candidates=[{id:'C00000002',address:'102 Example Avenue, Toronto',city:'Toronto',soldPrice:1000000},{id:'C00000003',address:'102 Example Ave, Toronto',city:'Toronto',soldPrice:1100000}];
  const result=normalizeExpertResult({comparables:candidates.map(c=>({id:c.id,adjusted_indication:c.soldPrice}))},candidates,'ampre_vow');
  assert.equal(result.comparables.length,1);
});

test('API and budget failures are explicit and do not fail the report',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:429}));
  assert.equal((await researchExternalComparables(env(),property,options)).research.reason,'api_http_429');
  const e=env();e.THM_REPORT_RUNTIME.deadline=Date.now()+100;
  assert.equal((await researchExternalComparables(e,property,options)).research.attempted,false);
  assert.equal((await researchExternalComparables({},property,options)).research.reason,'api_not_configured');
  await reportStage(env(),'bounded',1000,async e=>assert(remainingReportMs(e)<=1000));
});

test('seller and buyer reports recover three sales, retain citations, and never send mail',async t=>{
  t.mock.method(globalThis,'fetch',async(url,init={})=>{
    if(String(url).includes('query.ampre.ca'))return Response.json(rows.find(r=>String(url).includes(r.ListingKey))||{value:[]});
    assert.match(String(url),/^https:\/\/api\.openai\.com\//,'No email, archive or database request');
    const body=JSON.parse(init.body),name=body.text.format.name;
    if(name==='thm_external_listing_lookup')return Response.json(response());
    if(name==='thm_expert_comps')return Response.json({output_text:JSON.stringify({confidence:'Limited',market_read:'Recent local sales.',comparables:rows.map(r=>({id:r.ListingKey,adjusted_indication:r.ClosePrice,selection_reason:'Same community and home type.',adjustment_reason:'No price adjustment.',adjustment_basis:'none'}))})});
    return Response.json({output_text:'{}'});
  });
  for(const mode of ['seller','buyer']){
    const report=await buildVersion7Report(env(),{lead_mode:mode,resolved_address:property.address},property,'test');
    assert.equal(report.external_research.verified_count,3);assert.equal(report.comparables.length,3);assert.equal(report.valuation.available,true);
    assert(report.comparables.every(c=>c.evidenceSource==='ampre_vow'&&c.discoverySource==='luna_web_search'));
    const rendered=mode==='seller'?sellerReportEmail(property.address,report):propertyReportEmail(property.address,{},report);
    assert.match(rendered.html,/Outside-source search|OUTSIDE-SOURCE SEARCH/);assert(rendered.html.includes(leads[0].sourceUrl));assert(rendered.text.includes(leads[0].sourceUrl));
  }
});

test('unmatched seller still gets outside research, without invented home facts or valuation',async t=>{
  let count=0;
  t.mock.method(globalThis,'fetch',async url=>{if(String(url).includes('api.openai.com')){count++;return Response.json(response());}return new Response('',{status:404});});
  const report=await buildVersion7Report(env(),{lead_mode:'seller'}, {...property,sellerEvidence:{subjectMatched:false},propertySubType:null},'unmatched');
  assert.equal(count,1);assert.equal(report.external_research.candidates.length,3);assert.equal(report.valuation.available,false);assert.equal(report.facts.property_type,null);
  assert.equal(coreEnv({OPENAI_EXTERNAL_COMP_SEARCH:'false'}).OPENAI_EXTERNAL_COMP_SEARCH,'false');
  const html=externalResearchHtml({...report.external_research,candidates:[{...leads[0],address:'<script>bad</script>'}]});assert(!html.includes('<script>'));
});

test('sufficient comparable reports avoid a paid outside search',async t=>{
  let webCalls=0;
  t.mock.method(globalThis,'fetch',async(url,init={})=>{const body=JSON.parse(init.body);if(body.tools)webCalls++;return Response.json({output_text:'{}'});});
  const comps=rows.map(r=>({listingKey:r.ListingKey,address:r.UnparsedAddress,propertySubType:r.PropertySubType,soldPrice:r.ClosePrice,soldDate:date}));
  const complete={...property,comparableContext:{available:true,comparables:comps,rangeLow:1000000,midpoint:1030000,rangeHigh:1100000,confidence:'High'}};
  const report=await buildVersion7Report(env(),{lead_mode:'seller'},complete,'enough');
  assert.equal(webCalls,0);assert.equal(report.external_research,undefined);assert.equal(report.valuation.available,true);
});
