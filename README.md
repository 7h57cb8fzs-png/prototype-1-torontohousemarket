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
- AGENT_API_KEY (random 32+ character bearer secret for `/mcp` and `/api/agent/*`)

The Worker also uses the `AI` Workers AI binding declared in `wrangler.jsonc`. AI narrative generation is grounded in the structured property evidence. If the model is unavailable, a deterministic evidence-based narrative is stored so the report and buyer email do not remain stuck.

Never expose AMPRE_TOKEN or the Supabase service-role key in browser JavaScript.

## Agent MLS tools

The production Worker exposes a stateless Streamable HTTP MCP endpoint at
`https://torontohousemarket.com/mcp`. It also exposes equivalent authenticated
REST paths under `/api/agent/*`. Both require:

```text
Authorization: Bearer <AGENT_API_KEY>
```

Available MCP tools are `lookup_listing`, `search_properties`,
`get_listing_status`, `get_listing_details`, `get_listing_media`, and
`find_comparables`. Search supports a TRREB district and recent listing window:

```json
{"district":"W05","listed_within_days":19,"limit":20}
```

REST equivalents include:

- `GET /api/agent/search?district=W05&listed_within_days=19&limit=20`
- `GET /api/agent/listing/<MLS>/details`
- `GET /api/agent/listing/<MLS>/status`
- `GET /api/agent/listing/<MLS>/media`
- `GET /api/agent/listing/<MLS>/comps`

The Worker first tries the standard RESO `MlsAreaMajor` and `MlsAreaMinor`
fields. This AMPRE contract currently omits those fields and blocks filters on
`CityRegion`, so W05 uses a bounded TRREB-community mapping over paginated
collection results. Results are restricted to active for-sale records that
permit Internet listing/address display. Collection freshness and sold-data
visibility remain limited by the AMPRE/PropTx credential permissions; an empty
result means the configured credential returned no qualifying displayable rows,
not that the broader MLS necessarily contains none.

Set the agent secret interactively; never commit it:

```sh
wrangler secret put AGENT_API_KEY
```

The application includes a best-effort 60-request/minute per-key edge-cache
throttle and strict input/result limits. Configure a Cloudflare WAF rate-limiting
rule for `/mcp` and `/api/agent/*` for authoritative account-wide enforcement.

Codex MCP configuration:

```toml
[mcp_servers.toronto_house_market]
url = "https://torontohousemarket.com/mcp"
bearer_token_env_var = "TORONTO_HOUSE_MARKET_MLS_TOKEN"
```

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
