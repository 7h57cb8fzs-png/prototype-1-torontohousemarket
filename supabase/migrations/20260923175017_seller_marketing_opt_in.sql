-- Additive, service-role-only marketing records. No historical lead backfill.
create table public.seller_marketing_contacts (
  email text primary key check (email = lower(trim(email))),
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  suppressed_at timestamptz
);
create table public.seller_marketing_consents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references public.leads(id) on delete set null,
  email text not null references public.seller_marketing_contacts(email),
  wording text not null,
  version text not null,
  source text not null,
  consent_at timestamptz not null default now()
);
create index seller_marketing_consents_email_idx on public.seller_marketing_consents(email);
create table public.seller_marketing_jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  consent_id uuid not null references public.seller_marketing_consents(id),
  email text not null references public.seller_marketing_contacts(email),
  campaign text not null default 'seller-strategy-fees-v1',
  status text not null default 'queued' check (status in ('queued','processing','sent','suppressed','failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  last_error text,
  frozen_email jsonb,
  unique (email,campaign)
);
create index seller_marketing_jobs_lead_idx on public.seller_marketing_jobs(lead_id);
create index seller_marketing_jobs_consent_idx on public.seller_marketing_jobs(consent_id);
create index seller_marketing_jobs_ready_idx on public.seller_marketing_jobs(available_at) where status in ('queued','processing');
alter table public.seller_marketing_contacts enable row level security;
alter table public.seller_marketing_consents enable row level security;
alter table public.seller_marketing_jobs enable row level security;
revoke all on public.seller_marketing_contacts,public.seller_marketing_consents,public.seller_marketing_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.seller_marketing_contacts,public.seller_marketing_consents,public.seller_marketing_jobs to service_role;

create function public.capture_seller_marketing_consent() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb := new.property_snapshot->'sellerProfile'; c_id uuid;
begin
  if new.lead_mode <> 'seller' or new.source <> 'website'
    or coalesce(p->'marketingConsent','false'::jsonb) <> 'true'::jsonb
    or p->>'marketingConsentVersion' is distinct from 'seller-strategy-fees-2026-09-23'
    then return new; end if;
  insert into public.seller_marketing_contacts(email) values(lower(trim(new.email))) on conflict do nothing;
  insert into public.seller_marketing_consents(lead_id,email,wording,version,source)
    values(new.id,lower(trim(new.email)),'Yes, email me your selling plan, listing fees and occasional selling tips.',
      'seller-strategy-fees-2026-09-23','https://torontohousemarket.com/seller') returning id into c_id;
  -- Suppression is durable: later requests never silently resubscribe an address.
  insert into public.seller_marketing_jobs(lead_id,consent_id,email,status)
    select new.id,c_id,c.email,case when c.suppressed_at is null then 'queued' else 'suppressed' end
    from public.seller_marketing_contacts c where c.email=lower(trim(new.email))
    on conflict(email,campaign) do nothing;
  return new;
end $$;
revoke all on function public.capture_seller_marketing_consent() from public,anon,authenticated;
grant execute on function public.capture_seller_marketing_consent() to service_role;
create trigger seller_marketing_opt_in after insert on public.leads for each row execute function public.capture_seller_marketing_consent();

create function public.claim_seller_marketing_jobs(p_limit integer default 3) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  update public.seller_marketing_jobs j set status='suppressed',locked_at=null
    where j.status in ('queued','processing') and (j.lead_id is null or exists(select 1 from public.seller_marketing_contacts c where c.email=j.email and c.suppressed_at is not null));
  -- Never cross Resend's 24-hour idempotency window on an uncertain send.
  update public.seller_marketing_jobs set status='failed',locked_at=null,last_error='Delivery requires review; safe automatic retry window ended.'
    where status in ('queued','processing') and (first_attempt_at < now()-interval '20 hours' or (attempts>=5 and (status='queued' or locked_at<now()-interval '5 minutes')));
  update public.seller_marketing_jobs set status='queued',locked_at=null,available_at=now()
    where status='processing' and locked_at<now()-interval '5 minutes' and attempts<5;
  with candidates as (
    select j.id from public.seller_marketing_jobs j
    join public.seller_marketing_contacts c on c.email=j.email
    join public.leads l on l.id=j.lead_id
    where j.status='queued' and j.available_at<=now() and j.attempts<5 and c.suppressed_at is null
      and l.lead_mode='seller' and l.email=j.email
      and exists(select 1 from public.automation_jobs r where r.lead_id=j.lead_id and r.job_type='email_buyer' and r.status='sent')
    order by j.available_at,j.id limit greatest(1,least(coalesce(p_limit,3),3)) for update of j skip locked
  ), claimed as (
    update public.seller_marketing_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),first_attempt_at=coalesce(j.first_attempt_at,now())
    from candidates c where j.id=c.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('unsubscribe_token',c.unsubscribe_token)),'[]'::jsonb) into result
    from claimed j join public.seller_marketing_contacts c on c.email=j.email;
  return result;
