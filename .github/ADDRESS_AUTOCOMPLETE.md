# Address completion activation

The Phase 6 address UI accepts street-only input, keeps a separate optional unit field, and falls back to manual entry. Missing a city is not a format error. Autocomplete is prepared but is inactive until GOOGLE_PLACES_API_KEY is configured in the Cloudflare Worker.

To activate:
1. Use the owner's Google Cloud project with billing and Places API (New) enabled. Apply a Places-only API restriction and conservative daily quotas for Autocomplete and Place Details; the in-process request limits are best effort, not an account-wide spending cap.
2. Store the key securely as the GOOGLE_PLACES_API_KEY Cloudflare Worker secret. Never commit it, put it in a public asset, or paste it into chat. Preserve the other bindings and secrets. Update the current guarded deployment baseline after any secret/version change.
3. Reuse the user-supplied street prefixes for the live check: Grandravine and Lonsdale. Verify a dropdown result, keyboard/touch selection, correct municipality and preservation of a separately entered condo unit. Do not send leads or emails. The integration tests use synthetic responses; they do not establish live provider coverage.

Implementation:
- Google Places Autocomplete (New) and Place Details (New), using the same session token for one choice; tokens rotate after selection.
- Canadian address/premise results within the GTA search rectangle; city comes from returned address components, including Toronto borough aliases. Street and city data never substitute for an MLS match.
- 400 ms input debounce, short-input guard, five suggestions, no-store responses, request timeout and best-effort per-IP limits. No API key goes to the browser. No IDX or VOW calls while typing.
- Visible Google Maps attribution and address-search.html privacy/terms links. Normal report capture stores the user's confirmed address, not a cache of autocomplete predictions.
- The source key is optional; no new billing account or provider secret was created by this change.

Primary documentation checked on 2026-09-15:
- https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
- https://developers.google.com/maps/documentation/places/web-service/place-details
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/documentation/places/web-service/session-pricing
