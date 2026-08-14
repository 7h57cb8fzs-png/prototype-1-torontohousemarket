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

Never expose AMPRE_TOKEN or the Supabase service-role key in browser JavaScript.

## Database

Apply `supabase/migrations/001_phase1.sql` to a new Supabase project.

## Locked operational defaults

- round robin
- 5 minute first-response target
- service hours 9 AM–9 PM Toronto time
- up to $10,000 cashback
- Toronto + York + Peel + Durham + Halton
- defaults remain configurable in `app_settings`
