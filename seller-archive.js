// Reviewed historic MLS subject facts only. Prices and seller answers never enter this store.
export function sellerArchiveKey(parsed, city) {
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [parsed.number, parsed.name, parsed.suffix, parsed.direction, parsed.unit, city || parsed.city].map(norm).join('|');
}
export function validatedArchive(row, parsed, city, exactMatch) {
  const provenance = row?.facts?._provenance;
  if (provenance?.kind !== 'reviewed_mls' || !/^[A-Z]\d{7,9}$/.test(provenance.listingKey || '')) return null;
  if (!row.verified_at || !Number.isFinite(Date.parse(row.verified_at)) || !Number.isFinite(Date.parse(row.source_date)) || Date.parse(row.source_date) > Date.now()) return null;
  const privateDocument = /^urn:thm:mls-document:file_[a-f0-9]{32}$/.test(row.source_url || '');
  let sourceUrl = null;
  if (!privateDocument) {
    try { const source = new URL(row.source_url); if (source.protocol !== 'https:') return null; sourceUrl = source.href; } catch { return null; }
  }
  // Explicit allowlist: never copy ListPrice, ClosePrice, seller identities or notes.
  const allowed = ['UnparsedAddress','StreetNumber','StreetName','StreetSuffix','StreetDirSuffix','UnitNumber','City','CityRegion','PostalCode','PropertySubType','PropertyType','ArchitecturalStyle','LivingAreaRange','BuildingAreaTotal','BuildingAreaUnits','BedroomsAboveGrade','BedroomsBelowGrade','BedroomsTotal','BathroomsTotalInteger','LotWidth','LotDepth','LotSizeUnits','Basement','KitchensTotal','KitchensAboveGrade','ParkingTotal','GarageType'];
  const facts = Object.fromEntries(allowed.filter(k => row.facts[k] != null).map(k => [k, row.facts[k]]));
  if (!exactMatch(parsed, facts, city) || !['Detached','Semi-Detached','Att/Row/Townhouse','Condo Apartment','Condo Townhouse','Duplex'].includes(facts.PropertySubType)) return null;
  const archive = { sourceUrl, sourceKind: privateDocument ? 'reviewed_mls_document' : 'reviewed_mls_archive', mlsNumber: provenance.listingKey, sourceLabel: String(row.source_label || 'Reviewed historical MLS record').slice(0,120), recordedAt: row.source_date, verifiedAt: row.verified_at };
  return { ...facts, ListingKey: provenance.listingKey, StandardStatus: 'Unknown', _sellerArchive: archive,
    _sellerHistory: [{ listingKey: provenance.listingKey, status: 'Historical MLS document; current status unconfirmed', recordedAt: row.source_date }],
    _sellerHistoryComplete: false, _sellerFactSources: Object.fromEntries(Object.keys(facts).map(k => [k, provenance.listingKey])) };
}
