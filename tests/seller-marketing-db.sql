begin;
set local role service_role;
do $$
declare
  x jsonb; lead_a uuid; lead_b uuid; j jsonb; claimed jsonb; token uuid; frozen jsonb:='{"subject":"test-only"}'::jsonb;
  base jsonb:=jsonb_build_object('name','Marketing transaction fixture','mobile','+16475550123','email','thm-marketing-fixture@example.invalid','lead_mode','seller','showing_requested',false,'property_input','101 Example Street, Toronto','resolved_address','101 Example Street, Toronto');
  snapshot jsonb:=jsonb_build_object('sellerProfile',jsonb_build_object('ownerConsent',true,'contactConsent',true,'marketingConsent',true,'marketingConsentVersion','seller-strategy-fees-2026-09-23'));
begin
  if exists(select 1 from public.seller_marketing_jobs) then raise exception 'Run isolated database checks before marketing activation'; end if;
  if has_table_privilege('anon','public.seller_marketing_contacts','SELECT') or has_function_privilege('anon','public.unsubscribe_seller_marketing(uuid)','EXECUTE') then raise exception 'Public access exposed';end if;
  -- Existing report-only requests remain valid and queue no marketing.
  x:=public.create_phase5_request(base||jsonb_build_object('request_key',gen_random_uuid(),'property_snapshot','{"sellerProfile":{"ownerConsent":true,"contactConsent":true}}'::jsonb));
  if exists(select 1 from public.seller_marketing_jobs) then raise exception 'Old permissions became marketing';end if;
  -- Explicit seller opt-in is captured in the same request transaction.
  x:=public.create_phase5_request(base||jsonb_build_object('request_key',gen_random_uuid(),'property_snapshot',snapshot));lead_a:=(x->>'lead_id')::uuid;
  if (select count(*) from public.seller_marketing_consents)<>1 or (select count(*) from public.seller_marketing_jobs)<>1 then raise exception 'Missing consent/job';end if;
  if jsonb_array_length(public.claim_seller_marketing_jobs(3))<>0 then raise exception 'Marketing ran before report email';end if;
  -- A second request never duplicates the introductory campaign.
  x:=public.create_phase5_request(base||jsonb_build_object('request_key',gen_random_uuid(),'property_snapshot',snapshot));lead_b:=(x->>'lead_id')::uuid;
  if (select count(*) from public.seller_marketing_consents)<>2 or (select count(*) from public.seller_marketing_jobs)<>1 then raise exception 'Campaign duplicated';end if;
  -- Simulate provider acceptance locally; this transaction is never committed.
  update public.automation_jobs set status='sent' where lead_id=lead_a and job_type='email_buyer';
  claimed:=public.claim_seller_marketing_jobs(3);if jsonb_array_length(claimed)<>1 then raise exception 'Ready marketing did not claim';end if;j:=claimed->0;
  if jsonb_array_length(public.claim_seller_marketing_jobs(3))<>0 then raise exception 'Lease was claimed twice';end if;
  if public.prepare_seller_marketing_send((j->>'id')::uuid,999,frozen) then raise exception 'Wrong attempt owns job';end if;
  if not public.prepare_seller_marketing_send((j->>'id')::uuid,1,frozen) then raise exception 'Valid send not prepared';end if;
  if public.prepare_seller_marketing_send((j->>'id')::uuid,1,'{"changed":true}'::jsonb) then raise exception 'Frozen payload changed';end if;
  perform public.fail_seller_marketing_send((j->>'id')::uuid,1,'test retry');
  update public.seller_marketing_jobs set available_at=now() where id=(j->>'id')::uuid;
  claimed:=public.claim_seller_marketing_jobs(3);j:=claimed->0;
  if (j->>'attempts')::integer<>2 or j->'frozen_email'<>frozen then raise exception 'Retry did not preserve payload';end if;
  token:=(j->>'unsubscribe_token')::uuid;
  if not public.unsubscribe_seller_marketing(token) or not public.unsubscribe_seller_marketing(token) then raise exception 'Unsubscribe not repeatable';end if;
  if public.prepare_seller_marketing_send((j->>'id')::uuid,2,frozen) then raise exception 'Suppressed subscriber was sent';end if;
  if (select status from public.automation_jobs where lead_id=lead_a and job_type='email_buyer' limit 1)<>'sent' then raise exception 'Unsubscribe changed property report';end if;
  if public.admin_seller_marketing_status(lead_b)->>'suppressedAt' is null then raise exception 'Admin status missing suppression';end if;
  x:=public.create_phase5_request(base||jsonb_build_object('request_key',gen_random_uuid(),'property_snapshot',snapshot));
  if jsonb_array_length(public.claim_seller_marketing_jobs(3))<>0 then raise exception 'Later request silently resubscribed';end if;
  if public.unsubscribe_seller_marketing(gen_random_uuid()) then raise exception 'Unknown token accepted';end if;
end $$;
rollback;
select 'PASS: 17 database checks; transaction rolled back, no customer records or emails created.' as result;
