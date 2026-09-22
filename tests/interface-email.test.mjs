import test from 'node:test';
import assert from 'node:assert/strict';
import {propertyReportEmail,sellerReportEmail,buildEmail,deliverEmailJob} from '../worker-v11.js';

const report={generated_at:'2026-09-22T12:00:00Z',facts:{listing_key:'N10000001',for_sale:true,list_price:1200000,property_type:'Detached'},valuation:{available:true,low:1050000,midpoint:1100000,high:1150000,confidence:'Medium'},comparables:[1,2,3].map(n=>({address:`${n} Example Street`,soldPrice:1050000+n*25000,soldDate:'2026-09-01',propertySubType:'Detached'})),seller:{evidence:{listingMatched:true}},narrative:{}};
test('buyer and seller emails remove incentives while retaining price, address and contact actions',()=>{
  for(const email of [propertyReportEmail('10 Example Street',{},report),propertyReportEmail('10 Example Street',{}, {...report,facts:{...report.facts,for_sale:false}}),sellerReportEmail('10 Example Street',report),sellerReportEmail('10 Example Street',{facts:{},valuation:{available:false},comparables:[]})]){
    for(const body of [email.html,email.text]){
      assert.doesNotMatch(body,/cash\s*back|YOUR BUYER BENEFIT|eligible purchase|10,000 back/i);
      assert.match(body,/10 Example Street/);
      assert.match(body,/contact the team/i);
    }
    assert.doesNotMatch(email.html.replace(/<[^>]*>/g,''),/647.?890.?4704/);
    assert.match(email.html,/href="tel:\+16478904704"/);
    assert.match(email.html,/<meta charset="utf-8">/i);
    assert.match(email.html,/font-family:Georgia,Times New Roman,serif;font-size:16px;font-weight:400;line-height:1.25/);
  }
  const email=propertyReportEmail('10 Example Street',{},report,{appointmentUrl:'https://torontohousemarket.com/showing.html#token=fixture'});
  assert.match(email.html,/href="https:\/\/torontohousemarket.com\/showing.html#token=fixture"/);
  assert.match(email.html,/\$1,200,000/);
  assert.match(email.html,/font:500 18px\/1.4 Arial,Helvetica,sans-serif/);
});

test('client confirmations preserve verification and showing actions with the shared THM presentation',()=>{
  const lead={lead_mode:'buyer',resolved_address:'10 Example Street',name:'Example',showing_requested:true,appointment_url:'https://torontohousemarket.com/showing.html#token=fixture'};
  for(const reason of ['buyer_request_confirmation','buyer_showing_requested','buyer_appointment_confirmed']){
    const payload={reason,...reason==='buyer_request_confirmation'?{vow_action_link:'https://torontohousemarket.com/api/verify?token=fixture'}:{}};
    const email=buildEmail({job_type:'email_recipient',payload},lead);
    assert.match(email.html,/TORONTO HOUSE MARKET/);
    assert.match(email.html,/Property reports &amp; fast showings.<br><a [^>]+>Contact the team<\/a>/);
    assert.match(email.html,/background:#203b3c/);
    assert.match(email.html,/font:400 32px\/1.25 Georgia,Times New Roman,serif/);
    assert.match(email.html,/font:500 16px\/1.5 Arial,Helvetica,sans-serif/);
    assert.ok(email.html.includes(payload.vow_action_link||lead.appointment_url));
    assert.match(email.text,/10 Example Street/);
    assert.doesNotMatch(email.html,/cash\s*back/i);
  }
});

test('new emails use only the THM sender name even when the configured mailbox has a personal display name',async t=>{
  const sent=[];
  const response=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
  t.mock.method(globalThis,'fetch',async(input,init={})=>{
    const url=String(input);
    if(url.includes('/rest/v1/leads?'))return response([{id:'fixture',lead_mode:'seller',resolved_address:'10 Example Street',property_snapshot:{},metadata:{}}]);
    if(url.includes('/rest/v1/automation_jobs?'))return response([{id:751}]);
    if(url==='https://api.resend.com/emails'){sent.push(JSON.parse(init.body));return response({id:'fixture'});}
    if(url.includes('/rpc/complete_email_job'))return response(null);
    throw Error('Unexpected request '+url);
  });
  for(const from of [undefined,'notifications@updates.torontohousemarket.com','Alireza Golestan | Toronto House Market <notifications@updates.torontohousemarket.com>']){
    await deliverEmailJob({SUPABASE_SERVICE_ROLE_KEY:'fixture',RESEND_API_KEY:'fixture',RESEND_FROM_EMAIL:from},{id:751,lead_id:'fixture',job_type:'email_recipient',recipient:'fixture@example.com',attempts:1,payload:{reason:'buyer_request_confirmation'}});
  }
  assert.equal(sent.length,3);
  for(const email of sent){assert.equal(email.from,'Toronto House Market <notifications@updates.torontohousemarket.com>');assert.equal(email.reply_to,'torontohousemarket@gmail.com');}
});
