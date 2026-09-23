import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {marketingConsent,marketingMessage,deliverSellerMarketing,processSellerMarketing,marketingUnsubscribe,MARKETING_SUBJECT} from '../seller-marketing.js';
import {validateSellerProfile} from '../worker-v11.js';
import {adminOps} from '../admin-api.js';
const token='11111111-2222-4333-8444-555555555555',id='66666666-7777-4888-8999-000000000000';
const env={SUPABASE_SERVICE_ROLE_KEY:'test-only',RESEND_API_KEY:'test-only',ADMIN_API_KEY:'test-admin'};
const job={id,attempts:1,email:'seller@example.invalid',unsubscribe_token:token};
const profile={homeType:'unknown',city:'',community:'',sizeBand:'unknown',beds:null,belowBeds:null,basement:'unknown',entrance:'unknown',kitchens:null,postal:'',condition:'unknown',upgrades:[],timing:'exploring',ownerConsent:true,contactConsent:true};

test('only an explicit boolean opt-in produces server-stamped marketing permission',()=>{
 for(const v of [undefined,null,false,'true',1,{}]) assert.deepEqual(marketingConsent(v),{marketingConsent:false});
 const yes=validateSellerProfile({...profile,marketingConsent:true,marketingConsentVersion:'forged',marketingConsentAt:'1900-01-01'});
 assert.equal(yes.marketingConsent,true);assert.equal(yes.marketingConsentVersion,'seller-strategy-fees-2026-09-23');assert.ok(Date.parse(yes.marketingConsentAt)>Date.now()-10000);
 assert.equal(validateSellerProfile(profile).marketingConsent,false);
 assert.equal(validateSellerProfile({...profile,marketingConsent:'true'}).marketingConsent,false);
});

test('form keeps required report permissions and leaves marketing optional and unchecked',()=>{
 const html=readFileSync(new URL('../seller.html',import.meta.url),'utf8');
 const input=html.match(/<input id="sellerMarketingConsent"[^>]*>/)[0];
 assert.doesNotMatch(input,/\brequired\b|\bchecked\b/);assert.match(input,/aria-describedby="sellerMarketingFooter"/);
 assert.equal((html.match(/type="checkbox"/g)||[]).length,2);
 for(const key of ['sellerOwnerConsent'])assert.match(html,new RegExp('<input id="'+key+'"[^>]*required'));
 assert.match(html,/id="sellerMarketingFooter"/);assert.match(html,/1053 McNicoll Avenue/);
});

test('approved email has THM identity, concise subject, online strategy and exactly one PDF',()=>{
 const m=marketingMessage(job,env);assert.equal(m.subject,MARKETING_SUBJECT);assert.equal(m.from,'Toronto House Market <notifications@updates.torontohousemarket.com>');assert.equal(m.reply_to,'torontohousemarket@gmail.com');
 assert.equal(m.attachments.length,1);assert.match(m.attachments[0].path,/THM-Selling-Plan-and-Fees-v1\.pdf$/);
 assert.match(m.html,/thm-team-v1\.png/);assert.doesNotMatch(m.html,/cid:|\{\{UNSUBSCRIBE/);
 assert.match(m.html,/THM tools, social promotion and email marketing/);assert.match(m.html,/Alireza &amp; Mehrdad Golestan Habibi/);
 assert.equal(m.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.ok(m.headers['List-Unsubscribe'].includes(token));
 assert.throws(()=>marketingMessage({...job,unsubscribe_token:'<script>'},env));
});

test('suppression or lost lease blocks provider sending',async t=>{
 t.mock.method(globalThis,'fetch',async (url)=>{assert.ok(String(url).endsWith('/prepare_seller_marketing_send'));return Response.json(false);});
 assert.deepEqual(await deliverSellerMarketing(env,job),{skipped:true});
});

test('provider acceptance is acknowledged again without resending after a database timeout',async t=>{
 let sends=0,completions=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).endsWith('/prepare_seller_marketing_send'))return Response.json(true);
  if(String(url)==='https://api.resend.com/emails'){sends++;assert.equal(init.headers['Idempotency-Key'],`thm-seller-marketing-${id}-v1`);return Response.json({id:'accepted'});}
  if(String(url).endsWith('/complete_seller_marketing_send')){if(++completions===1)throw Error('connection reset');return Response.json(null);}
  throw Error('Unexpected route');
 });
 await deliverSellerMarketing(env,job);assert.equal(sends,1);assert.equal(completions,2);
});

test('retry keeps the frozen email unchanged and has a stable provider key',async t=>{
 const frozen={...marketingMessage(job,env),subject:'Previously frozen approved subject'};
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const body=JSON.parse(init.body);
  if(String(url).endsWith('/prepare_seller_marketing_send')){assert.deepEqual(body.p_message,frozen);return Response.json(true);}
  if(String(url)==='https://api.resend.com/emails'){assert.deepEqual(body,frozen);assert.equal(init.headers['Idempotency-Key'],`thm-seller-marketing-${id}-v1`);return Response.json({id:'same-send'});}
  return Response.json(null);
 });
 await deliverSellerMarketing(env,{...job,attempts:2,frozen_email:frozen});
});

test('a failed marketing send is isolated and queued for a bounded retry',async t=>{
 let failed=0;
 t.mock.method(globalThis,'fetch',async(url)=>{
  if(String(url).endsWith('/claim_seller_marketing_jobs'))return Response.json([job]);
  if(String(url).endsWith('/prepare_seller_marketing_send'))return Response.json(true);
  if(String(url)==='https://api.resend.com/emails')return Response.json({error:'busy'},{status:429});
  if(String(url).endsWith('/fail_seller_marketing_send')){failed++;return Response.json(null);}
  throw Error('Unexpected route');
 });
 await processSellerMarketing(env);assert.equal(failed,1);
});

test('email scanners cannot unsubscribe with GET; POST handles one-click and invalid tokens safely',async t=>{
 let writes=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{writes++;assert.ok(String(url).endsWith('/unsubscribe_seller_marketing'));assert.deepEqual(JSON.parse(init.body),{p_token:token});return Response.json(true);});
 const url='https://torontohousemarket.com/api/marketing/unsubscribe?token='+token;
 let r=await marketingUnsubscribe(new Request(url),env);assert.equal(writes,0);assert.match(await r.text(),/method="post"/);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');
 r=await marketingUnsubscribe(new Request(url,{method:'POST',body:'List-Unsubscribe=One-Click'}),env);assert.equal(writes,1);assert.match(await r.text(),/You’re unsubscribed/);
 r=await marketingUnsubscribe(new Request(url.replace(token,'bad'),{method:'POST'}),env);assert.equal(r.status,400);assert.equal(writes,1);
});

test('admin unsubscribe endpoint requires existing admin authorization',async t=>{
 const u='https://torontohousemarket.com/api/admin/ops/leads/'+id+'/marketing-unsubscribe';
 assert.equal((await adminOps(new Request(u,{method:'POST',body:'{}'}),env)).status,401);
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.ok(String(url).endsWith('/admin_seller_marketing_unsubscribe'));assert.deepEqual(JSON.parse(init.body),{p_lead_id:id});return Response.json(true);});
 const r=await adminOps(new Request(u,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:'{}'}),env);
 assert.deepEqual(await r.json(),{ok:true,unsubscribed:true});
});
