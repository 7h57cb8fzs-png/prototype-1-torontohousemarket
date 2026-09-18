create table if not exists public.seller_subject_archives (
  id uuid primary key default gen_random_uuid(),
  address_key text not null unique,
  facts jsonb not null check (jsonb_typeof(facts)='object'),
  source_url text not null check (source_url like 'https://%'),
  source_label text not null,
  source_date date not null,
  verified_at timestamptz not null default now(),
  review_note text not null
);
alter table public.seller_subject_archives enable row level security;
revoke all on public.seller_subject_archives from anon, authenticated;
grant select, insert, update, delete on public.seller_subject_archives to service_role;
comment on table public.seller_subject_archives is 'Reviewed historical subject specifications and provenance. No archived sale/asking prices. Private service-role access only.';
