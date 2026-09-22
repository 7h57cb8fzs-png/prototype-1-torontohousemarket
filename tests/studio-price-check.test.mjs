import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { condoHasSameSizeRange, priceCheckSelection } from '../worker-v11.js';

const studio = (unit, changes = {}) => ({
  ListingKey: `W10000${unit}`, StreetNumber: '2464', StreetName: 'Weston',
  StreetSuffix: 'Road', UnitNumber: String(unit),
  UnparsedAddress: `2464 Weston Road ${unit}, Toronto, ON M9N 2A2`,
  City: 'Toronto', CityRegion: 'Weston', PostalCode: 'M9N 2A2',
  PropertyType: 'Residential Condo & Other', PropertySubType: 'Condo Apartment',
  LivingAreaRange: '0-499', BedroomsTotal: 0, BedroomsAboveGrade: 0,
  BedroomsBelowGrade: 0, BathroomsTotalInteger: 1, ListPrice: 249000,
  StandardStatus: 'Active', TransactionType: 'For Sale', ...changes,
});

test('studio comparisons accept the recorded 0–499 band and zero bedrooms', () => {
  const subject = studio(505);
  const peers = [studio(605), studio(705), studio(805, { LivingAreaRange: '0–499' })];
  const result = priceCheckSelection(subject, peers);
  assert.equal(result.subjectSize, '0–499 sq ft');
  assert.equal(result.count, 3);
  assert.equal(result.available, true);
  assert.equal(result.signal, 'inline');
  assert.ok(result.matches.every(row => row.beds === 0));
  assert.equal(condoHasSameSizeRange(subject, { BuildingAreaTotal: 450 }), true);
});

test('studio comparisons preserve size and bedroom exclusions', () => {
  const subject = studio(505);
  for (const size of ['', null, '0', '0-0', '-1-499', '499-0', '<500', '500+', '500-599']) {
    const candidate = studio(605, { LivingAreaRange: size });
    assert.equal(condoHasSameSizeRange(subject, candidate), false, String(size));
    assert.equal(priceCheckSelection(subject, [candidate]).count, 0, String(size));
  }
  const result = priceCheckSelection(subject, [studio(605), studio(705, { BedroomsTotal: 1, BedroomsAboveGrade: 1 })]);
  assert.equal(result.count, 1);
  assert.equal(result.relatedMatches.length, 1);
  assert.equal(result.available, false);
  assert.equal(result.medianAsk, null);
});

test('studio price endpoint searches inventory instead of returning missing-size evidence', async t => {
  const calls = [];
  const subject = studio(505), peers = [studio(605), studio(705), studio(805)];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith(`('${subject.ListingKey}')`)) return Response.json(subject);
    if (url.searchParams.has('$count')) return Response.json({ '@odata.count': peers.length, value: [] });
    return Response.json({ value: peers });
  });
  const response = await worker.fetch(new Request(`https://example.com/api/price-check?listingKey=${subject.ListingKey}`), { PUBLIC_DISCOVERY_ENABLED: 'true', AMPRE_TOKEN: 'fixture' }, {});
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(calls.some(url => url.searchParams.has('$count')));
  assert.equal(result.coverage.scanned, 3);
  assert.equal(result.count, 3);
  assert.equal(result.subjectSize, '0–499 sq ft');
});
