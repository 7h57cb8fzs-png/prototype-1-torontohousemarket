import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminOps} from '../admin-api.js';
import {activityChart} from '../admin-insights.js';
import {leadExportRecord,leadsCSV,leadsJSON,leadsVCards,leadsPrintHTML} from '../admin-exports.js';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',agentId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const env={ADMIN_API_KEY:'synthetic-test-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_URL:'https://synthetic.invalid'};
const request=(path,body,key=env.ADMIN_API_KEY)=>new Request('https://test.invalid/api/admin/ops'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...body?{body:JSON.stringify(body)}:{}});
async function stub(handler,run){const old=globalThis.fetch;globalThis.fetch=handler;try{await run();}finally{globalThis.fetch=old;}}
const lead={id,name:'=Formula Test',email:'synthetic@example.com',mobile:'+14165550199',lead_mode:'seller',status:'new',resolved_address:'Synthetic property',created_at:'2026-09-23T14:00:00Z',archived_at:null,owner_agent_id:null,property_snapshot:{sellerProfile:{targetMin:950000,targetMax:1150000,renovationPct:0,beds:3,kitchens:0,notes:'Line one\nLine two',ownerConsent:true,contactConsent:true}},seller_marketing:{consented:true,suppressedAt:'2026-09-23T15:00:00Z',wording:'Permission wording',emailStatus:'suppressed'},report:{status:'ready',valuation:{low:900000,midpoint:1000000,high:1100000}},property_reports:[{status:'ready'}],automation_jobs:[]};

test('1. Agent deletion and assignment require admin access and use protected explicit-ID operations',async()=>{
 let calls=[];await stub(async(url,init)=>{calls.push([String(url),JSON.parse(init.body)]);return Response.json({deleted:true,results:[{id,ok:true}]});},async()=>{
  assert.equal((await adminOps(request('/agents/'+agentId+'/delete',{},'wrong'),env)).status,401);assert.equal(calls.length,0);
  assert.equal((await adminOps(request('/leads/assign',{ids:['*'],agent_id:agentId}),env)).status,400);assert.equal(calls.length,0);
  assert.equal((await adminOps(request('/agents/'+agentId+'/delete',{}),env)).status,200);assert(calls[0][0].endsWith('/rpc/admin_ops_delete_agent'));assert.deepEqual(calls[0][1],{p_agent_id:agentId});
  await adminOps(request('/leads/assign',{ids:[id],agent_id:null}),env);assert.deepEqual(calls[1][1],{p_ids:[id],p_agent_id:null});
 });
});

test('2. Statistics validate calendar ranges, preserve zero activity and do not invent sharing metrics',async()=>{
 let body;await stub(async(url,init)=>{assert(String(url).endsWith('/rpc/admin_ops_analytics'));body=JSON.parse(init.body);return Response.json({totals:{leads:0},daily:[{day:'2026-03-08',leads:0}],tracking:{shares:false}});},async()=>{
  assert.equal((await adminOps(request('/analytics?from=2026-02-30&to=2026-03-08'),env)).status,400);
  assert.equal((await adminOps(request('/analytics?from=2024-01-01&to=2026-03-08'),env)).status,400);
  const d=await(await adminOps(request('/analytics?from=2026-03-08&to=2026-03-08'),env)).json();assert.equal(d.totals.leads,0);assert.equal(d.tracking.shares,false);assert.equal(body.p_include_tests,false);
  const svg=activityChart(d.daily);assert(!svg.includes('NaN'));assert(!svg.includes('Infinity'));assert(svg.includes('height="0"'));assert(svg.includes('2026-03-08'));
 });
});

test('3. Marketing reflects the separate consent queue and unsubscribe never changes report jobs',async()=>{
 await stub(async(url,init)=>{assert(String(url).endsWith('/rpc/admin_ops_marketing_unsubscribe'));assert.deepEqual(JSON.parse(init.body),{p_email:'synthetic@example.com'});return Response.json(true);},async()=>{
  const d=await(await adminOps(request('/marketing/unsubscribe',{email:'synthetic@example.com'}),env)).json();assert.equal(d.unsubscribed,true);
 });
 const worker=readFileSync(new URL('../worker-v22.js',import.meta.url),'utf8');assert(worker.includes('processSellerMarketing'));const markup=readFileSync(new URL('../seller.html',import.meta.url),'utf8');assert.equal((markup.match(/type="checkbox"/g)||[]).length,2);assert(!/id="sellerMarketingConsent"[^>]*\bchecked\b/.test(markup));
 const email=readFileSync(new URL('../worker-v11.js',import.meta.url),'utf8');assert(email.includes('Your expected range'));assert(email.includes('Owner-reported renovation context:'));
});