end $$;

create function public.prepare_seller_marketing_send(p_job_id uuid,p_attempt integer,p_message jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  update public.seller_marketing_jobs j set frozen_email=coalesce(j.frozen_email,p_message)
  where j.id=p_job_id and j.status='processing' and j.attempts=p_attempt and j.locked_at>now()-interval '4 minutes'
    and j.first_attempt_at>now()-interval '20 hours' and (j.frozen_email is null or j.frozen_email=p_message)
    and exists(select 1 from public.seller_marketing_contacts c where c.email=j.email and c.suppressed_at is null)
    and exists(select 1 from public.seller_marketing_consents c where c.id=j.consent_id and c.email=j.email)
    and exists(select 1 from public.leads l where l.id=j.lead_id and l.lead_mode='seller' and l.email=j.email)
    and exists(select 1 from public.automation_jobs r where r.lead_id=j.lead_id and r.job_type='email_buyer' and r.status='sent');
  get diagnostics changed=row_count; return changed=1;
end $$;

create function public.complete_seller_marketing_send(p_job_id uuid,p_attempt integer,p_provider_id text) returns void
language sql security invoker set search_path='' as $$
  update public.seller_marketing_jobs set status=case when status='suppressed' then 'suppressed' else 'sent' end,
    sent_at=coalesce(sent_at,now()),provider_id=p_provider_id,locked_at=null,last_error=null
  where id=p_job_id and attempts=p_attempt and status in ('processing','sent','suppressed');
$$;
create function public.fail_seller_marketing_send(p_job_id uuid,p_attempt integer,p_error text) returns void
language sql security invoker set search_path='' as $$
  update public.seller_marketing_jobs set status=case when attempts>=5 or first_attempt_at<now()-interval '19 hours' then 'failed' else 'queued' end,
    available_at=now()+interval '5 minutes',locked_at=null,last_error=left(p_error,200)
  where id=p_job_id and attempts=p_attempt and status='processing';
$$;
create function public.unsubscribe_seller_marketing(p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare address text;
begin
  update public.seller_marketing_contacts set suppressed_at=coalesce(suppressed_at,now()) where unsubscribe_token=p_token returning email into address;
  if address is null then return false; end if;
  update public.seller_marketing_jobs set status='suppressed',locked_at=null where email=address and status in ('queued','processing','failed');
  return true;
end $$;
create function public.admin_seller_marketing_status(p_lead_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('consented',true,'consentAt',c.consent_at,'wording',c.wording,'version',c.version,'source',c.source,
   'suppressedAt',s.suppressed_at,'emailStatus',j.status,'sentAt',j.sent_at,'attempts',j.attempts,'lastError',j.last_error)
 from public.seller_marketing_consents c join public.seller_marketing_contacts s on s.email=c.email
 left join public.seller_marketing_jobs j on j.email=c.email and j.campaign='seller-strategy-fees-v1'
 where c.lead_id=p_lead_id;
$$;
create function public.admin_seller_marketing_unsubscribe(p_lead_id uuid) returns boolean
language sql security invoker set search_path='' as $$
 select public.unsubscribe_seller_marketing(c.unsubscribe_token) from public.seller_marketing_contacts c join public.leads l on l.email=c.email where l.id=p_lead_id;
$$;
revoke all on function public.claim_seller_marketing_jobs(integer),public.prepare_seller_marketing_send(uuid,integer,jsonb),
 public.complete_seller_marketing_send(uuid,integer,text),public.fail_seller_marketing_send(uuid,integer,text),
 public.unsubscribe_seller_marketing(uuid),public.admin_seller_marketing_status(uuid),public.admin_seller_marketing_unsubscribe(uuid)
 from public,anon,authenticated;
grant execute on function public.claim_seller_marketing_jobs(integer),public.prepare_seller_marketing_send(uuid,integer,jsonb),
 public.complete_seller_marketing_send(uuid,integer,text),public.fail_seller_marketing_send(uuid,integer,text),
 public.unsubscribe_seller_marketing(uuid),public.admin_seller_marketing_status(uuid),public.admin_seller_marketing_unsubscribe(uuid)
 to service_role;
