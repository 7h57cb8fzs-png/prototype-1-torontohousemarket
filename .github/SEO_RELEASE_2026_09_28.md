# THM SEO release — 2026-09-28

Production: https://torontohousemarket.com/
Branch: phase-6
Release commit: 1e5426e287d68b8a26882768bcddf56b47f1f63d
Successful release workflow: 36460119101
Worker version: ba600012-6f10-49d9-8c13-475194e963af
Rollback version: 0ee2f48d-a4b5-47f3-aec6-8b3c92edab58
Server module SHA-256: b654b801ed955bca1e682d5b0f111c7dd27f099c0e2dfbf785d2b15b88325e74

## Changes
- Distinct buyer and seller titles/descriptions, canonical URLs and social metadata.
- WebSite, Organization, Person, WebPage and WebApplication structured data using Alireza Golestan and Mehrdad Golestan, linked to their golestan.ca profiles.
- Short accessible report explanations and expandable questions below existing tools, with scoped responsive styling.
- robots.txt and a two-URL sitemap for / and /seller. Internal seller links use the canonical extensionless URL.
- Existing noindex directives for admin/showing pages preserved.
- Internal external-recovery release notes excluded from public assets.

## Verification
All 29 public assets matched the reviewed source in preview and production. Sitemap returned 200 XML; robots returned 200 text/plain. Both public landing pages returned 200 with indexable production headers. Forms, existing JavaScript and control IDs unchanged. The deployed server module was reused byte for byte. Existing bindings/settings, cron and admin authentication preserved. No property reports, leads, emails or customer records created.

## Google Search Console baseline and completed submissions
Observed before release: HTTPS homepage indexed; /seller unknown to Google. Page indexing report last updated September 20: one indexed page, two crawled but unindexed legacy URLs (HTTP homepage and an old M City condo blog URL).
The sitemap was already submitted September 15 but showed Couldn't fetch and zero discovered pages. That exact sitemap URL now serves valid XML.
Performance chart August 24–September 25: 2 clicks, 9 impressions. This is a small baseline, not evidence of ranking improvement.
Reconnected to the verified sc-domain:torontohousemarket.com property on September 28, 2026. Google confirmed “Sitemap submitted successfully” for https://torontohousemarket.com/sitemap.xml. The immediate sitemap report still showed the previous “Couldn't fetch” status, so submission acceptance is confirmed; a successful new Google fetch is not yet claimed.

Google confirmed “Indexing requested” for both https://torontohousemarket.com/seller and https://torontohousemarket.com/. Both URLs were added to the priority crawl queue. The homepage was already indexed; /seller was unknown to Google at inspection. Indexing requests do not establish that the seller page is now indexed or that rankings improved.

The prior browser disconnection is resolved. The new FAQ sections have source and deployment verification; no visual browser review is claimed in this release note.

Do not rerun the old release workflow blindly: it pins the prior production version as a guard. Keep main/Phase 5 untouched and follow .github/PROJECT_PHASES.md for future changes.
