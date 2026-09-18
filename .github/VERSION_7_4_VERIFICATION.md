# Version 7.4 verification — 18 September 2026

Production: https://torontohousemarket.com. Branch: phase-6; main unchanged.

## Delivered changes

- Compact OpenAI home finder directly below the buyer address/snapshot, above the team section. Small category chips replace the oversized tiles. Older turns collapse; their context remains available. New chat aborts the current request and clears the full conversation.
- Every chat message is interpreted by gpt-5.6-luna into a strict validated search plan. Only public IDX records supply listing facts. Supports city, type, budget, bedroom/bathroom/parking/size filters, sorting, specific addresses/MLS numbers, follow-up questions and additional pages. Unsupported or unverifiable requirements are explained. Search covers a bounded inventory window; it is not the complete market.
- Signed, expiring context prevents client-edited property facts. Same-origin requests, payload bounds and request throttling protect the endpoint. Verified property cards stream before the AI explanation. Changed filters always run a new search, including messages asking for “more”; explicit MLS queries are canonicalized.
- Public city inventory is fetched in bounded parallel pages and cached for five minutes across filter refinements. Photos use a direct lightweight public-property lookup. Admin lead lists omit full report payloads and load reports when opened.
- Seller entry now uses the existing server address-validation route without a public MLS scan. A fresh Oak form test exposed a 25-second public lookup timeout before submission; syntactic address validation is quick and historical lookup remains in the report pipeline. Optional home facts stay unknown until supplied or recovered.
- Removed the extra seller “Skip to your home’s address” link and duplicate homepage copy. Buyer and seller reports have clearer pricing blocks and short AI summary cards, using the existing narrative without an extra model call.
- Admin leads have Saved buyer/seller reports: exact frozen email copies, send dates/status, version metadata and HTML/text downloads. New sends also freeze the structured report data for a JSON download. Regeneration does not overwrite earlier sent copies. Current regenerated data is clearly distinguished from the exact sent email. Endpoint requires existing admin authorization; private/no-store; iframe preview is sandboxed.
- Corrected AMPRE OData spaces for strings and URL objects. Exact seller address/city/unit history has no recency cutoff. Compared version 7.1 and retained broad licensed evidence for expert recovery when strict evidence is insufficient.
- Reviewed archives contain non-price historical specifications for 38 Oak Avenue, 747 Lansdowne Avenue and 75 Tenth Street. Oak’s licensed feed contains separate rental units; its reviewed 2017 whole-house archive is separately dated and sourced. Historical size/condition is not represented as current. No scraped archive price enters valuation.
- Seller tail-page evidence is preserved for expert review; Oak retained 1,503 fetched rows and selected five June–September 2026 licensed sold comparisons. Limited confidence and unknown current size/condition are disclosed. The final value is established before the AI strategy is written, keeping the range and narrative consistent.
- Buyer email rendering preserves expert-selected condo comparisons and the final expert range. Untouched seller renovation controls no longer assert a renovation percentage.
- Cloudflare Workers paid standard plan confirmed. The queue drains three claimed reports per invocation and sends each ready email promptly. Frozen provider payloads preserve retry idempotency; incomplete reports cannot be emailed as final.

## Eleven unique website report requests

| Type | Property | Final review |
| --- | --- | --- |
| Buyer | 5 Benfrisco Crescent, Toronto | 3 selected sales; corrected email read |
| Buyer | 194 Dalhousie Street, Vaughan | 4 selected sales; corrected email read |
| Buyer condo | 40 Harding Boulevard W, unit 716, Richmond Hill | 4 selected sales; corrected email read |
| Seller archive | 38 Oak Avenue, Richmond Hill | 5 current sold comparisons; corrected email read |
| Seller archive | 747 Lansdowne Avenue, Toronto | 5 selected sales; corrected email read |
| Seller archive | 75 Tenth Street, Toronto | 6 selected sales; corrected email read |
| Buyer condo | 55 Oneida Crescent, unit 408, Richmond Hill | 5 selected sales; email read |
| Buyer condo | 9199 Yonge Street, unit 505, Richmond Hill | 5 expert sales and matching range preserved; corrected email read |
| Buyer | 64 Laurel Avenue, Toronto | 4 selected sales; email read |
| Seller, 2025 history | 60 Emmas Way, Whitby | 3 selected sales; email read |
| Seller, 2025 history | 25 Muldrew Avenue, Toronto | 8 selected sales; email read |

