-- Admin-only reporting and controls. No public forms, report generation or sender changes.
create function public.admin_ops_agents() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('assignmentMethod',(select value #>> '{}' from public.app_settings where key='assignment_method'),
 'agents',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('assigned_leads',(select count(*) from public.leads l where l.owner_agent_id=a.id)) order by a.assignment_order) from public.agents a),'[]'::jsonb));
$$;

create function public.admin_ops_delete_agent(p_agent_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.agents; n integer;
begin
 select * into a from public.agents where id=p_agent_id for update nowait;
 if not found then raise exception 'Agent no longer exists. Refresh the team list'; end if;
 select count(*) into n from public.leads where owner_agent_id=p_agent_id;
 if n>0 then raise exception 'This agent has % assigned leads. Reassign or unassign those leads before deleting the agent',n; end if;
 perform 1 from public.automation_jobs where job_type='notify_agent' and payload->>'agent_code'=a.code order by id for update nowait;
 if exists(select 1 from public.automation_jobs where job_type='notify_agent' and payload->>'agent_code'=a.code and status='processing') then raise exception 'An agent notification is processing. Wait until it finishes'; end if;
 with cancelled as (
 update public.automation_jobs set status='cancelled',locked_at=null,updated_at=now(),last_error='Agent removed by administrator'
 where job_type='notify_agent' and payload->>'agent_code'=a.code and status in ('queued','blocked','failed') returning lead_id,id)
 insert into public.lead_events(lead_id,event_type,actor_type,payload) select lead_id,'admin_agent_removed','admin',jsonb_build_object('agent_id',p_agent_id,'agent_name',a.display_name,'cancelled_job',id) from cancelled;
 delete from public.agents where id=p_agent_id;
 return jsonb_build_object('deleted',true,'id',p_agent_id);
exception when lock_not_available then raise exception 'This agent is busy. Refresh and try again';
end $$;

create function public.admin_ops_assign_leads(p_ids uuid[],p_agent_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_lead public.leads; result jsonb:='[]';
begin
 if coalesce(cardinality(p_ids),0) not between 1 and 1000 then raise exception 'Choose 1–1000 leads'; end if;
 if p_agent_id is not null then
  perform 1 from public.agents where id=p_agent_id and active for update nowait;
  if not found then raise exception 'Choose an available agent'; end if;
 end if;
 for v_id in select distinct unnest(p_ids) order by 1 loop
  begin
   select * into v_lead from public.leads where id=v_id for update nowait;
   if not found then result:=result||jsonb_build_object('id',v_id,'ok',false,'reason','Lead no longer exists');continue;end if;
   if v_lead.owner_agent_id is not distinct from p_agent_id then result:=result||jsonb_build_object('id',v_id,'ok',true,'unchanged',true);continue;end if;
   -- Prevent a former agent receiving an unsent assignment after reassignment.
   perform 1 from public.automation_jobs where lead_id=v_id and job_type='notify_agent' order by id for update nowait;
   if exists(select 1 from public.automation_jobs where lead_id=v_id and job_type='notify_agent' and status='processing') then
    result:=result||jsonb_build_object('id',v_id,'ok',false,'reason','Agent notification is processing');continue;
   end if;
   update public.automation_jobs set status='cancelled',locked_at=null,updated_at=now(),last_error='Superseded by administrator assignment'
    where lead_id=v_id and job_type='notify_agent' and status in ('queued','blocked','failed');
   if p_agent_id is null then
    update public.leads set owner_agent_id=null,first_response_due_at=null,next_action='admin_assign_agent',next_action_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('assigned_by','admin','assigned_at',now()) where id=v_id;
    insert into public.lead_events(lead_id,event_type,actor_type,payload) values(v_id,'admin_agent_unassigned','admin',jsonb_build_object('previous_agent_id',v_lead.owner_agent_id));
   else perform public.assign_lead_to_agent(v_id,p_agent_id);end if;
   result:=result||jsonb_build_object('id',v_id,'ok',true);
  exception when lock_not_available or deadlock_detected then result:=result||jsonb_build_object('id',v_id,'ok',false,'reason','Lead is busy. Refresh and try again');
  end;
 end loop;
 return jsonb_build_object('results',result);
end $$;

create function public.admin_ops_export_leads(p_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_ids),0) not between 1 and 1000 then raise exception 'Choose 1–1000 leads to export';end if;
 return jsonb_build_object('leads',coalesce((select jsonb_agg(jsonb_build_object(
 'id',l.id,'name',l.name,'email',l.email,'mobile',l.mobile,'resolved_address',l.resolved_address,
 'lead_mode',l.lead_mode,'status',l.status,'stage',l.stage,'created_at',l.created_at,'archived_at',l.archived_at,
 'showing_requested',l.showing_requested,'preferred_showing_at',l.preferred_showing_at,'confirmed_showing_at',l.confirmed_showing_at,
 'source',l.source,'owner_agent_id',l.owner_agent_id,'agents',case when a.id is null then null else jsonb_build_object('display_name',a.display_name,'email',a.email) end,
 'property_snapshot',l.property_snapshot,'assignment',jsonb_build_object('by',l.metadata->>'assigned_by','at',l.metadata->>'assigned_at'),
 'seller_marketing',public.admin_seller_marketing_status(l.id),
 'report',case when r.id is null then null else jsonb_build_object('status',r.status,'generated_at',r.generated_at,'valuation',r.report_payload->'valuation') end
 ) order by l.created_at desc,l.id) from public.leads l left join public.agents a on a.id=l.owner_agent_id left join public.property_reports r on r.lead_id=l.id where l.id=any(p_ids)),'[]'::jsonb));
end $$;

create function public.admin_ops_marketing_list(p_page integer default 1,p_query text default '',p_status text default '') returns jsonb
language sql stable security invoker set search_path='' as $$
 with contacts as (
 select s.email,s.suppressed_at,c.consent_at,c.wording,c.version,c.source,c.lead_id,l.name,
 j.id as job_id,j.status,j.created_at,j.available_at,j.sent_at,j.attempts,j.last_error,
 (l.id is not null) as lead_available
 from public.seller_marketing_contacts s
 join lateral (select * from public.seller_marketing_consents c where c.email=s.email order by consent_at desc,id desc limit 1)c on true
 left join public.leads l on l.id=c.lead_id
 left join public.seller_marketing_jobs j on j.email=s.email and j.campaign='seller-strategy-fees-v1'
 where (p_query='' or strpos(lower(s.email||' '||coalesce(l.name,'')),lower(left(p_query,120)))>0)
 and (p_status='' or (p_status='opted_in' and s.suppressed_at is null) or (p_status='unsubscribed' and s.suppressed_at is not null) or (p_status='failed' and j.status='failed') or (p_status='queued' and j.status in ('queued','processing')))
 ), page as (select * from contacts order by consent_at desc,email limit 25 offset (greatest(1,least(coalesce(p_page,1),100000))-1)*25)
 select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from contacts),'page',greatest(1,p_page),'size',25,
 'summary',jsonb_build_object('opted_in',(select count(*) from public.seller_marketing_contacts where suppressed_at is null),'unsubscribed',(select count(*) from public.seller_marketing_contacts where suppressed_at is not null),'waiting',(select count(*) from public.seller_marketing_jobs where status in ('queued','processing')),'sent',(select count(*) from public.seller_marketing_jobs where sent_at is not null),'failed',(select count(*) from public.seller_marketing_jobs where status='failed')));
