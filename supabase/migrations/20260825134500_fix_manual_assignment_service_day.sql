-- service_hours.days is stored as numeric JSON values, so inspect array values rather than object keys.
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
  update public.leads set owner_agent_id=v_agent.id,first_response_due_at=v_due,next_action='agent_contact_buyer',next_action_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('assigned_by','admin','assigned_at',now()) where id=p_lead_id;
  select id into v_report_id from public.property_reports where property_reports.lead_id=p_lead_id;
  insert into public.automation_jobs(lead_id,report_id,job_type,recipient,status,payload) values(p_lead_id,v_report_id,'notify_agent',coalesce(nullif(v_agent.email,''),nullif(v_agent.mobile,'')),case when coalesce(nullif(v_agent.email,''),nullif(v_agent.mobile,'')) is null then 'blocked' else 'queued' end,jsonb_build_object('reason','admin_assignment','agent_code',v_agent.code));
  insert into public.lead_events(lead_id,event_type,actor_type,payload) values(p_lead_id,'admin_agent_assigned','admin',jsonb_build_object('agent_id',v_agent.id,'agent_code',v_agent.code,'sla_minutes',v_sla));
  lead_id:=p_lead_id;agent_id:=v_agent.id;agent_code:=v_agent.code;response_due_at:=v_due;queued_after_hours:=not v_open;return next;
end $$;
revoke all on function public.assign_lead_to_agent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_lead_to_agent(uuid,uuid) to service_role;