The initial six were followed by five additional unique homes including condos. Affected reports were corrected and regenerated; email copies were read from the connected Gmail inbox. All eleven final copies are persisted in automation_jobs.frozen_email. Copies were delivered to the authorized owner test recipient; forwarding to the connected inbox adds several seconds.

## Technical and browser verification

31 focused tests pass: chat integrity/context, changed-budget pagination, exact MLS queries, seller entry without any MLS request, model failure, parallel cached inventory, admin authorization/scoping and immutable email copies, summary rendering, historical identity and provenance, URL encoding, evidence reuse, expert condo consistency, resource limits, atomic persistence and email retry identity. This is not a claim that every legacy repository test passes; old public-page harness tests and earlier discovery expectations have unrelated baseline failures.

Live preview conversations verified: Richmond Hill two-bedroom condos below $800K → Vaughan three-bedroom detached below $1.1M → most bathrooms comparison → next page. Filters and displayed asking prices matched; previous turns collapsed. Final next page returned one distinct property and explained that no further pages remained. A separate Markham townhouse search and specific MLS N13660016 query returned verified listings. View home opened the buyer snapshot; New chat cleared all turns. Unsupported-city clarification and tamper rejection have focused automated coverage.

Desktop and 390px iframe layouts reviewed, including both email templates. This is responsive browser review, not real-device or every-email-client testing. Voice depends on browser support and was not microphone-tested. Anonymous admin report access returned 401; saved-copy authorization and response behavior were tested with fixtures. A full authenticated production admin UI session was unavailable.

## Performance observations and limits

Same execution environment, earlier production vs revised preview: filtered public search 9.95s → 8.57s cold; a changed-budget query using shared inventory 5.32s. Photo 7.99s → 5.59s. The environment itself had roughly 4–7s request overhead, so these are directional observations rather than user-device guarantees. A complete new Markham AI search delivered cards at 9.96s and the explanation at 12.81s; streaming avoids waiting for the explanation before showing homes.

Clean-queue historical seller submissions reached the original Gmail recipient in about 31s and 50s; acknowledgments took about one second. Earlier additional buyer tests waited 2–4.5 minutes behind regeneration work. No claim that every report arrives within one minute. SPF and DKIM passed in inspected received headers.

Archive coverage remains limited to available licensed history and three reviewed supplemental addresses; this is not universal historical MLS coverage. Unknown current condition/size and imperfect comparison adjustments remain material valuation limitations.

## Final release and fresh-delivery verification

- Release commit: d38023eb35ee87f510a132d1987562b297eb05e5.
- Successful guarded release run: 35345208048; all 31 focused tests and 11 deployed asset hashes passed.
- Worker: 63467094-008f-4383-9226-5c60d2c120f2; server source SHA256: 78343e31c6fed6394a896501bccb9b2a01d50451f13134b4a8026d502b6648fd.
- Rollback: a97d6ef4-0f0b-4dcd-bcfd-11ece2bb6f79. Existing binding names/types, variables and cron preserved.
- Production browser verified compact finder below the buyer section and removal of the seller skip link.
- Fresh Oak address entry advanced to the report form in 318ms in the production browser, compared with the prior 25-second timeout. City was retained; unknown house details stayed unknown. The report request was accepted at 12:34:03 UTC and the acknowledgment sent at 12:34:04 UTC.
- Reformatted 9199 Yonge unit 505 report sent at 12:30:58 UTC and read in Gmail. The new AI summary, five sold comparisons and $570,000–$650,000 range agree. Exact email HTML and structured report v7.4 were both saved; archived midpoint is $610,000 with five comparisons.
- Fresh Oak report: generated and saved at 12:35:44 UTC; email sent at 12:35:45 UTC, about 103 seconds after browser submission (about 52 seconds waiting for the scheduled runner, then 50 seconds generation). Received Gmail copy was read in full. It contains five June–September 2026 sold properties, $1.6M midpoint, $1.4M–$1.8M preliminary range, Limited confidence, concise AI market perspective and listing approach, dated 2017 subject provenance, and verification questions. The newly generated range agrees with the earlier corrected report.
- Oak exact email HTML and structured v7.4 report data were both frozen before send; saved midpoint and all five comparisons agree with the received copy. The HTML includes the new AI summary card.
- Final production conversation verified Richmond Hill two-bedroom condos below $700K with six conforming results. New chat reset was checked in production. No remaining queued jobs from the final report tests.
