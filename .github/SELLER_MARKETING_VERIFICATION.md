# Optional seller strategy and fees email — 23 September 2026

Base: phase-6 commit 6a659c9adeb1f3d252120e019514b655d7030177, including the latest admin workspace. Production rollback version: beed29ff-b1ce-450f-8b6e-26459bc17820. Existing reports, valuations, buying/showing/search/photo flows and scheduling are unchanged (enforced by scripts/seller-marketing-scope.mjs).

## Behavior
- Optional unchecked seller marketing consent is separate from required ownership/report permissions. No historical contacts are enrolled.
- Consent wording, version, email, source and time are recorded atomically with a new seller lead. Server-only tables and RPCs; no anonymous/authenticated grants.
- Separate bounded marketing queue waits for the existing report email to be accepted. One introductory campaign per email address. Atomic claims and frozen payloads with provider idempotency; uncertain retries stop before the provider’s 24-hour retention expires.
- Sender: Toronto House Market <notifications@updates.torontohousemarket.com> (same configured sending address as the existing emails). Reply-to: torontohousemarket@gmail.com. Subject: Selling Strategy & Fees.
- One attachment: exact approved three-page THM-Selling-Plan-and-Fees PDF. SHA256 f2a3f4c37a24cfc8f9bbbf846e11873d2b31bd6d82f3c2fa77c54d2a55bf236c. Email photo is hosted, not a second attachment; approved side-by-side portrait with two illustrative blurred figures.
- Includes THM tools, social promotion, subscribed-buyer email marketing and personal follow-up. Fee and separately agreed cost disclosures preserved.
- Tokenized unsubscribe page requires POST; GET scanners do not withdraw consent. One-click unsubscribe headers supported. Suppression persists across new report requests and never blocks transactional reports. Admin seller details show consent/email status and offer unsubscribe for handling reply requests.
- No ongoing nurture campaign activated. “Accepted by email provider” is not a promise of inbox delivery.

## Verification
- 31 focused Node tests passed, including existing form, seller, admin and transactional-email retry tests.
- Database transaction checks cover report-only requests, atomic consent, report-email gating, duplicate campaign suppression, leases, frozen payloads, unsubscribe and private grants. All synthetic records rolled back; no test emails sent.
- Security advisor reports only informational RLS-without-policy notices for the three new tables; intentional service-role-only design. Public table/function privileges verified absent.
- Preview: 0666a0bf-3900-445b-b57d-97ed18673402. Candidate module-manifest SHA256: 5ad6140a8c9d4aad9587c408ab3209adf107bf90615fe0dd4dfb3cec7e3256b7. Successful run: 35899583937.
- Eighteen assets verified by exact hash, including approved photo/PDF and existing admin/public files. Existing binding names/types and settings preserved; admin routes remain protected; unsubscribe GET/invalid links checked without writes.
- Preview seller form visually reviewed; marketing input checked/unchecked and confirmed optional, initially unchecked. No form submitted. Existing contact/footer design retained with signup disclosures in the footer.
- Live email delivery to a real recipient and individual email-client rendering have not been tested by this change. The approved email artwork was already reviewed separately.

## Deployment
Promote only the exact verified candidate with the guarded workflow. Recheck production source/version before promotion, verify assets and cron afterward, and restore the previous version on verification failure. The additive database migration can remain if code is rolled back; old forms cannot create marketing consent.
