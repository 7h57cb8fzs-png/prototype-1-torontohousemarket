# PROTOTYPE 1 - TORONTOHOUSEMARKET

Standalone Phase 1 product build for Toronto House Market.

## Product flow

Property → Instant Buyer Decision Snapshot (no registration) → Interested? → See This Home → minimal contact capture → showing workflow + Full AI Buyer Brief in parallel.

## Infrastructure

- GitHub: source of truth
- Cloudflare Pages + Pages Functions: website + secure server-side API
- Supabase: lead database, assignment state, events, editable settings
- Amplify / PropTx IDX: called only from Cloudflare server-side using `AMPRE_TOKEN`

## Required Cloudflare secrets

- AMPRE_TOKEN
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_API_KEY (random 24+ character secret used to open `/admin.html`)

Never expose AMPRE_TOKEN or the Supabase service-role key in browser JavaScript.

## Database

Apply `supabase/migrations/001_phase1.sql` to a new Supabase project.

Phase 2 adds the two timestamped operations migrations in `supabase/migrations/`.

## Operations setup still required

1. Set real `mobile` and/or `email` values for active rows in `public.agents`. Jobs are deliberately marked `blocked` when no destination exists.
2. Configure `ADMIN_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as Cloudflare secrets, then open `/admin.html` with the admin key.
3. Connect a server-side job processor to `public.automation_jobs`. It must generate `property_reports.report_payload`, then dispatch `email_buyer` and `notify_agent` jobs through the chosen email/SMS provider. No delivery is claimed until the provider returns success.
4. Merge and deploy the Phase 2 branch. The existing AMPRE token, address resolver and media delivery remain unchanged.

## Locked operational defaults

- round robin
- 5 minute first-response target
- service hours 9 AM–9 PM Toronto time
- up to $10,000 cashback
- Toronto + York + Peel + Durham + Halton
- defaults remain configurable in `app_settings`