test('4. CSV, JSON, vCard and printable exports retain min/max, zero renovation, consent and safe text',async()=>{
 const record=leadExportRecord(lead);assert.equal(record['Seller Minimum CAD'],950000);assert.equal(record['Seller Maximum CAD'],1150000);assert.equal(record['Renovation Percent'],0);assert.equal(record['Kitchens'],0);assert.equal(record['Marketing Consent'],'Unsubscribed');
 const csv=leadsCSV([lead]);assert(csv.startsWith('\ufeff'));assert(csv.includes('"\'=Formula Test"'));assert(csv.includes('"\'+14165550199"'));assert(csv.includes('Line one\nLine two'));
 const json=JSON.parse(leadsJSON([lead]));assert.equal(json.leads[0].seller_marketing.suppressedAt,lead.seller_marketing.suppressedAt);
 const card=leadsVCards([{...lead,name:'نام طولانی '.repeat(15)+'\nEND:VCARD'}]);assert.equal(card.split('\r\n').filter(x=>x==='END:VCARD').length,1);assert(card.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
 const html=leadsPrintHTML([{...lead,name:'<script>alert(1)</script>'}]);assert(!html.includes('<script>'));assert(html.includes('$950,000'));assert(html.includes('0%'));assert(html.includes('Unsubscribed'));
 await stub(async(url,init)=>{assert(String(url).endsWith('/rpc/admin_ops_export_leads'));assert.deepEqual(JSON.parse(init.body),{p_ids:[id]});return Response.json({leads:[lead]});},async()=>{assert.equal((await adminOps(request('/leads/export',{ids:[id,id]}),env)).status,200);});
});

test('5. Admin screens connect overview, marketing, exports, agent deletion and manual bulk assignment',async()=>{
 const {JSDOM}=await import(process.env.ADMIN_TEST_JSDOM_PATH||'jsdom');
 const dom=new JSDOM(readFileSync(new URL('../admin.html',import.meta.url),'utf8'),{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const agents=[{id:agentId,display_name:'Synthetic Agent',email:'agent@example.com',active:true,assigned_leads:0}];const calls=[];let downloaded=false;
 w.Response=Response;w.TextEncoder=TextEncoder;w.URL.createObjectURL=()=>{downloaded=true;return 'blob:synthetic';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path,init={})=>{const u=new URL(path,'https://synthetic.invalid'),b=init.body?JSON.parse(init.body):null;calls.push([u.pathname,b]);let data={ok:true};
  if(u.pathname.endsWith('/ops/agents'))data={...data,agents,assignmentMethod:'manual'};
  else if(u.pathname.endsWith('/settings'))data.settings={};
  else if(u.pathname.endsWith('/counts'))data={...data,active:1,archived:0,queue:{}};
  else if(u.pathname.endsWith('/ops/leads'))data={...data,leads:[lead],total:1};
  else if(u.pathname.endsWith('/analytics'))data={...data,from:'2026-09-01',to:'2026-09-23',totals:{leads:1,reports:1,emails:0,opt_ins:1,marketing:0},daily:[{day:'2026-09-23',leads:1,reports:1,emails:0,opt_ins:1,marketing:0}],types:[{label:'Seller reports',value:1}],sources:[],assignmentMethod:'manual',unassigned:1};
  else if(u.pathname.endsWith('/marketing'))data={...data,summary:{opted_in:1},contacts:[{email:lead.email,name:lead.name,lead_id:id,lead_available:true,consent_at:lead.created_at,status:'queued'}],total:1};
  else if(u.pathname.endsWith('/leads/export'))data.leads=[lead];
  else if(u.pathname.endsWith('/leads/assign')){lead.owner_agent_id=b.agent_id;data.results=[{id,ok:true}];}
  else if(u.pathname.endsWith('/delete')){agents.splice(0,1);data.deleted=true;}
  else if(u.pathname.includes('/ops/leads/'))data.lead=lead;
  else if(u.pathname.endsWith('/reports'))data=u.searchParams.has('copy')?{ok:true,copy:{report:{seller:{profile:lead.property_snapshot.sellerProfile},valuation:lead.report.valuation},html:'<p>Saved report</p>'}}:{ok:true,copies:[],current:{id:'current',status:'ready'}};
  return Response.json(data);
 };
 const files=['admin-view-model.js','admin-exports.js','admin-insights.js','admin-workspace.js'];
 const code=files.map(f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 await w.eval('(async()=>{'+code+"\nstate.token='synthetic-test';await loadSetup();$('login').hidden=true;$('workspace').hidden=false;await changeView('leads');})()");
 const wait=async check=>{for(let i=0;i<30;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert(check(),'Expected admin screen state');};
 const click=id=>d.getElementById(id).click(),nav=async view=>{d.querySelector('[data-view='+view+']').click();await new Promise(r=>setTimeout(r,15));};
 await nav('overview');assert(d.querySelector('#activityPlot svg'));assert(d.getElementById('insightContent').textContent.includes('not currently tracked'));
 await nav('marketing');assert.equal(d.querySelectorAll('#marketingRows tr').length,1);assert(d.getElementById('marketingView').textContent.includes('Selling Strategy'));
 await nav('leads');click('selectPage');click('bulkExport');click('exportRun');await wait(()=>downloaded);assert(calls.some(x=>x[0].endsWith('/leads/export')));
 click('bulkAssign');d.getElementById('assignAgent').value=agentId;click('assignRun');await wait(()=>d.getElementById('notice').textContent.includes('1 lead updated'));
 d.querySelector('[data-open]').click();await wait(()=>d.getElementById('detailTitle').textContent==='Synthetic property');d.querySelector('[data-detail-tab=report]').click();await wait(()=>d.querySelector('.report-owner-inputs'));assert(d.getElementById('reportSummary').textContent.includes('$950,000'));assert(d.getElementById('reportSummary').textContent.includes('0%'));
 d.querySelector('[data-close=detailDialog]').click();await nav('agents');d.querySelector('[data-delete-agent]').click();assert(d.getElementById('confirmTitle').textContent.includes('Delete Synthetic Agent'));click('confirmAction');await wait(()=>!d.getElementById('confirmDialog').open);assert.equal(agents.length,0);
 click('signOut');assert.equal(d.getElementById('insightContent').textContent,'');assert.equal(d.getElementById('marketingRows').textContent,'');w.close();
});
