from pathlib import Path
import hashlib
import re

root = Path('.')
f = root / 'worker-v11.js'
s = f.read_text()

def replace(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:90], s.count(old), count)
    s = s.replace(old, new)

replace("import {sellerArchiveKey,validatedArchive} from './seller-archive.js';", "import {sellerArchiveKey,validatedArchive} from './seller-archive.js';\nimport { historicalSellerProfile, historicalSellerProperty } from './seller-mls-input.js';")
replace('const checked = validateAddressEntry(data.property_input, { city: profile.city, requireUnit: /condo/i.test(profile.homeType) });', '// Questionnaire fields are saved for the team, never used to identify the home.\n      const checked = validateAddressEntry(data.property_input);')
replace('      profile.city = checked.city;\n', '')
replace('if (lead.lead_mode === "seller" && lead.property_snapshot?.sellerProfile) return loadSellerPropertyForReport(env, lead, requestId);', 'if (lead.lead_mode === "seller") return loadSellerPropertyForReport(env, lead, requestId);')

start = s.index('async function resolveSellerSubject(')
end = s.index('__name(resolveSellerSubject, "resolveSellerSubject");', start)
new = s[start:end].replace('const parsed = sellerParsedAddress(address);', 'const parsed = sellerHistoryParsedAddress(address);', 1)
new = new.replace('const city = profile.city || parsed.city || "";', 'const city = parsed.city || "";')
a = new.index('  const street = escapeOData2(')
b = new.index('  const candidates =', a)
new = new[:a] + r'''  // No date/status restriction: old MLS records identify the home, not its value.
  // An HTTP-200 empty combined filter is NOT proof of absent MLS history.
  const names = [...new Set([parsed.name.split(" ").map(displayToken2).join(" "), parsed.name.toUpperCase(), parsed.name.toLowerCase()])];
  const number = escapeOData2(parsed.number);
  const cityWord = escapeOData2(city.split(/[\s-]+/).sort((a,b)=>b.length-a.length)[0] || "");
  const queryToken = name => name.split(/\s+/).filter(w=>!/^the$|^st$|^saint$/i.test(w)).sort((a,b)=>b.length-a.length)[0] || name;
  const streetFilters = [...new Set(names.map(name => `contains(StreetName,'${escapeOData2(queryToken(name))}')`))];
  const streetFilter = streetFilters[0];
  const exactQueries = streetFilters.map(filter => `${filter} and contains(StreetNumber,'${number}')${cityWord ? ` and contains(City,'${cityWord}')` : ""}`);
  const fallbackQueries = [...streetFilters, ...names.map(name=>`contains(UnparsedAddress,'${escapeOData2(parsed.number+" "+name)}')`)];
''' + new[b:]
new = new.replace('sellerExactHistoryMatch(', 'sellerHistoryMatches(')
new = new.replace('      if (candidates.size) break;\n      if (result2.complete && filter.includes(\'StreetNumber\') && filter.includes(\'StreetName\') && (!city || filter.includes(\'City\'))) { diagnostics.exactSearchComplete=true;complete=true;break; }', '      // Finish the narrow case variants, including when the first one is empty.\n      if (candidates.size && queries === fallbackQueries) break;')
new = new.replace('  if (!candidates.size && !diagnostics.exactSearchComplete) await runFilters(fallbackQueries, 500);', '  if (!candidates.size) await runFilters(fallbackQueries, 500);\n  diagnostics.exactSearchComplete = complete;')
new = new.replace('  const exactChecksCompleted = diagnostics.queries.some(q => q.complete && q.filter.includes("StreetName") && !q.filter.includes("UnparsedAddress"));\n', '')
new = new.replace('if (!complete && !diagnostics.exactSearchComplete && !candidates.size', 'if (!complete && !candidates.size')
new = new.replace('const p = sellerParsedAddress(r.UnparsedAddress || buildAddress(r));', 'const p = sellerHistoryParsedAddress(r.UnparsedAddress || buildAddress(r));')
new = new.replace('"PropertySubType", "PropertyType", "LivingAreaRange"', '"PropertySubType", "PropertyType", "ArchitecturalStyle", "BathroomsTotalInteger", "LotSizeUnits", "ParkingTotal", "LivingAreaRange"')
helpers = r'''// Historic MLS compound street names may store the suffix as part of StreetName.
// This normalization is used only by the Seller history resolver.
function sellerHistoryParsedAddress(address) {
  const parsed = sellerParsedAddress(address);
  if (parsed.name === "the" && parsed.suffix) return { ...parsed, name: `the ${parsed.suffix}`, suffix: null };
  return parsed;
}
function sellerHistoryMatches(parsed, row, city) {
  const candidate = sellerHistoryParsedAddress(row.UnparsedAddress || buildAddress(row));
  const norm = value => normalizeText(value || "");
  const suffix = value => /^(?:n\/?a|none|unknown)$/i.test(String(value || "")) ? "" : canonicalStreetType(value) || "";
  const fullStreet = (name, type) => [canonicalLookupStreet(name), suffix(type)].filter(Boolean).join(" ");
  const expected = fullStreet(parsed.name, parsed.suffix);
  const actual = fullStreet(row.StreetName || candidate.name, Object.hasOwn(row, "StreetSuffix") ? row.StreetSuffix : candidate.suffix);
  const unit = norm(Object.hasOwn(row, "UnitNumber") ? row.UnitNumber || "" : candidate.unit || "");
  const streetMatches = parsed.suffix ? expected === actual : canonicalLookupStreet(parsed.name) === canonicalLookupStreet(row.StreetName || candidate.name) || expected === actual;
  const direction = canonicalDirection(row.StreetDirSuffix || row.StreetDirPrefix) || candidate.direction || null;
  return norm(parsed.number) === norm(row.StreetNumber || candidate.number) && streetMatches && norm(parsed.unit) === unit && (!parsed.direction || parsed.direction === direction) && (!city || sellerCityMatches(city, row.City || candidate.city));
}
'''
s = s[:start] + helpers + new + s[end:]

