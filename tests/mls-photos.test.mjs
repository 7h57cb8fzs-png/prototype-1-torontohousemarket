import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker-v11.js';
import { normalizeListingPhotos, loadListingMedia } from '../mls-photos.js';

const key = 'W13812424';
const media = (id, order, extra = {}) => ({ MediaKey: id, MediaURL: `https://photos.example/${id}.jpg`,
  MediaType: 'image/jpeg', ResourceRecordKey: key, ResourceName: 'Property', Order: order, ...extra });
const listing = { ListingKey: key, City: 'Toronto', UnparsedAddress: '101 Test Street', StandardStatus: 'Active',
  TransactionType: 'For Sale', PropertySubType: 'Condo Apartment', ListPrice: 249000, BedroomsTotal: 1, BathroomsTotalInteger: 1 };

test('gallery groups size variants without losing the MLS cover flag or conflating equal orders', () => {
  const photos = normalizeListingPhotos([media('kitchen-l', 1), media('cover-t', 4, { PreferredPhotoYN: true }),
    media('cover-l', 4), media('other', 1), media('floorplan', 5, { MediaType: 'application/pdf' }),
    media('old-listing', 0, { ResourceRecordKey: 'W10000000' })], key);
  assert.deepEqual(photos.map(p => p.key), ['cover-l', 'kitchen-l', 'other']);
  assert.equal(photos[0].primary, true);
});

test('blank sequence fields stay unknown and stable feed order survives UUID and timestamp differences', () => {
  const photos = normalizeListingPhotos([media('z', null, { MediaModificationTimestamp: '2026-09-22' }),
    media('a', '', { MediaModificationTimestamp: '2025-01-01' }), media('first', 0)], key);
  assert.deepEqual(photos.map(p => p.key), ['first', 'z', 'a']);
  assert.equal(photos[1].sequence, Number.MAX_SAFE_INTEGER);
});

test('pagination retains current listing only and refuses foreign continuation URLs', async () => {
  const urls = [];
  const rows = await loadListingMedia({ ...listing, Media: [media('one', 1)], 'Media@odata.nextLink': `${'https://query.ampre.ca/odata/'}Media?$skip=1` }, {}, async url => {
    urls.push(url); return Response.json({ value: [media('two', 2), media('foreign', 0, { ResourceRecordKey: 'W11111111' })], '@odata.nextLink': 'https://untrusted.example/steal' });
  });
  assert.deepEqual(rows.map(p => p.MediaKey), ['one', 'two']);
  assert.equal(urls.length, 1);
});

test('public gallery and discovery thumbnail agree on the exact MLS primary photo', async t => {
  const rows = [media('kitchen', 1), media('cover', 17, { PreferredPhotoYN: true })];
  let selected;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname.includes('/Property(')) {
      assert.equal(url.searchParams.get('$expand'), 'Media');
      return Response.json({ ...listing, Media: rows });
    }
    if (url.pathname.includes('/Media(')) {
      selected = decodeURIComponent(url.pathname).match(/Media\('([^']+)'\)/)[1];
      return Response.json(rows.find(row => row.MediaKey === selected));
    }
    if (url.hostname === 'photos.example') return new Response('image', { headers: { 'Content-Type': 'image/jpeg' } });
    throw Error('Unexpected request: ' + url);
  });
  const env = { AMPRE_TOKEN: 'idx-fixture', PUBLIC_DISCOVERY_ENABLED: 'true' };
  const response = await worker.fetch(new Request(`https://example.com/api/property?listingKey=${key}`), env, {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.property.photos.map(p => p.key), ['cover', 'kitchen']);
  assert.equal(body.property.photoCount, 2);
  assert.equal(body.property.photos[0].fallbackUrl, '/api/media?key=cover');
  const thumb = await worker.fetch(new Request(`https://example.com/api/discovery-photo?listingKey=${key}`), env, {});
  assert.equal(thumb.status, 200);
  assert.equal(selected, body.property.photos[0].key);
});

test('restricted listings expose no gallery or discovery thumbnail and never query Media', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    assert.match(new URL(input).pathname, /\/Property\(/);
    return Response.json({ ...listing, InternetEntireListingDisplayYN: false, Media: [media('hidden', 1)] });
  });
  const env = { AMPRE_TOKEN: 'idx-fixture', PUBLIC_DISCOVERY_ENABLED: 'true' };
  const response = await worker.fetch(new Request(`https://example.com/api/property?listingKey=${key}`), env, {});
  const body = await response.json();
  assert.deepEqual(body.property.photos, []);
  assert.equal((await worker.fetch(new Request(`https://example.com/api/discovery-photo?listingKey=${key}`), env, {})).status, 404);
});
