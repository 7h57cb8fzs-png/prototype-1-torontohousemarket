# Luna lookup and property-history revision — 2026-09-26

Requested scope: 13 recent Seller report replays, 20 additional Seller properties,
20 additional mixed Buyer/Seller properties, review and refinements, and 10 final
mixed properties. Mixed rounds use equal Buyer/Seller counts. No test emails,
leads, jobs, appointments, consent records or stored client reports are created.

## Evidence rules

- Luna selects from bounded server-built alternate MLS query plans. It cannot
  supply invented addresses, arbitrary filters, sales or property characteristics.
- Exact street number, street identity, municipality and condo unit validation
  remains mandatory. Narrow unit queries precede larger building scans.
- Seller questionnaire answers remain separate from valuation inputs. Verified
  historical MLS facts and reviewed MLS archives remain the subject sources.
- Recovery excludes the subject itself, duplicate homes, rentals, conditional
  sales, cancellation/termination records and sales without actual sale dates.
  Modification timestamps are never substituted for transaction dates.
- Recovery uses exact housing subtype and same community/building, with a
  labelled same-municipality/postal-district expansion when necessary. Luna must
  justify neighbourhood differences; a postal district is not a measured radius.
- Recovery sales are at most 365 days old. Existing Buyer core time expansion
  remains explicitly disclosed by its own policy.
- Model adjustments over 35% are rejected, rather than clipped. This threshold
  is a conservative product safeguard, not an appraisal standard.
- One or two genuine recovered comparisons can be displayed as evidence without
  supplying a price. A valuation needs at least three sufficiently relevant sales.
- Final presentation cannot promote an evidence-only set into a valuation and
  preserves the evidence engine's wider uncertainty allowance.

## History and API visibility

Five-year history counts distinct recovered MLS IDs and distinguishes terminated,
cancelled, expired and withdrawn sale listings. Rental appearances are separate.
The latest dated completed sale can include its actual recorded price and MLS ID.
Incomplete feed coverage is explicit. Historical prices are context only and do
not enter the valuation calculation. History is rendered in Buyer and Seller
reports. The existing authenticated admin Seller preview uses the full report
pipeline, without saving or sending a report.

API telemetry records requested/resolved model, response ID, HTTP status and
token usage. Luna remains primary; the existing rare-complexity Terra review is
retained. No new API credential or vendor is required.

## Test isolation and release

`scripts/lookup-qa.mjs` uploads unpublished production candidates and separate
expiring nonce-protected QA adapters. Adapters have no scheduler/assets, reject
email calls and database mutations, and are never promoted. Detailed reports are
encrypted with a reviewer's public key before GitHub artifact storage. Only
aggregate results appear in workflow logs. Random sampling excludes earlier
saved searches, fixture addresses and prior round hashes. Sampling is within
selected GTA communities, not a representative statistical market sample.

The active production version, source hash, existing binding names and plaintext
settings are checked before upload. Deployment promotes an exact reviewed
candidate, preserves cron and customer data, checks frontend assets and admin
authentication, and rolls back on failed production checks.

## Initial review

Initial paired run: `36225873187`, 33 cases (13 recent records, including one
duplicate address, plus 20 new Seller addresses). All 20 new Seller cases returned
comparables. The first candidate exposed a Pine Grove over-restriction and an
Eglinton address-query timeout. Review also found subject-as-comparable errors in
the old recovery, a mismatched housing subtype, and excessive model adjustments.
These drove the subsequent narrow-unit queries, controlled postal expansion,
partial-evidence display and numerical safeguards. History appeared in 28 initial
candidate reports; a recorded last sale was recovered in 16. Missing history is
not evidence that a property was never listed or sold.

Do not infer valuation accuracy or attribute earlier deployed fixes to this
revision from before/after report availability alone. Follow-up and final release
results are recorded after their respective runs finish.
