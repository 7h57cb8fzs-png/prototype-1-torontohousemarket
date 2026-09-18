# Home Finder and report design revision — 2026-09-18

## Problem and changes

The previous conversation filtered the last 500 city records. A valid Annex request could therefore return zero, and listing brokerage requests were not queryable. The replacement queries the requested MLS neighbourhood or office before applying validated local filters. General searches push city, sale status, type, price, bedroom, bathroom and parking criteria upstream. Unsupported provider query forms fall back to a bounded scope, with incomplete coverage disclosed. Public display permissions and active-for-sale checks still apply; no VOW sales are shown in public chat.

- Model remains OpenAI `gpt-5.6-luna` for planning and grounded descriptions. The model never supplies listing inventory. No model/vendor switch or new credential was introduced.
- Supports brokerage filters, their explicit removal, mixed property types, city changes, price refinements, additional pages, exact MLS lookups and clarification for unsupported cities.
- Implicit comparisons use the currently displayed homes, not an earlier search. Prior records remain available for specific MLS references.
- New architectural brand mark and wordmark; an editorial two-column Home Finder below the buyer address/snapshot, replacing the pill row. Three useful starting prompts; one collapsed history section; Start fresh clears state and both current/history content. Prior pagination controls are removed when a new turn starts.
- Buyer and seller email templates include a value-range graphic and zero-based, consistently scaled bars for actual sold prices. Adjusted comparison figures remain separately labelled. Graphics are email-safe tables/text, with no remote image dependency. No valuation calculations changed.
- Warmer Realtor-style buyer/seller writing, concise chat responses, and a fix for summary sentence parsing that previously could lose text before decimal prices.
- Existing immutable email/report copies beside admin leads remain intact.

## Validation

- 40 focused acceptance tests pass, including query scoping, brokerage matching, privacy/display rejection, mixed types, latest-search comparisons, empty-city clarification and decimal-price preservation.
- Original live Annex 2+ bedroom request reproduced as zero before the fix. Scoped query recovered 455 neighbourhood records and 122 matching public active homes at the time checked.
- Toronto CENTURY 21 Leading Edge query recovered 110 matching public active homes at the time checked.
- Explicitly retaining CENTURY 21 Leading Edge in the Annex returned no matches in this retrieval. Removing that constraint restored results; no alternative brokerage was silently substituted.
- Live sequence covered brokerage → Annex → all brokerages + 2+ beds + $1.2M → bathroom comparison → next distinct homes → Richmond Hill exact 2-bedroom condos → lower $600K ceiling → exact MLS property. Mixed detached/townhouse request returned five correct Annex homes.
- Live tests caught stale comparison context and empty-city clarification failures; both have regression checks. Final production confirmation will cover these corrections.
- Desktop and 390px iframe layout inspected. Mobile heading spacing corrected. Both report graphic widths inspected. Listing card opens its buyer snapshot; Start fresh clears history and current results.
- No authenticated admin browser session or exhaustive email-client/dark-mode test. Layout checked in browser email previews; final two report emails will be read after delivery.

## Release and email checks

Final preview before concise-copy/clarification corrections: Worker `1bcbaec7-f60a-4adf-be90-7139cc16791c`, source `68a0bcc8d17b00c3f858f9260d4875d902d7675ecc08733fd7e13c1729ab66e4`.

Exactly two old-listing report tests selected randomly from existing verified test addresses: 25 Muldrew Avenue, Toronto and 75 Tenth Street, Toronto. Recipient remains the user's previously verified test email. Final delivery details will be added after production checks.