start = s.index('async function loadSellerPropertyForReport(')
end = s.index('__name(loadSellerPropertyForReport,', start)
loader = r'''async function loadSellerPropertyForReport(env, lead, requestId) {
  const address = lead.resolved_address || lead.metadata?.property_input || "";
  const parsed = sellerHistoryParsedAddress(address);
  const protectedEnv = { ...env, AMPRE_TOKEN: env.AMPRE_VOW_TOKEN };
  let raw = null, lookupError = null;
  const lookupDiagnostics = {};
  if (env.AMPRE_VOW_TOKEN) try {
    raw = await resolveSellerSubject(address, {}, protectedEnv, lookupDiagnostics);
  } catch (e) {
    lookupError = "Historical MLS lookup could not be completed.";
    lookupDiagnostics.error = clean5(e.message, 180);
  }
  // A server-side previous-MLS hint is only a lookup aid; exact identity still wins.
  const previousMls = clean5(lead.metadata?.previous_mls_number || lead.metadata?.previousMlsNumber || "", 40).toUpperCase();
  if (!raw && /^[A-Z]\d{7,9}$/.test(previousMls) && env.AMPRE_VOW_TOKEN) {
    const byKey = await fetchPropertyByKey(previousMls, protectedEnv, false).catch(() => null);
    if (byKey && sellerHistoryMatches(parsed, byKey, parsed.city)) {
      const at = sellerListingTime(byKey);
      raw = { ...byKey, _sellerHistory: [{ listingKey: byKey.ListingKey, status: byKey.StandardStatus || byKey.MlsStatus || byKey.ContractStatus || "Recorded listing", recordedAt: at ? new Date(at).toISOString() : null }], _sellerFactSources: Object.fromEntries(Object.keys(byKey).filter(k=>byKey[k] != null).map(k=>[k,byKey.ListingKey])), _sellerLookupAudit: [], _sellerHistoryComplete: false };
      lookupDiagnostics.previousMlsMatch = previousMls;
      lookupError = null;
    } else lookupDiagnostics.previousMlsMiss = previousMls;
  }
  // Reviewed archived MLS documents may be used; generic public portal profiles
  // and the seller questionnaire must never silently become property evidence.
  if (!raw && env.SUPABASE_SERVICE_ROLE_KEY) {
    const r = await supabase(env, `/rest/v1/seller_subject_archives?address_key=eq.${encodeURIComponent(sellerArchiveKey(parsed, parsed.city))}&select=*&limit=1`);
    const rows = await r.json().catch(() => []);
    const row = r.ok ? rows[0] : null;
    if (row?.facts?._provenance?.kind === "reviewed_mls" && /^[A-Z]\d{7,9}$/.test(row.facts._provenance.listingKey || "")) raw = validatedArchive(row, parsed, parsed.city, sellerHistoryMatches);
    if (raw) lookupError = null;
  }
  const historical = historicalSellerProperty(raw, address, parsed);
  const subject = { ...(raw || {}), ListingKey: raw?.ListingKey || null, UnparsedAddress: address,
    StreetNumber: raw?.StreetNumber || parsed.number, StreetName: raw?.StreetName || parsed.name,
    StreetSuffix: raw?.StreetSuffix ?? parsed.suffix, StreetDirSuffix: raw?.StreetDirSuffix ?? parsed.direction,
    UnitNumber: raw?.UnitNumber ?? parsed.unit, City: historical.city, CityRegion: historical.cityRegion,
    PostalCode: historical.postalCode, PropertySubType: historical.propertySubType,
    LivingAreaRange: historical.livingAreaRange, ListPrice: null, ClosePrice: null, SoldPrice: null,
    SalePrice: null, PurchaseContractPrice: null, FinalSalePrice: null, _sellerReport: true };
  let comp = calculateSellerEvidence(subject, []);
  // No matched home means no comparable search based on owner-supplied guesses.
  if (raw && !comp.missingFacts && env.AMPRE_VOW_TOKEN) comp = await buildSellerEvidence(subject, protectedEnv).catch(() => ({ ...unavailableComp("The sold-data check could not be completed. The team will retry it."), dataUnavailable: true }));
  if (!raw) comp = { ...comp, available: false, comparables: [], activeComparables: [],
    basis: !env.AMPRE_VOW_TOKEN ? "The historical and sold-data service is not configured." : lookupError ? lookupError + " We need to retry the data check." : "No exact historical MLS record was recovered for this address. The team needs to verify the lookup or the previous MLS number; seller answers are saved separately and do not replace MLS facts.",
    dataUnavailable: !!lookupError || !env.AMPRE_VOW_TOKEN };
  comp.policy = { ...comp.policy, subjectFactsSource: "historical_mls", sellerAnswersUsed: false };
  if (raw && raw._sellerHistoryComplete === false) comp.policy.retrievalCapped = true;
  const matched = !!raw;
  const property = { ...historical,
    forSale: raw && raw._sellerHistoryComplete !== false && !raw._sellerArchive ? isActiveForSale(raw) : null,
    marketStatus: raw && raw._sellerHistoryComplete !== false && !raw._sellerArchive ? isActiveForSale(raw) ? "Currently listed for sale" : /closed|sold|expired|terminated|withdrawn|cancel|suspend|leased|rented|unavailable/i.test(`${raw.StandardStatus || ""} ${raw.MlsStatus || ""} ${raw.ContractStatus || ""}`) ? "Not currently listed for sale" : "Listing status unconfirmed" : "Listing status unconfirmed",
    reportOfferInstructions: raw ? extractOfferInstructions(raw) : null,
    comparableContext: comp,
    sellerEvidence: { listingMatched: matched && !raw._sellerArchive, subjectMatched: matched,
      archiveSubject: raw?._sellerArchive || null, listingFactsAgree: matched,
      communitySource: historical.cityRegion ? "Historical MLS record" : "Unresolved",
      factsSource: matched ? "Historical MLS records; current condition not verified" : "Unresolved historical MLS lookup",
      valuationInputPolicy: "address_and_historical_mls_only", sellerAnswersUsed: false,
      history: raw?._sellerHistory || [],
      diagnostics: { historyLookup: lookupDiagnostics, historyQuery: raw?._sellerLookupAudit || [], comparisons: comp.diagnostics || null },
      fieldSources: raw?._sellerFactSources || {}, communityConflict: false }
  };
  property.sellerProfile = historicalSellerProfile(property);
  return property;
}
'''
s = s[:start] + loader + s[end:]
replace('const profile = { ...property2.sellerProfile, upgrades: [] }, comp = property2.comparableContext || {}, comparables = (comp.comparables || []).slice(0, 8);', 'const profile = historicalSellerProfile(property2), comp = property2.comparableContext || {}, comparables = (comp.comparables || []).slice(0, 8);')
replace('  const valid = comp.available === true && comparables.length >= 3', '  const valid = (property2.sellerEvidence?.subjectMatched ?? property2.sellerEvidence?.listingMatched) === true && comp.available === true && comparables.length >= 3')
replace('beds: property2.beds ?? profile.beds, baths:', 'beds: property2.beds ?? null, baths:')
replace('below_grade_beds: profile.belowBeds, basement: property2.basement ?? profile.basement, separate_entrance: profile.entrance, kitchens: property2.kitchens ?? profile.kitchens,', 'below_grade_beds: property2.belowGradeBeds ?? null, basement: property2.basement ?? "unknown", separate_entrance: property2.separateEntrance ?? "unknown", kitchens: property2.kitchens ?? null, architectural_style: property2.architecturalStyle ?? null, mls_fact_source: property2.sellerEvidence?.factsSource || "Unresolved",')
replace('"Past listings help identify the home. Historical asking prices do not set this estimate."', '"Property characteristics are based on historical MLS records and may not reflect changes since that listing. Seller answers are saved separately for the team to verify; they do not select comparables or set this estimate. Historical asking prices do not set the value."')
replace('These are historic facts, not a current survey; confirm present layout, size and condition. The estimate uses licensed sold comparisons, not historic asking or rental prices.', 'These are historical MLS facts and may not reflect current layout, size or condition. Seller questionnaire answers are kept separately for the team to verify, not used as valuation evidence. The estimate uses recent licensed sold comparisons, not historical asking or sale prices.')
f.write_text(s)

