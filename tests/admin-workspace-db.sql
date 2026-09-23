-- Run against the migrated database. Every fixture is rolled back; no email can claim it.
begin;
do $$
#variable_conflict use_variable
declare session_id uuid; lead_id uuid; report_id uuid; generate_id bigint; email_id bigint; busy_id bigint; result jsonb; created_agent public.agents; duplicate_rejected boolean:=false;
begin
 insert into public.analysis_sessions(property_input) values('THM synthetic admin verification') returning id into session_id;
 insert into public.leads(analysis_session_id,name,mobile,email,source,metadata,lead_mode)
 values(session_id,'THM synthetic admin verification','+14165550199','admin-verification@example.com','admin_manual','{"generate_report":false}','buyer_report') returning id into lead_id;
 if exists(select 1 from public.automation_jobs j where j.lead_id=lead_id) then raise exception 'Contact-only fixture queued email'; end if;
 insert into public.property_reports(lead_id) values(lead_id) returning id into report_id;
 insert into public.automation_jobs(lead_id,report_id,job_type,status,available_at) values(lead_id,report_id,'generate_report','queued',now()+interval '1 day') returning id into generate_id;
 insert into public.automation_jobs(lead_id,report_id,job_type,status,recipient,available_at) values(lead_id,report_id,'email_buyer','queued','invalid-address',now()+interval '1 day') returning id into email_id;
 result:=public.admin_ops_lead_action(array[lead_id],'archive');
 if result#>>'{results,0,ok}'<>'true' or not exists(select 1 from public.leads l where l.id=lead_id and archived_at is not null) then raise exception 'Archive failed'; end if;
 if not exists(select 1 from public.automation_jobs j where j.id=generate_id and status='queued') then raise exception 'Archive changed queue'; end if;
 result:=public.admin_ops_lead_action(array[lead_id],'restore');
 if result#>>'{results,0,ok}'<>'true' or not exists(select 1 from public.leads l where l.id=lead_id and archived_at is null) then raise exception 'Restore failed'; end if;
 result:=public.admin_ops_cancel_jobs(array[generate_id]);
 if result#>>'{results,0,ok}'<>'true' then raise exception 'Cancellation failed: %',result; end if;
 if not exists(select 1 from public.automation_jobs j where j.id=email_id and status='cancelled') then raise exception 'Dependent invalid-recipient email was not cancelled'; end if;
 if not exists(select 1 from public.property_reports r where r.id=report_id and status='cancelled') then raise exception 'Report cancellation state failed'; end if;
 insert into public.automation_jobs(lead_id,job_type,status,locked_at) values(lead_id,'generate_report','processing',now()) returning id into busy_id;
 result:=public.admin_ops_cancel_jobs(array[busy_id]);
 if result#>>'{results,0,ok}'<>'false' then raise exception 'Processing job was cancellable'; end if;
 result:=public.admin_ops_lead_action(array[lead_id],'delete');
 if result#>>'{results,0,ok}'<>'false' or not exists(select 1 from public.leads l where l.id=lead_id) then raise exception 'Processing lead was deletable'; end if;
 update public.automation_jobs set status='completed' where id=busy_id;
 result:=public.admin_ops_lead_action(array[lead_id],'delete');
 if result#>>'{results,0,ok}'<>'true' then raise exception 'Delete failed: %',result; end if;
 if exists(select 1 from public.leads l where l.id=lead_id) or exists(select 1 from public.property_reports r where r.id=report_id) or exists(select 1 from public.automation_jobs j where j.lead_id=lead_id) then raise exception 'Delete left dependent records'; end if;
 select * into created_agent from public.admin_ops_create_agent('THM Synthetic Verification','verification@example.com','',false);
 if created_agent.id is null or created_agent.active then raise exception 'Agent creation failed'; end if;
 begin
  perform public.admin_ops_create_agent('THM Synthetic Verification','verification@example.com','',false);
 exception when raise_exception then duplicate_rejected:=true;
 end;
 if not duplicate_rejected then raise exception 'Duplicate agent accepted'; end if;
 if has_function_privilege('anon','public.admin_ops_lead_action(uuid[],text)','execute') or has_function_privilege('authenticated','public.admin_ops_cancel_jobs(bigint[])','execute') or has_function_privilege('anon','public.admin_ops_create_agent(text,text,text,boolean)','execute') or has_function_privilege('anon','public.recover_stale_report_jobs()','execute') then raise exception 'Admin operations have public execution privileges'; end if;
 if not has_function_privilege('service_role','public.admin_ops_cancel_jobs(bigint[])','execute') then raise exception 'Server role cannot cancel jobs'; end if;
end $$;
rollback;
