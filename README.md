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

## Pending buyer-tools release — 2026-09-06 (not deployed)

The homepage adds Just Listed, Price Drops and Search by Budget below the public
snapshot. Each opens an on-page search; selecting a result rechecks its exact MLS
through `/api/property`. Browsing does not submit leads or create reports/emails.

The public snapshot replaces valuation teasers with listing facts: original-to-
current asking-price reduction, layout, listing age, verification priorities,
reported annual tax, maintenance charges/inclusions, possession and community.
Absent values remain unknown, not zero. Public rendering ignores sold comps and
value ranges even if accidentally present in an API response. The report renderer
has a separate pending zero-comparable guard; these buyer tools do not change
comparable selection, valuation, or the normal emailed report.

### Discovery algorithm and safeguards

- `/api/discovery` uses only `AMPRE_TOKEN` (IDX), never a VOW credential.
- Bulk public display remains disabled by default, preserving the existing
  `/api/featured-listings` restriction. The new route requires the explicitly
  configured `PUBLIC_DISCOVERY_ENABLED=true` release flag.
- Server-side city query; exact city/district, active-for-sale, residential type
  and internet/address-display checks are reapplied locally. Freehold and condo
  townhouses are distinct. Public output is an explicit field allowlist.
- Just Listed: valid original-entry timestamp, no future dates, at most seven days
  old; newest first. This is listing freshness, not first-ever market exposure.
- Price Drops: positive current asking price below the original asking price on
  the same MLS record; largest percentage difference first. It does not establish
  the last reduction date, fair value, discount to sold value or a bargain.
- Budget: asking price at or below the entered cap, sorted lowest first. No
  mortgage qualification or affordability claim.
- Read at most five 100-record pages, following trusted AMPRE next links, with a
  12-second scan budget and five-second request timeouts. Deduplicate by listing
  key. Display up to 12 matches and disclose incomplete coverage/cache age.
- Require a successful ordered query. An upstream failure, rejected sort or
  invalid pagination produces an error, never a false zero or an arbitrary
  historical scan labeled "newest". Results are a selection, not a full-market
  inventory. No scheduled scraping or emails.

Query implementation references: [AMPRE Property](https://developer.ampre.ca/docs/resources/property)
and [query/pagination options](https://developer.ampre.ca/docs/query-options).
Documentation is not proof of this credential's supported fields or permissions.

### Release checks still required

1. Confirm licensed bulk public IDX display permissions before activating the new
   flag; preserve all existing VOW gates. Do not silently enable the older route.
2. In an authorized non-emailing test deployment, verify the new single-field
   newest-first query with the configured IDX credential in Toronto and Vaughan;
   compare returned keys, active status, dates, reductions, types and asking prices
   to direct property lookups. If sorting is rejected, keep discovery disabled
   until a supported retrieval method is validated. Fixture tests are not proof of
   live feed compatibility or market completeness.
3. Check desktop/mobile layout and the lookup → snapshot → showing-modal flow.
   Do not submit the form or invoke report/email/automation endpoints in this QA.
4. Run `node --test tests/*.test.mjs`, syntax and whitespace checks. The existing
   source-hash deployment guards are intentionally unchanged and will need fresh
   verified before/after hashes for the approved combined release. Do not bypass
   those guards or push to the auto-deploy branch prematurely.

This revision was checked with local fixture and DOM-harness tests, not a live
IDX integration or browser visual test. No production deployment is part of it.
