create table public.admin_postgrid_orders (
 id uuid primary key,
 fingerprint text not null unique,
 mode text not null check (mode = 'test'),
 listing_key text not null,
 property_address text not null,
 recipient jsonb not null,
 sender jsonb not null,
 pdf_name text not null,
 pdf_hash text not null,
 print_options jsonb not null,
 status text not null,
 postgrid_id text unique,
 preview_url text,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index admin_postgrid_orders_created on public.admin_postgrid_orders (created_at desc);
alter table public.admin_postgrid_orders enable row level security;
revoke all on public.admin_postgrid_orders from public, anon, authenticated;
grant select, insert, update on public.admin_postgrid_orders to service_role;
comment on table public.admin_postgrid_orders is 'Private admin-only PostGrid TEST orders. No PDFs, keys or live mail. Durable duplicate protection.';
