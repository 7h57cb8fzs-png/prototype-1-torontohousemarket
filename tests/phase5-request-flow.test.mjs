import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{requestIntent,torontoShowingTime,issueAppointmentToken,verifyAppointmentToken,showingCalendar,createBuyerRequest,selectDiscoveryHomes,propertyReportEmail,buildEmail} from '../worker-v11.js';
const now=Date.parse('2026-09-07T12:00:00Z');
const id='11111111-2222-4333-8444-555555555555';
const env={SUPABASE_SERVICE_ROLE_KEY:'fixture-service',VOW_AUDIT_SALT:'fixture-signing-key-not-production',ADMIN_API_KEY:'fixture-admin-key-at-least-24-characters'};

test('the default request is a report; showing consent cannot be inferred from a date',()=>{
  assert.deepEqual(requestIntent({showing_date:'2026-09-09',showing_time:'10:00'},now),{lead_mode:'buyer_report',showing_requested:false,showing_timing:'report',preferred_showing_at:null});
  assert.equal(requestIntent({lead_mode:'showing',showing_requested:false},now).lead_mode,'buyer_report');
  assert.equal(requestIntent({showing_requested:true},now).lead_mode,'showing');
  assert.throws(()=>requestIntent({lead_mode:'seller',showing_requested:true},now));
});
test('Toronto calendar choices handle summer and winter offsets and reject invalid or past slots',()=>{
  assert.equal(torontoShowingTime('2026-09-09','10:30',now),'2026-09-09T14:30:00.000Z');
  assert.equal(torontoShowingTime('2026-11-03','10:30',Date.parse('2026-10-25T12:00:00Z')),'2026-11-03T15:30:00.000Z');
  for(const [d,t] of [['2026-09-07','08:30'],['2026-09-09','21:00'],['2026-09-09','10:10'],['2026-10-09','10:00'],['2026-02-31','10:00']])assert.throws(()=>torontoShowingTime(d,t,now));
});
test('showing links are signed, purpose-specific and expire',async()=>{
  const token=await issueAppointmentToken(id,env,now);
  assert.equal(await verifyAppointmentToken(token,env,now),id);
  assert.equal(await verifyAppointmentToken(token+'x',env,now),null);
  assert.equal(await verifyAppointmentToken(token,env,now+31*86400000),null);
  assert.equal(await verifyAppointmentToken(token,{...env,VOW_AUDIT_SALT:'different'},now),null);
  assert.equal(await issueAppointmentToken(id,{}),null);
});
test('public report creation queues a report even when a client tries to disable it',async t=>{
  let captured;
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.match(String(url),/rpc\/create_phase5_request$/);captured=JSON.parse(init.body);return Response.json({lead_id:id,report_queued:true,showing_requested:false});});
  const r=await createBuyerRequest(new Request('https://example.com/api/lead',{method:'POST',body:JSON.stringify({name:'Test Buyer',email:'test@example.com',mobile:'6475550101',property_input:'981 Avenue Road',showing_requested:false,generate_report:false,request_key:id})}),env,{});
  assert.equal(r.status,201);assert.equal(captured.p_manual,false);assert.equal(captured.p_request.generate_report,true);assert.equal(captured.p_request.lead_mode,'buyer_report');
});
test('admin manual capture is protected and does not opt into report generation',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;const p=JSON.parse(init.body);assert.equal(p.p_manual,true);assert.equal(p.p_request.generate_report,false);return Response.json({lead_id:id,report_queued:false});});
  const body=JSON.stringify({name:'Manual Buyer',email:'test@example.com',mobile:'6475550101',request_key:id});
  assert.equal((await worker.fetch(new Request('https://example.com/api/admin/leads',{method:'POST',body}),env,{})).status,401);
  assert.equal(calls,0);
  assert.equal((await worker.fetch(new Request('https://example.com/api/admin/leads',{method:'POST',headers:{Authorization:`Bearer ${env.ADMIN_API_KEY}`},body}),env,{})).status,201);
  assert.equal(calls,1);
});
test('showing requests reject a sold or restricted listing before saving',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{assert.ok(!String(url).includes('supabase'));return Response.json({ListingKey:'N1000001',StandardStatus:'Sold',TransactionType:'For Sale',UnparsedAddress:'Test address',InternetAddressDisplayYN:false});});
  const r=await createBuyerRequest(new Request('https://example.com/api/lead',{method:'POST',body:JSON.stringify({name:'Test Buyer',email:'test@example.com',mobile:'6475550101',property_input:'N1000001',listing_key:'N1000001',showing_requested:true,request_key:id})}),{...env,AMPRE_TOKEN:'idx-fixture'},{});
  assert.equal(r.status,409);
});
test('appointment reads expose scheduling details without client contact or report evidence',async t=>{
  const token=await issueAppointmentToken(id,env);
  t.mock.method(globalThis,'fetch',async()=>Response.json([{id,status:'new',resolved_address:'Test property',name:'PRIVATE NAME',email:'PRIVATE EMAIL',metadata:{private:'PRIVATE DATA'},showing_requested:false,preferred_showing_at:null}]));
  const response=await worker.fetch(new Request('https://example.com/api/appointments',{headers:{Authorization:`Bearer ${token}`}}),env,{});
  const body=await response.json();assert.equal(body.ok,true);assert.equal(body.address,'Test property');assert.ok(!JSON.stringify(body).includes('PRIVATE'));
  assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('calendar downloads require team confirmation',async t=>{
  const token=await issueAppointmentToken(id,env);
  t.mock.method(globalThis,'fetch',async()=>Response.json([{id,status:'appointment_pending',resolved_address:'Test property',preferred_showing_at:'2026-09-09T14:30:00Z'}]));
  assert.equal((await worker.fetch(new Request(`https://example.com/api/appointments/calendar?token=${token}`),env,{})).status,409);
  const ics=showingCalendar({id,confirmed_showing_at:'2026-09-09T14:30:00Z'},'1 Test Road, Toronto');
  assert.match(ics,/DTSTART:20260909T143000Z/);assert.match(ics,/STATUS:CONFIRMED/);assert.ok(!ics.includes('ATTENDEE'));assert.match(ics,/LOCATION:1 Test Road\\, Toronto/);
});
test('admin cannot confirm a report-only lead or confirm without a date',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json([{id,showing_requested:false,status:'new'}]));
  const response=await worker.fetch(new Request(`https://example.com/api/admin/leads/${id}`,{method:'PATCH',headers:{Authorization:`Bearer ${env.ADMIN_API_KEY}`},body:JSON.stringify({status:'appointment_confirmed'})}),env,{});
  assert.equal(response.status,409);
});
test('lead removal requires admin authentication and handles a busy queue',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({message:'A report or email is processing. Wait until it finishes.'},{status:409});});
  assert.equal((await worker.fetch(new Request(`https://example.com/api/admin/leads/${id}`,{method:'DELETE'}),env,{})).status,401);assert.equal(calls,0);
  assert.equal((await worker.fetch(new Request(`https://example.com/api/admin/leads/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${env.ADMIN_API_KEY}`}}),env,{})).status,409);
});
test('AI shortlist accepts verified IDs only and labels failures as matched results',async()=>{
  const homes=[1,2,3,4].map(i=>({listingKey:`N100000${i}`,listPrice:1000000+i,propertySubType:'Detached',city:'Toronto',daysLive:2}));
  const valid=await selectDiscoveryHomes({AI:{run:async()=>({response:JSON.stringify({listingKeys:['N1000003','N1000001','N1000002']})})}},homes,{});
  assert.equal(valid.mode,'ai');assert.equal(valid.homes[0],homes[2]);
  const invalid=await selectDiscoveryHomes({AI:{run:async()=>({response:JSON.stringify({listingKeys:['INVENTED','N1000001','N1000002']})})}},homes,{});
  assert.equal(invalid.mode,'matched');assert.equal(invalid.homes[0],homes[0]);
  assert.equal((await selectDiscoveryHomes({},homes,{})).mode,'matched');
});
test('shortlist photos use the verified media key when legacy normalization drops the proxy URL',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{assert.match(String(url),/Property/);return Response.json({ListingKey:'N1000001',City:'Toronto',UnparsedAddress:'Test property',StandardStatus:'Active',TransactionType:'For Sale',PropertySubType:'Detached',ListPrice:1000000,Media:[{MediaKey:'verified-photo-key',MediaType:'image/jpeg',MediaURL:'https://example.com/photo.jpg'}]});});
  const response=await worker.fetch(new Request('https://example.com/api/discovery-photo?listingKey=N1000001'),{AMPRE_TOKEN:'idx-fixture',PUBLIC_DISCOVERY_ENABLED:'true'},{});
  assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'https://example.com/api/media?key=verified-photo-key');
});
test('buyer emails distinguish report-only, requested and confirmed showing states',()=>{
  const lead={resolved_address:'Test home',showing_requested:false,showing_timing:'report'};
  assert.match(buildEmail({payload:{reason:'buyer_request_confirmation'}},lead).text,/no showing requested/);
  const confirmed=buildEmail({payload:{reason:'buyer_appointment_confirmed'}},{...lead,showing_requested:true,confirmed_showing_at:'2026-09-09T14:30:00Z',appointment_url:'https://torontohousemarket.com/showing.html#token=fixture'});
  assert.match(confirmed.html,/Toronto time/);assert.match(confirmed.html,/showing.html#token=fixture/);
});
test('report contact actions carry the signed scheduling link and never a fresh-analysis request',()=>{
  const report=propertyReportEmail('Test home',{}, {facts:{for_sale:true,list_price:1000000},valuation:{available:false},comparables:[]},{appointmentUrl:'https://torontohousemarket.com/showing.html#token=fixture'});
  for(const text of [report.html,report.text]){assert.match(text,/647-890-4704/);assert.match(text,/showing.html#token=fixture/);assert.ok(!/fresh price analysis|Request a fresh/i.test(text));}
  assert.match(report.html,/tel:\+16478904704/);assert.match(report.html,/Alireza Golestan &amp; Mehrdad Golestan/);assert.match(report.html,/Sales Representatives/);
});
