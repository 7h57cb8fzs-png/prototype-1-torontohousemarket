# Seller form: two checkboxes and no empty error box

Date: 2026-09-23
Baseline: b8c4cb6f3172e76692baedcd863aa801b94d0175 (phase-6)
Implementation: 21d84427cd6e51329a445e0fd0c0b9230cccf08b

## Change

- Combine ownership/owner permission and report/contact permission into one required checkbox.
- Keep marketing as the second, optional, unchecked checkbox.
- Send the combined choice as both existing ownerConsent and contactConsent fields; server validation is unchanged.
- Hide only the empty seller error container. Keep real errors visible and clear them on a new address or retry.
- Refresh seller JS/CSS asset URLs. Keep buyer, showing, valuation, report/email delivery, admin, approved marketing PDF/photo and database untouched.

## Exactly five focused tests

GitHub Actions run: https://github.com/7h57cb8fzs-png/prototype-1-torontohousemarket/actions/runs/35901349593
Result: 5 passed, 0 failed, 0 skipped. All network requests intercepted; no real leads or emails created.

1. Desktop: two unchecked boxes, required/optional states, no empty red box.
2. Mobile: same controls, no empty red box or horizontal overflow.
3. Missing combined permission blocks submission; report-only request preserves both server permissions and excludes marketing.
4. Explicit optional marketing consent is submitted independently.
5. Real server errors remain visible; new-address/reset and retry clear stale errors and retry keeps its request key.

Desktop and mobile screenshots are in the run artifact seller-two-checkbox-review (10768808588).

## Reviewed deployment

Candidate: bef45e90-5003-4ff7-a051-4d722102b909
Preview: https://bef45e90-prototype-1-torontohousemarket.7h57cb8fzs.workers.dev
Previous production / rollback: 0666a0bf-3900-445b-b57d-97ed18673402
Both Worker module manifests SHA256: 5ad6140a8c9d4aad9587c408ab3209adf107bf90615fe0dd4dfb3cec7e3256b7

Promotion uses the exact reviewed version, without rerunning the five tests. Guards check the active version, unchanged Worker code/configuration/cron, matching static assets and existing public endpoint protections. Automatic rollback is retained.
