-- Five focused admin workflows, using only transaction-local fixtures. No email is sent.
begin;
set local role service_role;
do $$
declare v_session uuid;v_lead uuid;v_agent public.agents;v_result jsonb;v_before jsonb;v_after jsonb;v_count integer;v_rejected boolean:=false;v_email text:='admin-insights-'||gen_random_uuid()::text||'@torontohousemarket.com';v_report uuid;
begin
 -- 1. Agent removal and manual assignment: no lead removal; duplicate assignment is idempotent.
 select * into v_agent from public.admin_ops_create_agent('THM Admin Insights Test',v_email,'',true);
 insert into public.analysis_sessions(property_input) values('THM transaction-local fixture') returning id into v_session;
 insert into public.leads(analysis_session_id,name,mobile,email,source,lead_mode,metadata,property_snapshot,created_at)
 values(v_session,'THM transaction-local fixture','+14165550199',v_email,'admin_manual','seller','{"generate_report":false}',
 '{"sellerProfile":{"targetMin":950000,"targetMax":1150000,"renovationPct":0,"kitchens":0,"marketingConsent":false}}','2026-03-09T03:59:59Z') returning id into v_lead;
 if (select owner_agent_id from public.leads where id=v_lead) is not null then raise exception 'Lead did not start unassigned';end if;
 v_result:=public.admin_ops_assign_leads(array[v_lead],v_agent.id);
 if v_result#>>'{results,0,ok}'<>'true' then raise exception 'Assignment failed: %',v_result;end if;
 select count(*) into v_count from public.automation_jobs where lead_id=v_lead;
 perform public.admin_ops_assign_leads(array[v_lead],v_agent.id);
 if (select count(*) from public.automation_jobs where lead_id=v_lead)<>v_count then raise exception 'Repeated assignment queued duplicate notifications';end if;
 begin perform public.admin_ops_delete_agent(v_agent.id);exception when raise_exception then v_rejected:=true;end;
 if not v_rejected then raise exception 'Assigned agent was deletable';end if;
 perform public.admin_ops_assign_leads(array[v_lead],null);
 v_result:=public.admin_ops_delete_agent(v_agent.id);
 if v_result->>'deleted'<>'true' or not exists(select 1 from public.leads where id=v_lead and owner_agent_id is null) then raise exception 'Agent removal damaged lead';end if;

 -- 2. Toronto calendar dates, DST boundary and explicit test exclusion.
 v_before:=public.admin_ops_analytics('2026-03-08','2026-03-08',false);
 update public.leads set created_at='2026-03-09T04:00:00Z' where id=v_lead;
 v_after:=public.admin_ops_analytics('2026-03-08','2026-03-08',false);
 if (v_before#>>'{totals,leads}')::integer<>(v_after#>>'{totals,leads}')::integer+1 then raise exception 'Toronto DST day boundary incorrect';end if;
 update public.leads set created_at='2026-03-09T03:59:59Z',source='admin_test' where id=v_lead;
 v_before:=public.admin_ops_analytics('2026-03-08','2026-03-08',false);
 v_after:=public.admin_ops_analytics('2026-03-08','2026-03-08',true);
 if (v_after#>>'{totals,leads}')::integer<=(v_before#>>'{totals,leads}')::integer then raise exception 'Marked test exclusion failed';end if;
 if v_after#>>'{tracking,shares}'<>'false' then raise exception 'Invented share tracking';end if;
 update public.leads set source='admin_manual' where id=v_lead;

 -- 3. Marketing lists existing consent; unsubscribe leaves property report jobs alone.
 insert into public.seller_marketing_contacts(email) values(v_email);
 insert into public.seller_marketing_consents(lead_id,email,wording,version,source) values(v_lead,v_email,'Synthetic consent','test','test');
 insert into public.seller_marketing_jobs(lead_id,consent_id,email) select v_lead,id,v_email from public.seller_marketing_consents where lead_id=v_lead;
 insert into public.property_reports(lead_id,status,generated_at,report_payload) values(v_lead,'ready',now(),'{"valuation":{"available":true,"low":900000,"midpoint":1000000,"high":1100000}}') returning id into v_report;
 insert into public.automation_jobs(lead_id,report_id,job_type,status,available_at) values(v_lead,v_report,'generate_report','queued',now()+interval '1 day');
 v_result:=public.admin_ops_marketing_list(1,v_email,'opted_in');if (v_result->>'total')::integer<>1 then raise exception 'Marketing contact absent';end if;
 if not public.admin_ops_marketing_unsubscribe(v_email) then raise exception 'Marketing unsubscribe failed';end if;
 if not exists(select 1 from public.seller_marketing_jobs where lead_id=v_lead and status='suppressed') then raise exception 'Marketing job not stopped';end if;
 if not exists(select 1 from public.automation_jobs where lead_id=v_lead and job_type='generate_report' and status='queued') then raise exception 'Unsubscribe changed report job';end if;

 -- 4. Export preserves zero, expectations, report summary and suppression without tokens.
 v_result:=public.admin_ops_export_leads(array[v_lead]);
 if v_result#>>'{leads,0,property_snapshot,sellerProfile,targetMin}'<>'950000' or v_result#>>'{leads,0,property_snapshot,sellerProfile,targetMax}'<>'1150000' or v_result#>>'{leads,0,property_snapshot,sellerProfile,renovationPct}'<>'0' then raise exception 'Seller export lost inputs';end if;
 if v_result#>>'{leads,0,seller_marketing,suppressedAt}' is null then raise exception 'Export lost unsubscribe';end if;
 if v_result::text like '%unsubscribe_token%' then raise exception 'Export exposed private token';end if;

 -- 5. Only the server/admin path can execute the new operations. No automatic assignment schedule.
 if has_function_privilege('anon','public.admin_ops_delete_agent(uuid)','execute') or has_function_privilege('authenticated','public.admin_ops_export_leads(uuid[])','execute') or has_function_privilege('anon','public.admin_ops_assign_leads(uuid[],uuid)','execute') then raise exception 'Public execution permission';end if;
 if (select value #>> '{}' from public.app_settings where key='assignment_method')<>'manual' then raise exception 'Assignment is not manual';end if;
 if exists(select 1 from public.agents where id=v_agent.id) then raise exception 'Synthetic agent not removed';end if;
 -- The admin lead-removal control also respects the separate marketing sender.
 update public.seller_marketing_jobs set status='processing',locked_at=now() where lead_id=v_lead;
 v_result:=public.admin_ops_lead_action(array[v_lead],'delete');
 if v_result#>>'{results,0,ok}'<>'false' or not exists(select 1 from public.leads where id=v_lead) then raise exception 'Processing marketing lead was deletable';end if;
 update public.seller_marketing_jobs set status='queued',locked_at=null where lead_id=v_lead;
 v_result:=public.admin_ops_lead_action(array[v_lead],'delete');
 if v_result#>>'{results,0,ok}'<>'true' then raise exception 'Lead removal failed after marketing completed';end if;
 if not exists(select 1 from public.seller_marketing_consents where email=v_email and lead_id is null) or not exists(select 1 from public.seller_marketing_contacts where email=v_email and suppressed_at is not null) then raise exception 'Lead removal erased consent or suppression';end if;
end $$;
rollback;
