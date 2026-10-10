import test from 'node:test';
import assert from 'node:assert/strict';
import { geoShakeFeature, geoShakeMessage, createSSEParser } from '../public/geoshake.js';
import { parseGeoShake, sendGeoShakeEvent } from '../sources/geoshake.mjs';
import { normalize, uniqueEvents, clockHourComparison, HOUR } from '../public/domain.js';

const now = Date.UTC(2026, 9, 10, 4, 14);
const event = { event_id: 99, originMs: now - 10_000, lat: 8.54, lon: -80.78, nStations: 3, stage: 1 };

test('GeoShake preserves source and unknown magnitude/depth, ignores station triggers and invalid events', () => {
  const feature = geoShakeMessage(JSON.stringify({ type: 'event', payload: event }));
  const normalized = normalize([feature])[0];
  assert.equal(normalized.source, 'geoshake');
  assert.equal(normalized.depth, null);
  assert.equal(normalized.mag, null);
  assert.equal(normalized.url, 'https://map.geoshake.org');
  assert.equal(geoShakeMessage(JSON.stringify({ type: 'trigger', payload: event })), null);
  assert.equal(geoShakeFeature({ ...event, lat: 91 }), null);
  assert.equal(geoShakeFeature({ ...event, nStations: 1 }), null);
  assert.equal(parseGeoShake(JSON.stringify([event, {}])).features.length, 1);
  assert.deepEqual(uniqueEvents([normalized]), []);
});

test('SSE handles split CRLF frames, multiline data, heartbeats, and oversized input', () => {
  const messages = [];
  const parse = createSSEParser(data => messages.push(data));
  parse(': heartbeat\r\ndata: {"type":');
  parse('"event",\r\ndata: "payload":{}}\r\n\r');
  parse('\n');
  assert.equal(messages.length, 1);
  assert.equal(JSON.parse(messages[0]).type, 'event');
  assert.throws(() => parse('x'.repeat(262145)), /too large/);
});

function storeFor(records) {
  const receipts = new Set();
  return { subscriptions: async () => records,
    claimDelivery: async (id, key) => { const value = `${id}:${key}`; if (receipts.has(value)) return null; receipts.add(value); return 'OK'; },
    releaseDelivery: async (id, key) => receipts.delete(`${id}:${key}`),
    removeSubscription: async key => { records.splice(records.findIndex(r => r.key === key), 1); } };
}
const subscriber = (key, overrides = {}) => ({ key, subscription: { endpoint: key }, filters: {
  source: 'all', located: false, lat: 8.54, lon: -80.78, radius: 1000, hours: 24, minMag: 0, ...overrides } });

test('live notifications respect source, distance and unknown magnitude; duplicates and historical replay do not notify', async () => {
  const store = storeFor([subscriber('all'), subscriber('up', { source: 'up' }), subscriber('big', { minMag: 4 }), subscriber('far', { lat: 0, lon: 0 })]);
  const sent = [];
  const options = { store, now, send: async (s, m) => sent.push(m) };
  assert.equal((await sendGeoShakeEvent(event, options)).sent, 1);
  assert.equal((await sendGeoShakeEvent(event, options)).sent, 0);
  assert.equal((await sendGeoShakeEvent({ ...event, event_id: 100, originMs: now - HOUR }, options)).sent, 0);
  assert.match(sent[0].title, /GeoShake/);
  assert.doesNotMatch(sent[0].body, /Onda S llegó/);
  assert.match(sent[0].body, /profundidad no informada/);
});

test('failed subscriber retries without duplicating successful deliveries', async () => {
  const store = storeFor([subscriber('ok'), subscriber('retry')]);
  const delivered = [];
  const first = await sendGeoShakeEvent(event, { store, now, send: async s => {
    if (s.endpoint === 'retry') throw Object.assign(new Error('busy'), { statusCode: 503 });
    delivered.push(s.endpoint);
  } });
  assert.equal(first.failed, 1);
  await sendGeoShakeEvent(event, { store, now, send: async s => delivered.push(s.endpoint) });
  assert.deepEqual(delivered, ['ok', 'retry']);
});

test('clock-hour chart compares an incomplete current hour with a full previous hour once per boundary', () => {
  const start = Math.floor(now / HOUR) * HOUR;
  const events = [{ time: start - 1, mag: 4 }, { time: start, mag: 5 }, { time: now + 1, mag: 6 }];
  const result = clockHourComparison(events, now);
  assert.equal(result.previous.count, 1);
  assert.equal(result.current.count, 1);
  assert.equal(result.start, start);
  assert.ok(result.ratio > 31 && result.ratio < 32);
  assert.equal(clockHourComparison([{ time: start, mag: 4 }], now).ratio, null);
});
