-- Admin-only controls. Public lead intake, valuation and schedulers are unchanged.
alter table public.leads add column if not exists archived_at timestamptz;
create index if not exists leads_admin_archive_created_idx on public.leads(archived_at,created_at desc);
alter table public.automation_jobs drop constraint automation_jobs_status_check;
alter table public.automation_jobs add constraint automation_jobs_status_check check (status in ('queued','processing','sent','completed','blocked','failed','cancelled'));
alter table public.property_reports drop constraint property_reports_status_check;
alter table public.property_reports add constraint property_reports_status_check check (status in ('queued','generating','ready','failed','cancelled'));
-- Preserve existing recipient validation for every pre-existing status.
drop trigger automation_jobs_validate_email_recipient on public.automation_jobs;
create trigger automation_jobs_validate_email_recipient before insert or update of recipient,status on public.automation_jobs for each row when (new.status <> 'cancelled') execute function public.validate_email_job_recipient();

create or replace function public.admin_ops_lead_action(p_ids uuid[],p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_result jsonb:='[]'; v_found uuid; v_busy boolean;
begin
 if p_action not in ('archive','restore','delete') or coalesce(cardinality(p_ids),0) not between 1 and 1000 then raise exception 'Choose 1–1000 leads and a valid action'; end if;
 for v_id in select distinct unnest(p_ids) order by 1 loop
  begin
   select id into v_found from public.leads where id=v_id for update nowait;
   if not found then v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason','Lead no longer exists'); continue; end if;
   if p_action='delete' then
    perform public.remove_phase5_lead(v_id);
   else
    update public.leads set archived_at=case when p_action='archive' then now() else null end,updated_at=now() where id=v_id;
    insert into public.lead_events(lead_id,event_type,actor_type,payload) values(v_id,'admin_'||p_action,'admin','{}');
   end if;
   v_result:=v_result||jsonb_build_object('id',v_id,'ok',true);
  exception when lock_not_available then v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason','Busy; refresh and try again');
   when others then v_result:=v_result||jsonb_build_object('id',v_id,'ok',false,'reason',case when sqlerrm like '%processing%' then 'A report or email is processing; wait until it finishes' else 'This lead could not be changed' end);
  end;
 end loop;
 return jsonb_build_object('results',v_result);
end $$;

create or replace function public.admin_ops_cancel_jobs(p_ids bigint[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id bigint; v_job public.automation_jobs%rowtype; v_result jsonb:='[]'; v_dependent integer;
begin
 if coalesce(cardinality(p_ids),0) not between 1 and 1000 then raise exception 'Choose 1–1000 jobs'; end if;
 for v_id in select distinct unnest(p_ids) order by 1 loop
  begin
   select * into v_job from public.automation_jobs where id=v_id for update nowait;
   if not found then v_result:=v_result||jsonb_build_object('id',v_id::text,'ok',false,'reason','Job no longer exists'); continue; end if;
   if v_job.status not in ('queued','blocked','failed') then v_result:=v_result||jsonb_build_object('id',v_id::text,'ok',false,'reason','Only waiting, blocked or failed jobs can be cancelled'); continue; end if;
   v_dependent:=0;
   if v_job.job_type='generate_report' and v_job.report_id is not null then
    perform 1 from public.automation_jobs where report_id=v_job.report_id order by id for update nowait;
    if exists(select 1 from public.automation_jobs where report_id=v_job.report_id and status='processing') then
     v_result:=v_result||jsonb_build_object('id',v_id::text,'ok',false,'reason','A related report or email is processing'); continue;
    end if;
    update public.automation_jobs set status='cancelled',locked_at=null,updated_at=now(),last_error='Cancelled with report by administrator',payload=payload||jsonb_build_object('cancelled_at',now(),'cancelled_by','admin') where report_id=v_job.report_id and job_type='email_buyer' and status in ('queued','blocked','failed');
    get diagnostics v_dependent=row_count;
    update public.property_reports set status='cancelled',error_message='Cancelled by administrator',updated_at=now() where id=v_job.report_id and status<>'ready';
   end if;
   update public.automation_jobs set status='cancelled',locked_at=null,updated_at=now(),last_error='Cancelled by administrator',payload=payload||jsonb_build_object('cancelled_at',now(),'cancelled_by','admin') where id=v_id;
   insert into public.lead_events(lead_id,event_type,actor_type,payload) values(v_job.lead_id,'admin_job_cancelled','admin',jsonb_build_object('job_id',v_id,'dependent_emails_cancelled',v_dependent));
   v_result:=v_result||jsonb_build_object('id',v_id::text,'ok',true,'dependent_emails_cancelled',v_dependent);
  exception when lock_not_available or deadlock_detected then v_result:=v_result||jsonb_build_object('id',v_id::text,'ok',false,'reason','Job is busy; refresh and try again');
  end;
 end loop;
 return jsonb_build_object('results',v_result);
end $$;

create or replace function public.admin_ops_create_agent(p_name text,p_email text,p_mobile text,p_active boolean default true)
returns public.agents language plpgsql security invoker set search_path='' as $$
declare v_base text; v_code text; v_n integer:=2; v_order integer; v_agent public.agents;
begin
 if char_length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Enter the agent’s full name'; end if;
 if coalesce(p_email,'')<>'' and p_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 lock table public.agents in share row exclusive mode;
 if exists(select 1 from public.agents where lower(trim(display_name))=lower(trim(p_name)) and coalesce(lower(email),'')=coalesce(lower(nullif(trim(p_email),'')),'')) then raise exception 'This agent already exists. Edit the existing agent instead'; end if;
 v_base:=left(trim(both '_' from regexp_replace(lower(trim(p_name)),'[^a-z0-9]+','_','g')),50);
 if v_base='' then v_base:='agent'; end if; v_code:=v_base;
 while exists(select 1 from public.agents where code=v_code) loop v_code:=v_base||'_'||v_n;v_n:=v_n+1;end loop;
 select coalesce(max(assignment_order),0)+1 into v_order from public.agents;
 insert into public.agents(code,display_name,email,mobile,active,assignment_order) values(v_code,trim(p_name),nullif(lower(trim(p_email)),''),nullif(trim(p_mobile),''),coalesce(p_active,true),v_order) returning * into v_agent;
 return v_agent;
end $$;

create or replace function public.admin_ops_counts()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('active',(select count(*) from public.leads where archived_at is null),'archived',(select count(*) from public.leads where archived_at is not null),'new',(select count(*) from public.leads where archived_at is null and status='new'),'unassigned',(select count(*) from public.leads where archived_at is null and owner_agent_id is null),'queue',(select coalesce(jsonb_object_agg(s,n),'{}') from (select status s,count(*) n from public.automation_jobs group by status)q));
$$;
revoke all on function public.admin_ops_lead_action(uuid[],text),public.admin_ops_cancel_jobs(bigint[]),public.admin_ops_create_agent(text,text,text,boolean),public.admin_ops_counts() from public,anon,authenticated;
grant execute on function public.admin_ops_lead_action(uuid[],text),public.admin_ops_cancel_jobs(bigint[]),public.admin_ops_create_agent(text,text,text,boolean),public.admin_ops_counts() to service_role;
-- Queue recovery belongs to the existing server scheduler, never public clients.
revoke execute on function public.recover_stale_report_jobs() from public,anon,authenticated;
grant execute on function public.recover_stale_report_jobs() to service_role;
notify pgrst,'reload schema';
