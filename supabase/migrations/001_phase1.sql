create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key,value) values
  ('first_response_sla_minutes','5'::jsonb),
  ('service_hours','{"timezone":"America/Toronto","start":"09:00","end":"21:00","days":[0,1,2,3,4,5,6]}'::jsonb),
  ('assignment_method','"round_robin"'::jsonb),
  ('reassignment_minutes','5'::jsonb),
  ('cashback_max_cad','10000'::jsonb),
  ('service_area','["Toronto","York","Peel","Durham","Halton"]'::jsonb)
on conflict (key) do nothing;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  display_name text not null,
  active boolean not null default true,
  assignment_order integer not null unique,
  mobile text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.agents(code,display_name,assignment_order)
values ('agent_a','Agent A',1),('agent_b','Agent B',2)
on conflict (code) do nothing;

create table if not exists public.round_robin_state (
  id boolean primary key default true check (id),
  last_assignment_order integer,
  updated_at timestamptz not null default now()
);
insert into public.round_robin_state(id,last_assignment_order) values (true,null) on conflict do nothing;

create table if not exists public.analysis_sessions (
  id uuid primary key default gen_random_uuid(),
  property_input text not null,
  listing_key text,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  analysis_session_id uuid not null references public.analysis_sessions(id) on delete cascade,
  name text not null,
  mobile text not null,
  email text,
  showing_timing text not null default 'asap',
  status text not null default 'new',
  owner_agent_id uuid references public.agents(id),
  stage text not null default 'new',
  next_action text not null default 'contact_buyer',
  next_action_at timestamptz not null default now(),
  first_response_due_at timestamptz,
  source text not null default 'website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists leads_owner_agent_id_idx on public.leads(owner_agent_id);
create index if not exists leads_next_action_at_idx on public.leads(next_action_at);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists lead_events_lead_id_idx on public.lead_events(lead_id);
create index if not exists analysis_sessions_listing_key_idx on public.analysis_sessions(listing_key);

alter table public.app_settings enable row level security;
alter table public.agents enable row level security;
alter table public.round_robin_state enable row level security;
alter table public.analysis_sessions enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

create or replace function public.create_lead_and_assign(
  p_property_input text,
  p_listing_key text,
  p_name text,
  p_mobile text,
  p_email text,
  p_showing_timing text,
  p_page_url text,
  p_referrer text
)
returns table(lead_id uuid, agent_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_analysis_id uuid;
  v_agent_id uuid;
  v_agent_order integer;
  v_last_order integer;
  v_sla integer := 5;
begin
  select coalesce((value #>> '{}')::integer,5)
    into v_sla
  from app_settings
  where key='first_response_sla_minutes';

  select last_assignment_order
    into v_last_order
  from round_robin_state
  where id=true
  for update;

  select a.id, a.assignment_order
    into v_agent_id, v_agent_order
  from agents a
  where a.active=true
    and (v_last_order is null or a.assignment_order > v_last_order)
  order by a.assignment_order asc
  limit 1;

  if v_agent_id is null then
    select a.id, a.assignment_order
      into v_agent_id, v_agent_order
    from agents a
    where a.active=true
    order by a.assignment_order asc
    limit 1;
  end if;

  if v_agent_id is null then
    raise exception 'No active agent available';
  end if;

  insert into analysis_sessions(property_input, listing_key)
  values (p_property_input,p_listing_key)
  returning id into v_analysis_id;

  insert into leads(
    analysis_session_id,name,mobile,email,showing_timing,
    owner_agent_id,first_response_due_at,metadata
  )
  values(
    v_analysis_id,p_name,p_mobile,nullif(p_email,''),coalesce(nullif(p_showing_timing,''),'asap'),
    v_agent_id,now() + make_interval(mins=>v_sla),
    jsonb_build_object('page_url',p_page_url,'referrer',p_referrer)
  )
  returning id into lead_id;

  update round_robin_state
  set last_assignment_order=v_agent_order,updated_at=now()
  where id=true;

  insert into lead_events(lead_id,event_type,payload)
  values
    (lead_id,'lead_captured',jsonb_build_object('showing_timing',p_showing_timing)),
    (lead_id,'agent_assigned',jsonb_build_object('agent_id',v_agent_id,'assignment_order',v_agent_order,'sla_minutes',v_sla));

  agent_id := v_agent_id;
  return next;
end;
$$;

revoke all on function public.create_lead_and_assign(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_lead_and_assign(text,text,text,text,text,text,text,text) to service_role;
