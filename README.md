> **Current phase: Phase 6.** Phase 5 closed on September 11, 2026. Before changing or restoring the project, read the [phase register and rollback checkpoint](.github/PROJECT_PHASES.md). The early prototype notes below are historical where superseded by that register.

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

## Buyer-tools and AI release — 2026-09-06

The homepage adds Just Listed, Luxury Homes and Search by Budget below the public
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
- Luxury Homes: asking price of at least $2,000,000, sorted highest first. This
  labels the price segment, not verified condition, quality or fair value.
- Budget: asking price at or below the entered cap, sorted lowest first. No
  mortgage qualification or affordability claim.
- Read at most five 100-record pages, following trusted AMPRE next links, with a
  12-second scan budget and five-second request timeouts. Deduplicate by listing
  key. Display up to 12 matches and disclose incomplete coverage/cache age.
- Prefer newest-first order. If the feed rejects sorting, get a fresh count and
  scan a bounded tail of up to 500 rows with no fixed historical offsets; all
  actual dates, active statuses and city matches are checked locally. An invalid
  count, failed query or invalid pagination is an error, never a false zero.
  Results are explicitly a selection, not a full-market inventory. No scheduled
  scraping or emails.

Query implementation references: [AMPRE Property](https://developer.ampre.ca/docs/resources/property)
and [query/pagination options](https://developer.ampre.ca/docs/query-options).
Documentation is not proof of this credential's supported fields or permissions.

### Live acceptance and release

The live IDX feed rejects sorting; its count-based bounded scan returned active
Toronto and Vaughan listings. Price-history diagnostics showed no OriginalListPrice,
PreviousListPrice or PriceChangeTimestamp in the sampled public rows; corresponding
filters were rejected. Price Drops was therefore replaced by Luxury Homes rather
than presenting an unsupported reduction search. Existing optional snapshot price
change fields are shown only if a feed actually reports them.

The public AI Home Assistant asks three preset questions. Workers AI selects IDs
from server-defined listing facts and verification questions. The browser never
renders provider-authored factual claims. Invalid AI selections or provider failures
produce a clearly labeled deterministic checklist. The endpoint accepts only an
MLS key and a topic, uses the public IDX snapshot, and is cached and throttled.
It does not accept buyer contact details or create leads, reports or email jobs.

Preview versions refuse lead/admin/report writes. Production promotion uses the
exact tested version and verifies source, bindings, unchanged plain-text settings,
cron, static assets, public search and AI. Failed promotion checks restore the
previous version. Normal scheduled report/email processing is preserved; testing
must not invoke those endpoints or submit the showing form.

Run `node --test tests/*.test.mjs` for local acceptance. Keep live verification
results in the preview/deployment workflow summaries. The existing comparable
selection, valuation and report-AI functions match the pre-release production
source; the email/PDF change only suppresses unsupported zero-comparable ratings.

### Public Price Check (September 6, 2026)

The snapshot automatically reads `/api/price-check?listingKey=...`. It uses IDX only and compares other distinct active asking prices in the exact municipality/community, home type, published size band and bedroom count, including the reported primary/additional bedroom breakdown when supplied; bathroom counts can differ by one. Reported parking is also checked. It does not alter the VOW comparable engine or create leads/reports/emails.

At least three matches are required. The subject asking price is compared with their median: within ±5% is in line, below/above that is lower/higher, and a gap beyond 25% requires closer review. A wide interquartile price spread (>30% of median), missing subject facts, or too few matches withholds the label. The UI explains the basis and links all active matches. This is an asking-price comparison, not an appraisal or sold-value score.

Community queries that falsely return no rows retry a postal filter, with exact community still enforced locally. Follow licensed pagination within a 600-row/18-second bound and disclose partial coverage. Upstream errors remain errors, not zero-market results. Cache for up to five minutes; abort and ignore stale responses when changing properties.
