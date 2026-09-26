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

## Second review

Mixed run `36226603267`: all ten new Seller cases returned comparisons. Exact-unit
rechecks recovered three townhouse comparisons for Pine Grove and eight comparisons
for Eglinton in 15 seconds. Dixie requires insufficient-evidence handling after
large model adjustments are excluded. The QA Buyer renderer had an incorrect
argument signature; those ten Buyer properties were rerun unchanged in
`36227167620`. All ten then returned reports, comparisons and history.

Review found two additional issues: large differences from a recent recorded
subject sale, and generic home valuations for advertised development opportunities.
The first produces an explicit review flag without recalculating the value from
the prior transaction. The second withholds the generic estimate and requests
specialist review; claimed planning rights are not treated as verified approvals.
These safeguards apply to both Buyer and Seller reports.

## Final staged results

Final random run `36227627467`: ten new cases (five Buyer, five Seller) all rendered
with comparisons and history. Follow-up `36228054212` verified development holds,
recent-subject-sale discrepancy flags, and corrected narrative instructions.
Narrative check `36228198434` showed instructions alone did not reliably prevent
unsupported relative-floor claims, so a deterministic guard now preserves factual
sales but withholds the price when a model adjustment assumes relative elevation
that the supplied comparison data does not establish.

The requested set comprises 63 cases / 62 unique properties, because two of the
13 recent records share an address. Using each case's latest completed stage:
61 cases contain comparisons; 59 contain recovered dated sale listings from the
past five years; 23 identify a last recorded sale. The repeated unresolved address
remains unresolved. Six baseline cases contained self-comparison, subtype mismatch
or adjustments above 35%; those concrete problems were absent in their latest
rechecks. This is a narrow quality check, not proof of pricing accuracy.

The historical saved 13 had 9 comparison sets, but the production baseline before
this revision already had 11; the latest replay retains 11. Do not attribute the
older coverage gain to this release. Staged results are not a claim that every
case was rerun after every later narrative refinement. Known issues were rechecked.

All QA adapters block email calls and database mutations. No test emails were
sent. The 21 focused regressions passed, alongside the existing comparable and
Buyer-flow checks. Publication identity and verification follow below.

Final guard check `36228419297` passed: the previously affected report retained
four factual sales, removed unsupported elevation adjustments, and withheld the
price with a clear verification request. Source commit
`5d7ecc64f8b4793223dba59036e1bae853e29a28` was uploaded as candidate
`52c942f2-2042-4d77-89e9-8c99ced92c2b`, SHA-256
`4effeb70717cacb558e3e9d9c471d12698bdabf964d647c7a25e142ab49aa904`.
The exact candidate is promoted by the guarded publication workflow.

## Published

Workflow `36228557462` successfully promoted the reviewed candidate on
2026-09-26 at 08:02 UTC. All 16 checked public assets matched; admin routes remained
protected; binding configuration, active source hash and cron were verified.
The live `/api/version` reports `version-7.6-luna-lookup-history-20260926` and
`gpt-5.6-luna`. The release was fast-forwarded into the canonical `phase-6` branch.
