-- New leads wait for an administrator to choose an agent. The SLA begins on assignment.
insert into public.app_settings(key,value)
values
  ('assignment_method','"manual"'::jsonb),
  ('owner_notification_email','""'::jsonb)
on conflict (key) do update set value=excluded.value,updated_at=now();

create or replace function public.create_lead_manual(
  p_property_input text, p_listing_key text, p_resolved_address text,
  p_name text, p_mobile text, p_email text, p_showing_timing text,
  p_lead_mode text, p_page_url text, p_referrer text, p_property_snapshot jsonb
)
returns table(lead_id uuid, response_due_at timestamptz, queued_after_hours boolean)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_analysis_id uuid; v_report_id uuid; v_owner_email text;
begin
  if nullif(trim(p_property_input),'') is null or nullif(trim(p_name),'') is null or nullif(trim(p_mobile),'') is null then
    raise exception 'Property, name and mobile are required';
  end if;
  if nullif(trim(p_email),'') is null or lower(trim(p_email)) !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'A valid email is required';
  end if;

  insert into public.analysis_sessions(property_input,listing_key)
  values(trim(p_property_input),nullif(trim(p_listing_key),'')) returning id into v_analysis_id;

  insert into public.leads(
    analysis_session_id,name,mobile,email,showing_timing,status,owner_agent_id,
    stage,next_action,next_action_at,first_response_due_at,metadata
  ) values(
    v_analysis_id,trim(p_name),trim(p_mobile),lower(trim(p_email)),coalesce(nullif(trim(p_showing_timing),''),'asap'),
    'new',null,case when p_lead_mode='showing' then 'showing_requested' else coalesce(nullif(trim(p_lead_mode),''),'new') end,
    'admin_assign_agent',now(),null,
    jsonb_build_object('property_input',p_property_input,'resolved_address',p_resolved_address,'lead_mode',p_lead_mode,
      'page_url',p_page_url,'referrer',p_referrer,'property_snapshot',coalesce(p_property_snapshot,'{}'::jsonb),'assignment_method','manual')
  ) returning id into lead_id;

  insert into public.property_reports(lead_id) values(lead_id) returning id into v_report_id;
  insert into public.automation_jobs(lead_id,report_id,job_type,payload)
  values(lead_id,v_report_id,'generate_report',jsonb_build_object('trigger','lead_created','listing_key',p_listing_key));
  insert into public.automation_jobs(lead_id,report_id,job_type,recipient,available_at,payload)
  values(lead_id,v_report_id,'email_buyer',lower(trim(p_email)),now()+interval '15 seconds',jsonb_build_object('wait_for_report',true));

  select nullif(trim(value #>> '{}'),'') into v_owner_email from public.app_settings where key='owner_notification_email';
  insert into public.automation_jobs(lead_id,report_id,job_type,recipient,status,payload)
  values(lead_id,v_report_id,'email_recipient',v_owner_email,
    case when v_owner_email is null then 'blocked' else 'queued' end,
    jsonb_build_object('reason','new_lead_admin_alert','missing_destination',v_owner_email is null));

  insert into public.lead_events(lead_id,event_type,payload)
  values(lead_id,'lead_captured',jsonb_build_object('showing_timing',p_showing_timing,'assignment_method','manual'));
  response_due_at:=null; queued_after_hours:=false; return next;
end $$;

revoke all on function public.create_lead_manual(text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_lead_manual(text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.assign_lead_to_agent(p_lead_id uuid,p_agent_id uuid)
returns table(lead_id uuid,agent_id uuid,agent_code text,response_due_at timestamptz,queued_after_hours boolean)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_agent public.agents%rowtype; v_report_id uuid; v_sla integer:=5; v_hours jsonb;
  v_local timestamp; v_start time; v_end time; v_days jsonb; v_open boolean:=false; v_due timestamptz;
begin
  select * into v_agent from public.agents where id=p_agent_id and active=true for update;
  if v_agent.id is null then raise exception 'Choose an active agent'; end if;
  if not exists(select 1 from public.leads where id=p_lead_id) then raise exception 'Lead not found'; end if;
  select coalesce((value #>> '{}')::integer,5) into v_sla from public.app_settings where key='first_response_sla_minutes';
  select value into v_hours from public.app_settings where key='service_hours';
  v_local:=now() at time zone coalesce(v_hours->>'timezone','America/Toronto');
  v_start:=coalesce((v_hours->>'start')::time,'09:00'::time); v_end:=coalesce((v_hours->>'end')::time,'21:00'::time);
  v_days:=coalesce(v_hours->'days','[0,1,2,3,4,5,6]'::jsonb);
  v_open:=exists(select 1 from jsonb_array_elements_text(v_days) d(day_number) where d.day_number::integer=extract(dow from v_local)::integer)
    and v_local::time>=v_start and v_local::time<v_end;
  if v_open then v_due:=now()+make_interval(mins=>v_sla);
  else
    v_due:=((case when v_local::time<v_start then v_local::date else v_local::date+1 end)+v_start)
      at time zone coalesce(v_hours->>'timezone','America/Toronto') + make_interval(mins=>v_sla);
  end if;

  update public.leads set owner_agent_id=v_agent.id,first_response_due_at=v_due,next_action='agent_contact_buyer',
    next_action_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('assigned_by','admin','assigned_at',now())
  where id=p_lead_id;
  select id into v_report_id from public.property_reports where property_reports.lead_id=p_lead_id;
  insert into public.automation_jobs(lead_id,report_id,job_type,recipient,status,payload)
  values(p_lead_id,v_report_id,'notify_agent',coalesce(nullif(v_agent.email,''),nullif(v_agent.mobile,'')),
    case when coalesce(nullif(v_agent.email,''),nullif(v_agent.mobile,'')) is null then 'blocked' else 'queued' end,
    jsonb_build_object('reason','admin_assignment','agent_code',v_agent.code));
  insert into public.lead_events(lead_id,event_type,actor_type,payload)
  values(p_lead_id,'admin_agent_assigned','admin',jsonb_build_object('agent_id',v_agent.id,'agent_code',v_agent.code,'sla_minutes',v_sla));
  lead_id:=p_lead_id;agent_id:=v_agent.id;agent_code:=v_agent.code;response_due_at:=v_due;queued_after_hours:=not v_open;return next;
end $$;

revoke all on function public.assign_lead_to_agent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_lead_to_agent(uuid,uuid) to service_role;

-- Manual assignment owns escalation decisions; stop the old automatic reassignment schedule.
do $$ begin perform cron.unschedule(jobid) from cron.job where jobname='thm-process-overdue-showing-leads'; exception when undefined_table then null; end $$;