$$;

create function public.admin_ops_marketing_unsubscribe(p_email text) returns boolean
language sql security invoker set search_path='' as $$
 select public.unsubscribe_seller_marketing(unsubscribe_token) from public.seller_marketing_contacts where email=lower(trim(p_email));
$$;

create function public.admin_ops_analytics(p_from date,p_to date,p_include_tests boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; start_at timestamptz; end_at timestamptz;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'Choose a date range of up to 366 days';end if;
 start_at:=p_from::timestamp at time zone 'America/Toronto';end_at:=(p_to+1)::timestamp at time zone 'America/Toronto';
 with eligible as (
  select * from public.leads where p_include_tests or (source<>'admin_test' and coalesce(metadata->>'admin_test','false') not in ('true','1'))
 ), captured as (select * from eligible where created_at>=start_at and created_at<end_at),
 reports as (select r.generated_at from public.property_reports r join eligible l on l.id=r.lead_id where r.generated_at>=start_at and r.generated_at<end_at and r.status='ready'),
 emails as (select j.completed_at from public.automation_jobs j join eligible l on l.id=j.lead_id where j.completed_at>=start_at and j.completed_at<end_at and j.status='sent' and j.job_type<>'generate_report'),
 marketing as (select j.sent_at from public.seller_marketing_jobs j left join public.leads l on l.id=j.lead_id where j.sent_at>=start_at and j.sent_at<end_at and (p_include_tests or l.id is null or (l.source<>'admin_test' and coalesce(l.metadata->>'admin_test','false') not in ('true','1')))),
 consents as (select c.consent_at from public.seller_marketing_consents c left join public.leads l on l.id=c.lead_id where c.consent_at>=start_at and c.consent_at<end_at and (p_include_tests or l.id is null or (l.source<>'admin_test' and coalesce(l.metadata->>'admin_test','false') not in ('true','1')))),
 days as (select p_from+i as day from generate_series(0,p_to-p_from)i),
 daily as (select day,
  (select count(*) from captured where (created_at at time zone 'America/Toronto')::date=day) as leads,
  (select count(*) from reports where (generated_at at time zone 'America/Toronto')::date=day) as reports,
  (select count(*) from emails where (completed_at at time zone 'America/Toronto')::date=day) as emails,
  (select count(*) from marketing where (sent_at at time zone 'America/Toronto')::date=day) as marketing,
  (select count(*) from consents where (consent_at at time zone 'America/Toronto')::date=day) as opt_ins from days),
 types as (select case when lead_mode='seller' then 'Seller reports' when showing_requested then 'Showing requests' else 'Buyer reports / enquiries' end label,count(*) value from captured group by 1),
 sources as (select case when source='admin_manual' then 'Added by admin' when lower(coalesce(metadata->>'referrer','')) like '%instagram.%' then 'Instagram referral' when lower(coalesce(metadata->>'referrer','')) like '%facebook.%' then 'Facebook referral' when lower(coalesce(metadata->>'referrer','')) like '%google.%' then 'Google referral' when coalesce(metadata->>'referrer','')='' then 'Direct / not recorded' when lower(metadata->>'referrer') like '%torontohousemarket.com%' then 'THM website' else 'Other referral' end label,count(*) value from captured group by 1)
 select jsonb_build_object('from',p_from,'to',p_to,'timezone','America/Toronto','daily',(select jsonb_agg(to_jsonb(daily) order by day) from daily),
 'totals',jsonb_build_object('leads',(select count(*) from captured),'reports',(select count(*) from reports),'emails',(select count(*) from emails),'marketing',(select count(*) from marketing),'opt_ins',(select count(*) from consents)),
 'types',coalesce((select jsonb_agg(to_jsonb(types) order by value desc) from types),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(sources) order by value desc) from sources),'[]'::jsonb),
 'assignmentMethod',(select value #>> '{}' from public.app_settings where key='assignment_method'),
 'unassigned',(select count(*) from eligible where owner_agent_id is null and archived_at is null),
 'tracking',jsonb_build_object('shares',false,'visits',false)) into result;
 return result;
end $$;

revoke all on function public.admin_ops_agents(),public.admin_ops_delete_agent(uuid),public.admin_ops_assign_leads(uuid[],uuid),public.admin_ops_export_leads(uuid[]),public.admin_ops_marketing_list(integer,text,text),public.admin_ops_marketing_unsubscribe(text),public.admin_ops_analytics(date,date,boolean) from public,anon,authenticated;
grant execute on function public.admin_ops_agents(),public.admin_ops_delete_agent(uuid),public.admin_ops_assign_leads(uuid[],uuid),public.admin_ops_export_leads(uuid[]),public.admin_ops_marketing_list(integer,text,text),public.admin_ops_marketing_unsubscribe(text),public.admin_ops_analytics(date,date,boolean) to service_role;
notify pgrst,'reload schema';
