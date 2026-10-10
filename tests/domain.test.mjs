import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, filterEvents, normalize, histogram, changes, twinIds, isProvisionalDepth, HOUR } from '../public/domain.js';

test('surface distance handles same point, dateline and antipodes', () => {
  assert.equal(distanceKm({ lat: 8, lon: -80 }, { lat: 8, lon: -80 }), 0);
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }) - 222.39) < 0.1);
  assert.ok(Number.isFinite(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })));
});

test('catalog normalization preserves missing magnitudes and discards invalid coordinates', () => {
  const feature = { id: 'us1', geometry: { coordinates: [-80, 8, 10] }, properties: { type: 'earthquake', time: 1000, mag: null } };
  const events = normalize([feature, { ...feature, geometry: { coordinates: [-80, 98, 10] } }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].mag, null);
  assert.equal(events[0].depth, 10);
});

test('filters enforce radius, time, magnitude, and retain unknown magnitude only with all selected', () => {
  const now = 20 * HOUR;
  const options = { center: { lat: 8, lon: -80 }, radius: 100, hours: 1, minMag: 0 };
  const events = [
    { id: 'in', lat: 8, lon: -80, time: now - HOUR, mag: 4 },
    { id: 'unknown', lat: 8, lon: -80, time: now, mag: null },
    { id: 'far', lat: 9, lon: -80, time: now, mag: 6 },
    { id: 'old', lat: 8, lon: -80, time: now - HOUR - 1, mag: 5 },
    { id: 'future', lat: 8, lon: -80, time: now + 1, mag: 5 },
  ];
  assert.deepEqual(filterEvents(events, options, now).map(e => e.id), ['in', 'unknown']);
  assert.deepEqual(filterEvents(events, { ...options, minMag: 4 }, now).map(e => e.id), ['in']);
  assert.equal(filterEvents(events, { ...options, minMag: 5 }, now).length, 0);
});

test('histogram counts boundary events once and excludes events beyond selected period', () => {
  const now = 24 * HOUR;
  const bins = histogram([{ time: 0, mag: 3 }, { time: now, mag: 5 }, { time: -1, mag: 7 }, { time: now + 1, mag: 7 }], 24, now);
  assert.equal(bins[0].count, 1);
  assert.equal(bins[23].count, 1);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 2);
  assert.equal(bins[23].maxMag, 5);
});

test('initial load and revisions never masquerade as newly published events', () => {
  const events = [{ id: 'existing', updated: 2 }, { id: 'new', updated: 1 }];
  assert.deepEqual(changes(null, events), { added: [], revised: [] });
  const result = changes(new Map([['existing', 1]]), events);
  assert.deepEqual(result.added.map(e => e.id), ['new']);
  assert.deepEqual(result.revised.map(e => e.id), ['existing']);
});

test('twin records are flagged only across catalogs, within 20 s and 80 km', () => {
  const events = [
    { id: 'up1', source: 'up', lat: 8, lon: -80, time: 100_000 },
    { id: 'us1', source: 'usgs', lat: 8.3, lon: -80, time: 110_000 },
    { id: 'up2', source: 'up', lat: 8, lon: -80, time: 105_000 },
    { id: 'us-far', source: 'usgs', lat: 10, lon: -80, time: 100_000 },
    { id: 'us-late', source: 'usgs', lat: 8, lon: -80, time: 200_000 },
  ];
  assert.deepEqual([...twinIds(events)].sort(), ['up1', 'up2', 'us1']);
  assert.equal(twinIds(events.filter(e => e.source === 'up')).size, 0);
});

test('only a depth of exactly 10 km is marked provisional', () => {
  assert.equal(isProvisionalDepth(10), true);
  assert.equal(isProvisionalDepth(10.4), false);
  assert.equal(isProvisionalDepth(null), false);
});