f = root / 'worker-v12.js'
v = f.read_text()
start = v.index('async function enhanceSellerReport(')
end = v.index('async function openAiBuyerNarrative(', start)
part = v[start:end]
part = part.replace('const pct = sellerRenovationPct(report?.seller?.profile?.notes || property?.sellerProfile?.notes || "");', 'const pct = null; // Seller questionnaire remains in the lead, never in AI evidence.')
part = part.replace('  const expectation = report?.seller?.target_range || null;\n', '')
part = part.replace('    renovationPct: pct,\n', '').replace('    sellerExpectation: expectation ? { low: expectation.low, high: expectation.high } : null,', '    inputPolicy: "address_and_historical_mls_only",')
part = part.replace("The renovation percentage is the owner's broad subjective description, not a mechanical price adjustment. Use it only as qualitative context when interpreting the sold evidence and current competition. Do not output or apply a percentage adjustment to the valuation.", 'The supplied home facts come from historical MLS records, not seller questionnaire answers. They may not reflect present condition. Do not infer recent renovations, kitchen changes, size, bedroom changes or seller expectations. Do not output or apply a condition adjustment to the valuation.')
part = part.replace("Never let the seller's expected minimum/maximum set or bias the independent valuation; compare expectations only after forming your view.", 'No seller expectations are supplied; leave expectation_comparison empty.')
part = part.replace('treatment: "context_only",', 'treatment: "not_used",').replace('note: "Owner-reported renovation level informs the Realtor-style interpretation of evidence; it is not applied as a fixed percentage or dollar adjustment."', 'note: "Seller questionnaire answers are retained separately with the lead for future verification. Only historical MLS facts are supplied to this analysis."')
part = part.replace('ai_note: `OpenAI seller strategy · renovation context ${pct == null ? "not provided" : pct + "%"} · owner expectation excluded from independent valuation`,', 'ai_note: "OpenAI seller strategy from historical MLS evidence only; seller questionnaire excluded",')
v = v[:start] + part + v[end:]
v = v.replace('historicalSubjectSource: property.sellerEvidence?.archiveSubject || null,', 'historicalSubjectSource: property.sellerEvidence?.archiveSubject || null,\n    ...(property.sellerEvidence ? {architecturalStyle: property.architecturalStyle || null, belowGradeBeds: property.belowGradeBeds ?? null, bedroomBasis: property.bedroomBasis || null} : {}),')
f.write_text(v)
f = root / 'worker-v22.js'
v = f.read_text().replace("seller_condition:'native 0-100 renovation context; no fixed renovation markup',", "seller_condition:'questionnaire saved for team verification; not valuation input',\n      seller_input:'address_and_historical_mls_only',")
f.write_text(v)
f = root / '.assetsignore'
f.write_text(f.read_text() + '\nseller-mls-input.js\n')
f = root / 'tests/seller-v73-policy.test.mjs'
v = f.read_text().replace('seller report preserves renovation slider context', 'seller questionnaire renovation context is excluded from the valuation report').replace('assert.equal(report.seller.profile.condition,"owner_reported");', 'assert.equal(report.seller.profile.condition,"unknown");').replace('assert.equal(report.seller.profile.renovationPct,50);', 'assert.equal(report.seller.profile.renovationPct,null);').replace('assert.match(email.html,/Owner-reported renovation context: 50%/);', 'assert.doesNotMatch(email.html,/Owner-reported renovation context: 50%/);').replace('treatment: "context_only"', 'treatment: "not_used"').replace('seller report loader preserves owner-reported slider profile and broad recovery uses City', 'seller report loader separates owner profile and broad recovery uses City')
f.write_text(v)
print('Applied Seller-only source transformation; run scope and focused regressions before committing.')
