create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.property_reports (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','generating','ready','failed')),
  report_payload jsonb not null default '{}'::jsonb,
  error_message text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_jobs (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  report_id uuid references public.property_reports(id) on delete cascade,
  job_type text not null check (job_type in ('generate_report','email_buyer','notify_agent','email_recipient')),
  recipient text,
  status text not null default 'queued' check (status in ('queued','processing','sent','completed','blocked','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_jobs_dispatch_idx on public.automation_jobs(status, available_at, id);
create index if not exists property_reports_status_idx on public.property_reports(status, created_at);
alter table public.property_reports enable row level security;
alter table public.automation_jobs enable row level security;

revoke all on public.app_settings, public.agents, public.round_robin_state, public.analysis_sessions, public.leads, public.lead_events, public.property_reports, public.automation_jobs from anon, authenticated;
grant all on public.app_settings, public.agents, public.round_robin_state, public.analysis_sessions, public.leads, public.lead_events, public.property_reports, public.automation_jobs to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.create_lead_v3(
  p_property_input text, p_listing_key text, p_resolved_address text,
  p_name text, p_mobile text, p_email text, p_showing_timing text,
  p_lead_mode text, p_page_url text, p_referrer text, p_property_snapshot jsonb
)
returns table(lead_id uuid, agent_id uuid, agent_code text, response_due_at timestamptz, queued_after_hours boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v record; v_report_id uuid; v_agent_email text; v_agent_mobile text;
begin
  select * into v from public.create_lead_v2(p_property_input,p_listing_key,p_resolved_address,p_name,p_mobile,p_email,p_showing_timing,p_lead_mode,p_page_url,p_referrer,p_property_snapshot);
  insert into public.property_reports(lead_id) values(v.lead_id) returning id into v_report_id;
  insert into public.automation_jobs(lead_id,report_id,job_type,payload)
  values(v.lead_id,v_report_id,'generate_report',jsonb_build_object('trigger','lead_created','listing_key',p_listing_key));

  if nullif(trim(coalesce(p_email,'')),'') is not null then
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,available_at,payload)
    values(v.lead_id,v_report_id,'email_buyer',lower(trim(p_email)),now()+interval '15 seconds',jsonb_build_object('wait_for_report',true));
  end if;

  select email,mobile into v_agent_email,v_agent_mobile from public.agents where id=v.agent_id;
  insert into public.automation_jobs(lead_id,report_id,job_type,recipient,status,payload)
  values(v.lead_id,v_report_id,'notify_agent',coalesce(nullif(v_agent_email,''),nullif(v_agent_mobile,'')),case when coalesce(nullif(v_agent_email,''),nullif(v_agent_mobile,'')) is null then 'blocked' else 'queued' end,jsonb_build_object('agent_code',v.agent_code,'missing_destination',coalesce(nullif(v_agent_email,''),nullif(v_agent_mobile,'')) is null));
  insert into public.lead_events(lead_id,event_type,payload) values(v.lead_id,'automation_queued',jsonb_build_object('report_id',v_report_id));
  return query select v.lead_id,v.agent_id,v.agent_code,v.response_due_at,v.queued_after_hours;
end $$;

revoke all on function public.create_lead_v3(text,text,text,text,text,text,text,text,text,text,jsonb) from public, authenticated;
grant execute on function public.create_lead_v3(text,text,text,text,text,text,text,text,text,text,jsonb) to anon, service_role;

create or replace function public.process_overdue_showing_leads()
returns integer language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_lead record; v_agent record; v_count integer:=0; v_sla integer:=5;
begin
  select coalesce((value #>> '{}')::integer,5) into v_sla from public.app_settings where key='reassignment_minutes';
  for v_lead in select * from public.leads where lead_mode='showing' and status='new' and first_response_due_at<=now() for update skip locked loop
    select * into v_agent from public.agents where active and assignment_order>(select assignment_order from public.agents where id=v_lead.owner_agent_id) order by assignment_order limit 1;
    if v_agent.id is null then select * into v_agent from public.agents where active order by assignment_order limit 1; end if;
    if v_agent.id is not null then
      update public.leads set owner_agent_id=v_agent.id,first_response_due_at=now()+make_interval(mins=>v_sla),next_action_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('sla_escalated',true) where id=v_lead.id;
      insert into public.lead_events(lead_id,event_type,payload) values(v_lead.id,'sla_reassigned',jsonb_build_object('agent_id',v_agent.id,'agent_code',v_agent.code));
      insert into public.automation_jobs(lead_id,report_id,job_type,recipient,status,payload) select v_lead.id,pr.id,'notify_agent',coalesce(nullif(v_agent.email,''),nullif(v_agent.mobile,'')),case when coalesce(nullif(v_agent.email,''),nullif(v_agent.mobile,'')) is null then 'blocked' else 'queued' end,jsonb_build_object('reason','sla_reassignment','agent_code',v_agent.code) from public.property_reports pr where pr.lead_id=v_lead.id;
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.process_overdue_showing_leads() from public,anon,authenticated;
grant execute on function public.process_overdue_showing_leads() to service_role;

do $$ begin
  if not exists (select 1 from cron.job where jobname='thm-process-overdue-showing-leads') then
    perform cron.schedule('thm-process-overdue-showing-leads','* * * * *','select public.process_overdue_showing_leads()');
  end if;
end $$;
