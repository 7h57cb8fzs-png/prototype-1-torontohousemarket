# Seller evidence boundary — 2026-09-26

Seller questionnaire answers remain in `leads.property_snapshot.sellerProfile` for the team to verify later. They do not supply neighbourhood, home type, size, bedrooms, kitchens, basement, condition or price expectations to automated comparable selection, report mathematics or OpenAI. Address/unit is the property identity input. Historical MLS records supply property characteristics with provenance. Missing historic measurements remain unknown; recorded bedrooms and lot frontage can support the existing missing-size method.

The historical identity search has no recent-sale date restriction. The recent comparable-sale window remains a separate policy. Empty successful combined queries are not treated as proof of no history before bounded alternate-case/street searches are attempted. Seller-only compound street matching preserves condo unit identity. Incomplete history cannot establish present listing availability.

## Private reviewed MLS evidence

If the licensed feed does not expose a known historical listing, a private administrator-reviewed MLS document may supply historical specifications. It must have `reviewed_mls` provenance, a valid MLS identifier, source date and exact property identity. Internal URNs identify uploaded source documents; they are not public download URLs. Historical asking/sale prices and personal seller/broker names are deliberately excluded from this evidence fallback. The document does not establish current availability or condition. Generic portal profiles without reviewed MLS provenance are no longer used as subject evidence.

The existing `seller_subject_archives` table remains protected by RLS and has no anonymous or authenticated-user SELECT grants. The limited source-locator constraint update is documented in `supabase/manual/seller-reviewed-mls-document-sources.sql`; no access policies or client-data rows are changed by that migration.

## Verification

Seven new synthetic regression groups plus four updated Seller policy tests check source separation, fixed-evidence questionnaire invariance, exact old-MLS recovery, missing size, private document provenance and preserved form capture. Five unchanged Buyer regressions check report capture, consent and showing semantics. The scope script compares every existing non-Seller runtime function and webpage asset with base `5eeb589f81af01e5c78d37432a88fc527696625c`.

These are source-boundary corrections, not a claim that the existing broader Expert Comp adjustment algorithm is deterministic or that every valuation-quality issue has been fixed.

## Release controls

An unpublished candidate must pass source/binding/asset/authentication checks and a fixed four-address read-only Seller sample. Production promotion must specify the exact previously reviewed candidate ID and hash. The guard checks the current baseline before promoting, preserves bindings and cron, and rolls back if post-promotion verification fails. Temporary nonce-protected diagnostic adapters expire and must never be promoted.

Existing client reports are not rewritten. Acceptance checks do not create leads, report/email jobs, appointments or consent records. Seller questionnaire and public page design remain intact. Buyer valuation and report algorithms, marketing, admin workspace and scheduler are outside this change.
