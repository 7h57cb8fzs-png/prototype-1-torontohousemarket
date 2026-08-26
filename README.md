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
- RESEND_API_KEY (sending-only key restricted to the verified sending domain)

The Worker also uses the `AI` Workers AI binding declared in `wrangler.jsonc`. AI narrative generation is grounded in the structured property evidence. If the model is unavailable, a deterministic evidence-based narrative is stored so the report and buyer email do not remain stuck.

Never expose AMPRE_TOKEN or the Supabase service-role key in browser JavaScript.

## Database

Apply `supabase/migrations/001_phase1.sql` to a new Supabase project.

Phase 2 adds the two timestamped operations migrations in `supabase/migrations/`.

## Operations setup

1. Set real `mobile` and/or `email` values for active rows in `public.agents`. Jobs are deliberately marked `blocked` when no destination exists.
2. Configure `ADMIN_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as Cloudflare secrets, then open `/admin.html` with the admin key.
3. Apply all timestamped migrations. The Worker atomically claims `generate_report` jobs, stores a structured AI-assisted report, marks it ready, and sends the buyer report through Resend.
4. The report uses AMPRE/PropTx recent sold evidence as the authoritative property-data source. Public-source links provide verification paths. Consumer portals such as Realtor.ca and HouseSigma must only be added through an authorized licensed feed; the Worker does not scrape them.

## Locked operational defaults

- round robin
- 5 minute first-response target
- service hours 9 AM–9 PM Toronto time
- up to $10,000 cashback
- Toronto + York + Peel + Durham + Halton
- defaults remain configurable in `app_settings`
