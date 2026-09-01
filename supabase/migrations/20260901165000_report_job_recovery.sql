-- Keep report retries bounded while making an intentional restart atomic.

create or replace function public.claim_report_jobs(p_limit integer default 3)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  with exhausted as (
    update public.automation_jobs
    set status='failed',
        locked_at=null,
        completed_at=null,
        updated_at=now(),
        last_error=coalesce(last_error,'Report generation stopped after the maximum number of attempts.')
    where job_type='generate_report'
      and status='processing'
      and locked_at<now()-interval '2 minutes'
      and attempts>=3
    returning report_id,last_error
  )
  update public.property_reports r
  set status='failed',
      error_message=left(coalesce(e.last_error,'Report generation stopped after the maximum number of attempts.'),500),
      updated_at=now()
  from exhausted e
  where r.id=e.report_id;

  update public.automation_jobs
  set status='queued',
      locked_at=null,
      available_at=now(),
      updated_at=now(),
      last_error='Recovered interrupted report generation.'
  where job_type='generate_report'
    and status='processing'
    and locked_at<now()-interval '2 minutes'
    and attempts<3;

  return query
  with candidates as (
    select j.id
    from public.automation_jobs j
    join public.property_reports r on r.id=j.report_id
    where j.job_type='generate_report'
      and j.status='queued'
      and j.payload->>'report_mode'='idx_ai'
      and j.available_at<=now()
      and j.attempts<3
      and r.status in ('queued','generating','failed')
    order by j.available_at,j.id
    limit greatest(1,least(coalesce(p_limit,3),5))
    for update of j skip locked
  ), claimed as (
    update public.automation_jobs j
    set status='processing',
        attempts=j.attempts+1,
        locked_at=now(),
        updated_at=now()
    from candidates c
    where j.id=c.id
    returning j.*
  ), reports as (
    update public.property_reports r
    set status='generating',error_message=null,updated_at=now()
    where r.id in (select report_id from claimed)
    returning r.id
  )
  select c.* from claimed c;
end
$$;

create or replace function public.restart_report_job(p_job_id bigint,p_report_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.automation_jobs
  set status='queued',
      attempts=0,
      available_at=now(),
      locked_at=null,
      completed_at=null,
      last_error=null,
      updated_at=now()
  where id=p_job_id
    and report_id=p_report_id
    and job_type='generate_report';

  if not found then
    raise exception 'Report job does not match the requested report.';
  end if;

  update public.property_reports
  set status='queued',
      report_payload='{}'::jsonb,
      generated_at=null,
      error_message=null,
      updated_at=now()
  where id=p_report_id;

  if not found then
    raise exception 'Property report was not found.';
  end if;
end
$$;

revoke all on function public.claim_report_jobs(integer),public.restart_report_job(bigint,uuid)
from public,anon,authenticated;

grant execute on function public.claim_report_jobs(integer),public.restart_report_job(bigint,uuid)
to service_role;
