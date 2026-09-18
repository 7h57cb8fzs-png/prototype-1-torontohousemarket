import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverEmailJob} from '../worker-v11.js';
const original=globalThis.fetch;
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
const lead={id:'fixture',name:'Owner',email:'owner@example.com',lead_mode:'seller',resolved_address:'Fixture home',property_snapshot:{},metadata:{},property_reports:[{status:'ready',report_payload:{}}]};
const env={SUPABASE_SERVICE_ROLE_KEY:'fixture',RESEND_API_KEY:'fixture'};
test('retry reuses the persisted exact email after provider accepted but completion failed',async()=>{
 let frozen,completeCalls=0;const sends=[];
 globalThis.fetch=async(input,init={})=>{
  const u=String(input);
  if(u.includes('/rest/v1/leads?'))return json([lead]);
  if(u.includes('/rest/v1/automation_jobs?')){frozen=JSON.parse(init.body).payload.frozen_email;return json([{id:741}]);}
  if(u==='https://api.resend.com/emails'){sends.push({body:init.body,key:init.headers['Idempotency-Key']});return json({id:'provider-same-message'});}
  if(u.includes('/rpc/complete_email_job')){if(++completeCalls<=3)throw Error('completion connection lost');return json(null);}
  throw Error('Unexpected request '+u);
 };
 try{
  const job={id:741,lead_id:'fixture',job_type:'email_recipient',recipient:'owner@example.com',attempts:1,payload:{reason:'seller_request_received'}};
  await assert.rejects(deliverEmailJob(env,job));assert.ok(frozen);
  lead.resolved_address='Changed after initial send';
  await deliverEmailJob(env,{...job,attempts:2,payload:{...job.payload,frozen_email:frozen}});
  assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1]);
 }finally{globalThis.fetch=original;lead.resolved_address='Fixture home';}
});
test('no email is sent when another attempt owns the job',async()=>{
 let sent=false;
 globalThis.fetch=async(input)=>{const u=String(input);if(u.includes('/leads?'))return json([lead]);if(u.includes('/automation_jobs?'))return json([]);if(u.includes('api.resend.com'))sent=true;throw Error('Unexpected request');};
 try{await assert.rejects(deliverEmailJob(env,{id:742,lead_id:'fixture',job_type:'email_recipient',recipient:'owner@example.com',attempts:1,payload:{}}),/no longer owns/);assert.equal(sent,false);}finally{globalThis.fetch=original;}
});
