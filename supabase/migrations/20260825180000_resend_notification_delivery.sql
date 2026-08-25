insert into public.app_settings(key,value) values
  ('owner_notification_email','"leads@torontohousemarket.com"'::jsonb),
  ('notification_from_email','"notifications@updates.torontohousemarket.com"'::jsonb)
on conflict(key) do update set value=excluded.value,updated_at=now();

-- Buyer acknowledgement is immediate; the separate email_buyer job waits for a ready report.
create or replace function public.queue_buyer_confirmation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if nullif(trim(new.email),'') is not null then
    insert into public.automation_jobs(lead_id,job_type,recipient,payload)
    values(new.id,'email_recipient',lower(trim(new.email)),jsonb_build_object('reason','buyer_request_confirmation'));
  end if;
  return new;
end $$;
drop trigger if exists leads_queue_buyer_confirmation on public.leads;
create trigger leads_queue_buyer_confirmation after insert on public.leads for each row execute function public.queue_buyer_confirmation();

-- Queue owner confirmation and tell the previous agent when a lead is reassigned.
create or replace function public.queue_assignment_notifications()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner_email text; v_old_agent_email text; v_report_id uuid;
begin
  if new.owner_agent_id is not distinct from old.owner_agent_id then return new; end if;
  select nullif(trim(value #>> '{}'),'') into v_owner_email from public.app_settings where key='owner_notification_email';
  select id into v_report_id from public.property_reports where lead_id=new.id;
  if v_owner_email is not null then
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload)
    values(new.id,v_report_id,'email_recipient',v_owner_email,jsonb_build_object('reason','owner_assignment_confirmation','agent_id',new.owner_agent_id));
  end if;
  if old.owner_agent_id is not null and old.owner_agent_id is distinct from new.owner_agent_id then
    select nullif(trim(email),'') into v_old_agent_email from public.agents where id=old.owner_agent_id;
    if v_old_agent_email is not null then
      insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload)
      values(new.id,v_report_id,'email_recipient',v_old_agent_email,jsonb_build_object('reason','agent_reassignment_removed'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_queue_assignment_notifications on public.leads;
create trigger leads_queue_assignment_notifications after update of owner_agent_id on public.leads for each row execute function public.queue_assignment_notifications();

-- Important status changes notify the owner; confirmed appointments also notify the buyer.
create or replace function public.queue_status_notifications()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner_email text; v_report_id uuid;
begin
  if new.status is not distinct from old.status or new.status not in ('appointment_confirmed','closed','lost') then return new; end if;
  select nullif(trim(value #>> '{}'),'') into v_owner_email from public.app_settings where key='owner_notification_email';
  select id into v_report_id from public.property_reports where lead_id=new.id;
  if v_owner_email is not null then
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload)
    values(new.id,v_report_id,'email_recipient',v_owner_email,jsonb_build_object('reason','owner_status_update','status',new.status));
  end if;
  if new.status='appointment_confirmed' and nullif(trim(new.email),'') is not null then
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload)
    values(new.id,v_report_id,'email_recipient',lower(trim(new.email)),jsonb_build_object('reason','buyer_appointment_confirmed'));
  end if;
  return new;
end $$;
drop trigger if exists leads_queue_status_notifications on public.leads;
create trigger leads_queue_status_notifications after update of status on public.leads for each row execute function public.queue_status_notifications();

-- Resend only accepts email destinations. Keep mobile-only agent jobs visible as blocked.
create or replace function public.validate_email_job_recipient()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.job_type in ('notify_agent','email_recipient','email_buyer') and
     (new.recipient is null or new.recipient !~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$') then
    new.status:='blocked'; new.last_error:='A valid email destination is required.';
  end if;
  return new;
end $$;
drop trigger if exists automation_jobs_validate_email_recipient on public.automation_jobs;
create trigger automation_jobs_validate_email_recipient before insert or update of recipient,status on public.automation_jobs for each row execute function public.validate_email_job_recipient();

create or replace function public.queue_overdue_sla_notifications()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lead record; v_owner_email text; v_report_id uuid; v_count integer:=0;
begin
  select nullif(trim(value #>> '{}'),'') into v_owner_email from public.app_settings where key='owner_notification_email';
  for v_lead in select l.* from public.leads l where l.status='new' and l.owner_agent_id is not null and l.first_response_due_at<=now() and not coalesce((l.metadata->>'sla_alert_queued')::boolean,false) for update skip locked loop
    select id into v_report_id from public.property_reports where lead_id=v_lead.id;
    if v_owner_email is not null then insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload) values(v_lead.id,v_report_id,'email_recipient',v_owner_email,jsonb_build_object('reason','owner_sla_overdue')); end if;
    insert into public.automation_jobs(lead_id,report_id,job_type,recipient,payload)
      select v_lead.id,v_report_id,'notify_agent',a.email,jsonb_build_object('reason','agent_sla_reminder') from public.agents a where a.id=v_lead.owner_agent_id;
    update public.leads set metadata=metadata||jsonb_build_object('sla_alert_queued',true,'sla_alert_queued_at',now()),updated_at=now() where id=v_lead.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.claim_email_jobs(p_limit integer default 10)
returns setof public.automation_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.automation_jobs set status='queued',locked_at=null,available_at=now(),updated_at=now(),last_error='Recovered stale processing lock.'
  where status='processing' and locked_at<now()-interval '10 minutes' and attempts<3;
  return query with candidates as (
    select j.id from public.automation_jobs j left join public.property_reports r on r.id=j.report_id
    where j.status='queued' and j.available_at<=now() and j.attempts<3
      and j.job_type in ('notify_agent','email_recipient','email_buyer')
      and (j.job_type<>'email_buyer' or r.status='ready')
    order by j.available_at,j.id limit greatest(1,least(coalesce(p_limit,10),25)) for update of j skip locked
  ) update public.automation_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),updated_at=now()
    from candidates c where j.id=c.id returning j.*;
end $$;

create or replace function public.complete_email_job(p_job_id bigint,p_provider_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.automation_jobs set status='sent',completed_at=now(),locked_at=null,last_error=null,updated_at=now(),payload=payload||jsonb_build_object('provider','resend','provider_id',p_provider_id) where id=p_job_id and status='processing'; end $$;

create or replace function public.fail_email_job(p_job_id bigint,p_error text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.automation_jobs set status=case when attempts>=3 then 'failed' else 'queued' end,available_at=now()+make_interval(mins=>case when attempts>=3 then 0 else attempts*2 end),locked_at=null,last_error=left(coalesce(p_error,'Email delivery failed.'),500),updated_at=now() where id=p_job_id and status='processing'; end $$;

revoke all on function public.queue_buyer_confirmation(),public.queue_assignment_notifications(),public.queue_status_notifications(),public.validate_email_job_recipient(),public.queue_overdue_sla_notifications(),public.claim_email_jobs(integer),public.complete_email_job(bigint,text),public.fail_email_job(bigint,text) from public,anon,authenticated;
grant execute on function public.queue_overdue_sla_notifications(),public.claim_email_jobs(integer),public.complete_email_job(bigint,text),public.fail_email_job(bigint,text) to service_role;
