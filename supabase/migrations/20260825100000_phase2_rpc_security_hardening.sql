revoke all on function public.create_lead_v2(text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_lead_v2(text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;
revoke all on function public.create_lead_v3(text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_lead_v3(text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create index if not exists automation_jobs_lead_id_idx on public.automation_jobs(lead_id);
create index if not exists automation_jobs_report_id_idx on public.automation_jobs(report_id);
