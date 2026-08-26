-- Atomically claim, complete and retry AI property-report jobs.
create or replace function public.claim_report_jobs(p_limit integer default 3)
returns setof public.automation_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.automation_jobs
  set status='queued',locked_at=null,available_at=now(),updated_at=now(),last_error='Recovered stale report lock.'
  where job_type='generate_report' and status='processing'
    and locked_at<now()-interval '10 minutes' and attempts<3;

  return query with candidates as (
    select j.id
    from public.automation_jobs j
    join public.property_reports r on r.id=j.report_id
    where j.job_type='generate_report' and j.status='queued'
      and j.available_at<=now() and j.attempts<3
      and r.status in ('queued','generating','failed')
    order by j.available_at,j.id
    limit greatest(1,least(coalesce(p_limit,3),5))
    for update of j skip locked
  ), claimed as (
    update public.automation_jobs j
    set status='processing',attempts=j.attempts+1,locked_at=now(),updated_at=now()
    from candidates c where j.id=c.id returning j.*
  ), reports as (
    update public.property_reports r
    set status='generating',error_message=null,updated_at=now()
    where r.id in (select report_id from claimed) returning r.id
  ) select c.* from claimed c;
end $$;

create or replace function public.complete_report_job(p_job_id bigint,p_report_id uuid,p_report_payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.property_reports
  set status='ready',report_payload=coalesce(p_report_payload,'{}'::jsonb),
      generated_at=now(),error_message=null,updated_at=now()
  where id=p_report_id;
  update public.automation_jobs
  set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now()
  where id=p_job_id and status='processing';
end $$;

create or replace function public.fail_report_job(p_job_id bigint,p_report_id uuid,p_error text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_attempts integer;
begin
  select attempts into v_attempts from public.automation_jobs where id=p_job_id;
  update public.automation_jobs
  set status=case when coalesce(v_attempts,3)>=3 then 'failed' else 'queued' end,
      available_at=now()+make_interval(mins=>case when coalesce(v_attempts,3)>=3 then 0 else greatest(1,v_attempts*2) end),
      locked_at=null,last_error=left(coalesce(p_error,'Report generation failed.'),500),updated_at=now()
  where id=p_job_id and status='processing';
  update public.property_reports
  set status=case when coalesce(v_attempts,3)>=3 then 'failed' else 'queued' end,
      error_message=left(coalesce(p_error,'Report generation failed.'),500),updated_at=now()
  where id=p_report_id;
end $$;

revoke all on function public.claim_report_jobs(integer),public.complete_report_job(bigint,uuid,jsonb),public.fail_report_job(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_report_jobs(integer),public.complete_report_job(bigint,uuid,jsonb),public.fail_report_job(bigint,uuid,text) to service_role;
