-- Phase 5: explicit report/showing intent, calendar preferences and admin capture.
alter table public.leads add column if not exists showing_requested boolean not null default false;
alter table public.leads add column if not exists preferred_showing_at timestamptz;
alter table public.leads add column if not exists confirmed_showing_at timestamptz;
alter table public.leads add column if not exists request_key uuid;
alter table public.leads drop constraint if exists leads_lead_mode_check;
alter table public.leads add constraint leads_lead_mode_check check (lead_mode in ('showing','buyer_report','buyer_offmarket','seller'));
create unique index if not exists leads_request_key_unique on public.leads(request_key) where request_key is not null;
update public.leads set showing_requested=(coalesce(metadata->>'lead_mode',lead_mode)='showing');

create or replace function public.queue_buyer_confirmation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.source='admin_manual' and coalesce(new.metadata->>'generate_report','false')<>'true' then return new; end if;
  if nullif(trim(new.email),'') is not null then
    insert into public.automation_jobs(lead_id,job_type,recipient,payload)
    values(new.id,'email_recipient',lower(trim(new.email)),jsonb_build_object('reason','buyer_request_confirmation'));
  end if;
  return new;
end $$;

create or replace function public.create_phase5_request(p_request jsonb, p_manual boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid; v_session uuid; v_report uuid; v_owner text;
  v_key uuid := (p_request->>'request_key')::uuid;
  v_name text := trim(p_request->>'name'); v_email text := lower(trim(p_request->>'email'));
  v_mobile text := trim(p_request->>'mobile'); v_property text := trim(p_request->>'property_input');
  v_mode text := coalesce(p_request->>'lead_mode','buyer_report');
  v_showing boolean := coalesce((p_request->>'showing_requested')::boolean,false);
  v_generate boolean := not p_manual or coalesce((p_request->>'generate_report')::boolean,false);
  v_preferred timestamptz := nullif(p_request->>'preferred_showing_at','')::timestamptz;
  v_existing public.leads%rowtype;
begin
  if length(coalesce(v_name,''))<2 or length(regexp_replace(coalesce(v_mobile,''),'[^0-9]','','g'))<7 or coalesce(v_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Name, mobile and a valid email are required'; end if;
  if v_mode not in ('showing','buyer_report','buyer_offmarket','seller') or (v_showing and v_mode<>'showing') or (not v_showing and v_mode='showing') then raise exception 'Invalid request type'; end if;
  if nullif(v_property,'') is null then
    if v_generate or v_showing then raise exception 'Choose a property'; end if;
    v_property := 'General enquiry';
  end if;
  if v_preferred is not null and (not v_showing or v_preferred<now()+interval '30 minutes' or v_preferred>now()+interval '30 days') then raise exception 'Choose a showing time between 30 minutes and 30 days from now'; end if;
  if v_key is null then raise exception 'Request key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key::text,0));
  select * into v_existing from public.leads where request_key=v_key;
  if found then
    if v_existing.email<>v_email then raise exception 'Request key already used'; end if;
    return jsonb_build_object('lead_id',v_existing.id,'showing_requested',v_existing.showing_requested,'report_queued',exists(select 1 from public.property_reports where lead_id=v_existing.id),'duplicate',true);
  end if;
  insert into public.analysis_sessions(property_input,listing_key,resolved_address)
  values(v_property,nullif(p_request->>'listing_key',''),coalesce(nullif(p_request->>'resolved_address',''),v_property)) returning id into v_session;
  insert into public.leads(analysis_session_id,name,mobile,email,lead_mode,showing_requested,showing_timing,preferred_showing_at,resolved_address,property_snapshot,request_key,status,stage,next_action,source,metadata)
  values(v_session,v_name,v_mobile,v_email,v_mode,v_showing,case when v_showing then coalesce(nullif(p_request->>'showing_timing',''),'asap') else 'report' end,v_preferred,coalesce(nullif(p_request->>'resolved_address',''),v_property),coalesce(p_request->'property_snapshot','{}'),v_key,'new',case when v_showing then 'showing_requested' when v_generate then 'report_requested' else 'manual_lead' end,'admin_assign_agent',case when p_manual then 'admin_manual' else 'website' end,jsonb_build_object('property_input',v_property,'listing_key',p_request->>'listing_key','lead_mode',v_mode,'showing_requested',v_showing,'generate_report',v_generate,'assignment_method','manual','page_url',p_request->>'page_url')) returning id into v_id;
  if v_generate then
    insert into public.property_reports(lead_id) values(v_id) returning id into v_report;
    insert into public.automation_jobs(lead_id,report_id,job_type,payload) values(v_id,v_report,'generate_report',jsonb_build_object('trigger','lead_created','report_mode','idx_ai','listing_key',p_request->>'listing_key'));
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload) values(v_id,v_report,'email_buyer',v_email,jsonb_build_object('wait_for_report',true));
  end if;
  if not p_manual then
    select nullif(trim(value #>> '{}'),'') into v_owner from public.app_settings where key='owner_notification_email';
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,status,payload) values(v_id,v_report,'email_recipient',v_owner,case when v_owner is null then 'blocked' else 'queued' end,jsonb_build_object('reason','new_lead_admin_alert'));
  end if;
  insert into public.lead_events(lead_id,event_type,actor_type,payload) values(v_id,'lead_captured',case when p_manual then 'admin' else 'buyer' end,jsonb_build_object('showing_requested',v_showing,'preferred_showing_at',v_preferred,'report_queued',v_generate));
  return jsonb_build_object('lead_id',v_id,'showing_requested',v_showing,'report_queued',v_generate,'duplicate',false);
end $$;
revoke all on function public.create_phase5_request(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.create_phase5_request(jsonb,boolean) to service_role;

create or replace function public.request_phase5_showing(p_lead_id uuid,p_preferred_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_lead public.leads%rowtype; v_owner text; v_agent text;
begin
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found or v_lead.status in ('closed','lost') then raise exception 'This request is no longer available'; end if;
  if p_preferred_at is null or p_preferred_at<now()+interval '30 minutes' or p_preferred_at>now()+interval '30 days' then raise exception 'Choose a future time within 30 days'; end if;
  if v_lead.status='appointment_confirmed' then raise exception 'Call the team to change your confirmed appointment'; end if;
  if v_lead.showing_requested and v_lead.preferred_showing_at=p_preferred_at then return jsonb_build_object('ok',true,'duplicate',true); end if;
  update public.leads set showing_requested=true,lead_mode='showing',showing_timing='preferred_time',preferred_showing_at=p_preferred_at,status='appointment_pending',stage='showing_requested',next_action='confirm_showing_time',updated_at=now(),metadata=metadata||jsonb_build_object('showing_requested',true,'lead_mode','showing') where id=p_lead_id;
  select nullif(trim(value #>> '{}'),'') into v_owner from public.app_settings where key='owner_notification_email';
  select email into v_agent from public.agents where id=v_lead.owner_agent_id;
  insert into public.automation_jobs(lead_id,job_type,recipient,payload) values(p_lead_id,'email_recipient',v_lead.email,jsonb_build_object('reason','buyer_showing_requested'));
  if v_owner is not null then insert into public.automation_jobs(lead_id,job_type,recipient,payload) values(p_lead_id,'email_recipient',v_owner,jsonb_build_object('reason','showing_time_requested')); end if;
  if v_agent is not null and v_agent is distinct from v_owner then insert into public.automation_jobs(lead_id,job_type,recipient,payload) values(p_lead_id,'email_recipient',v_agent,jsonb_build_object('reason','showing_time_requested')); end if;
  insert into public.lead_events(lead_id,event_type,actor_type,payload) values(p_lead_id,'showing_time_requested','buyer',jsonb_build_object('preferred_showing_at',p_preferred_at));
  return jsonb_build_object('ok',true,'duplicate',false);
end $$;
revoke all on function public.request_phase5_showing(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.request_phase5_showing(uuid,timestamptz) to service_role;

create or replace function public.remove_phase5_lead(p_lead_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_session uuid;
begin
  select analysis_session_id into v_session from public.leads where id=p_lead_id for update;
  if not found then return false; end if;
  perform 1 from public.automation_jobs where lead_id=p_lead_id for update;
  if exists(select 1 from public.automation_jobs where lead_id=p_lead_id and status='processing') then raise exception 'A report or email is processing. Wait until it finishes, then remove this lead'; end if;
  delete from public.leads where id=p_lead_id;
  delete from public.analysis_sessions where id=v_session and not exists(select 1 from public.leads where analysis_session_id=v_session);
  return true;
end $$;
revoke all on function public.remove_phase5_lead(uuid) from public,anon,authenticated;
grant execute on function public.remove_phase5_lead(uuid) to service_role;
