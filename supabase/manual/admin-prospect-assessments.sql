-- Isolated admin-only assessment cache. No customer, lead, report or email tables are touched.
create table public.admin_prospect_assessments (
  cache_key text primary key,
  listing_key text not null,
  fingerprint text not null,
  mode text not null check (mode in ('remarks','photos','manual')),
  state text not null check (state in ('pending','ready','failed')),
  lock_id uuid,
  assessment jsonb,
  updated_at timestamptz not null default now(),
  check (state <> 'ready' or jsonb_typeof(assessment) = 'object')
);
create index admin_prospect_assessments_lookup on public.admin_prospect_assessments (listing_key, fingerprint, state);
alter table public.admin_prospect_assessments enable row level security;
revoke all on public.admin_prospect_assessments from public, anon, authenticated;
grant select, insert, update, delete on public.admin_prospect_assessments to service_role;
comment on table public.admin_prospect_assessments is 'Private THM admin renovation assessments; access only through admin-authenticated Worker.';
