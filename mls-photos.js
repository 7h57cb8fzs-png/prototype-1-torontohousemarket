// Keep the current listing's licensed IDX media and its editorial order together.
const ROOT = 'https://query.ampre.ca/odata/';
const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;
const truthy = value => /^(true|yes|y|1)$/i.test(String(value ?? ''));

function sequence(row) {
  for (const field of ['Order', 'MediaOrder', 'MediaSequence', 'SequenceNumber', 'PhotoNumber', 'MediaIndex', 'SortOrder']) {
    const raw = row?.[field];
    if (raw == null || typeof raw === 'boolean' || String(raw).trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return UNKNOWN_ORDER;
}

function primary(row) {
  return ['PreferredPhotoYN', 'PrimaryPhotoYN', 'IsPrimary', 'MainPhotoYN'].some(field => truthy(row?.[field]));
}

function variantRank(row) {
  const size = String(row.ImageSizeDescription || '').toLowerCase();
  if (size.includes('nowatermark') || /-nw$/i.test(row.MediaKey)) return 20;
  if (size === 'largest') return 0;
  if (size === 'large' || /-l$/i.test(row.MediaKey)) return 1;
  if (size === 'medium' || /-m$/i.test(row.MediaKey)) return 2;
  if (size === 'thumbnail' || size === 'small' || /-t$/i.test(row.MediaKey)) return 3;
  return 4;
}

function belongsToListing(row, listingKey, embedded = true) {
  if (!row || (row.ResourceName && String(row.ResourceName).toLowerCase() !== 'property')) return false;
  if (!row.ResourceRecordKey) return embedded;
  return !listingKey || String(row.ResourceRecordKey).toUpperCase() === String(listingKey).toUpperCase();
}

export function normalizeListingPhotos(records, listingKey) {
  const groups = new Map();
  for (const row of records || []) {
    if (!belongsToListing(row, listingKey) || truthy(row.DeletedYN) || truthy(row.IsDeleted) || /^(deleted|inactive|removed|archived)$/i.test(String(row.MediaStatus || ''))) continue;
    const key = String(row.MediaKey || '');
    const url = String(row.MediaURL || '');
    if (!key || !/^https:\/\//i.test(url)) continue;
    if (row.MediaCategory && !/^(photo|image)$/i.test(row.MediaCategory)) continue;
    const type = String(row.MediaType || '').toLowerCase();
    if (type ? !type.startsWith('image/') : !/\.(jpe?g|png|webp|avif)(\?|$)/i.test(url)) continue;
    // Size variants share a media identity. An order number is not an identity:
    // two distinct photos may have the same or an absent Order.
    const identity = key.replace(/-(?:l|m|t|nw)$/i, '');
    const candidate = { key, url, directUrl: url, fallbackUrl: `/api/media?key=${encodeURIComponent(key)}`,
      description: row.ShortDescription || row.LongDescription || null,
      sequence: sequence(row), primary: primary(row), rank: variantRank(row) };
    const current = groups.get(identity);
    if (!current) groups.set(identity, candidate);
    else {
      const chosen = candidate.rank < current.rank ? candidate : current;
      chosen.primary = current.primary || candidate.primary;
      chosen.sequence = Math.min(current.sequence, candidate.sequence);
      groups.set(identity, chosen);
    }
  }
  // Stable ties preserve feed order. UUIDs and modification times aren't MLS order.
  return [...groups.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sequence - b.sequence)
    .map(({ rank, ...photo }) => photo);
}

export async function loadListingMedia(property, env, fetchFeed) {
  const key = String(property.ListingKey || '');
  if (!key) return [];
  const embedded = Array.isArray(property.Media) ? property.Media : [];
  const rows = embedded.filter(row => belongsToListing(row, key));
  let next = property['Media@odata.nextLink'];
  if (!rows.length && !next) {
    const params = new URLSearchParams({ '$top': '1000', '$filter': `contains(ResourceRecordKey,'${key.replace(/'/g, "''")}')` });
    next = ROOT + 'Media?' + params;
  }
  const visited = new Set();
  // Bound pagination while retaining the provider's ordering and exact MLS identity.
  for (let page = 0; next && page < 10; page++) {
    const url = new URL(next, ROOT);
    if (url.origin !== new URL(ROOT).origin || !url.pathname.startsWith('/odata/') || visited.has(url.href)) break;
    visited.add(url.href);
    const response = await fetchFeed(url.href, env);
    if (!response.ok) break;
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.value)) break;
    rows.push(...body.value.filter(row => belongsToListing(row, key, false)));
    next = body['@odata.nextLink'];
  }
  return rows;
}
