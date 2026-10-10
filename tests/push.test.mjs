import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedisStore, parseSubscription, runPushCheck, subscriptionKey } from '../sources/push.mjs';
import { PANAMA, HOUR } from '../public/domain.js';

// The handful of Upstash commands the store uses, in memory and shared between "instances".
function fakeRedis() {
  const zsets = new Map();
  const hashes = new Map();
  const zset = key => zsets.get(key) ?? zsets.set(key, new Map()).get(key);
  const hash = key => hashes.get(key) ?? hashes.set(key, new Map()).get(key);
  const redis = {
    async zadd(key, ...args) {
      const nx = args[0]?.nx === true;
      let added = 0;
      for (const { score, member } of args.filter(arg => 'member' in arg)) {
        if (zset(key).has(member) && nx) continue;
        if (!zset(key).has(member)) added++;
        zset(key).set(member, score);
      }
      return added;
    },
    async zrange(key) { return [...zset(key).keys()]; },
    async zremrangebyscore(key, min, max) { for (const [member, score] of zset(key)) if (score <= max) zset(key).delete(member); },
    async hgetall(key) { return hash(key).size ? Object.fromEntries(hash(key)) : null; },
    async hget(key, field) { return hash(key).get(field) ?? null; },
    async hset(key, values) { for (const [field, value] of Object.entries(values)) hash(key).set(field, structuredClone(value)); },
    async hdel(key, field) { return hash(key).delete(field) ? 1 : 0; },
    async hlen(key) { return hash(key).size; },
    async hexists(key, field) { return hash(key).has(field) ? 1 : 0; },
    pipeline() {
      const calls = [];
      return { zadd: (...args) => calls.push(() => redis.zadd(...args)), exec: async () => { const out = []; for (const call of calls) out.push(await call()); return out; } };
    },
  };
  return redis;
}

const NOW = Date.parse('2026-10-10T12:00:00Z');
const quake = (id, overrides = {}) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-80.3, 7.5, 10] },
  properties: { type: 'earthquake', source: id.startsWith('up') ? 'up' : 'usgs', time: NOW - 10 * 60_000, mag: 4.2, place: 'Panamá', updated: 1, ...overrides } });
const catalogs = (features, sources = ['up', 'usgs']) => async () => ({ data: { type: 'FeatureCollection', features },
  sources: sources.map(id => ({ id, available: true, error: null })) });
const browser = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => ({ endpoint, keys: { p256dh: 'BPk', auth: 'xyz' } });
const filters = { located: false, radius: 1000, minMag: 0, source: 'all', hours: 24 };

async function subscribe(store, endpoint, extra = {}) {
  const record = parseSubscription({ subscription: browser(endpoint), filters: { ...filters, ...extra } });
  await store.saveSubscription(subscriptionKey(endpoint), record);
}

test('subscriptions accept only browser push services and round a personal location', () => {
  assert.equal(parseSubscription({ subscription: browser('https://evil.example.com/x'), filters }), null);
  assert.equal(parseSubscription({ subscription: browser('http://fcm.googleapis.com/x'), filters }), null);
  assert.equal(parseSubscription({ subscription: { endpoint: 'https://fcm.googleapis.com/x' }, filters }), null);
  const apple = parseSubscription({ subscription: browser('https://web.push.apple.com/abc'), filters: { ...filters, located: true, lat: 9.01234, lon: -79.5321, radius: 7 } });
  assert.deepEqual(apple.filters, { located: true, lat: 9, lon: -79.5, radius: 1000, minMag: 0, source: 'all', hours: 24 });
  const panama = parseSubscription({ subscription: browser(), filters: { ...filters, lat: 9.01234, lon: -79.5321 } });
  assert.deepEqual([panama.filters.lat, panama.filters.lon], [PANAMA.lat, PANAMA.lon]);
});

test('first check seeds each source without notifying; later records notify matching subscriptions once', async () => {
  const redis = fakeRedis();
  const store = createRedisStore(redis, { now: () => NOW });
  const sent = [];
  const send = async (subscription, message) => sent.push({ endpoint: subscription.endpoint, message });
  await subscribe(store, 'https://fcm.googleapis.com/fcm/send/all');
  await subscribe(store, 'https://fcm.googleapis.com/fcm/send/big', { minMag: 5 });
  assert.deepEqual(await runPushCheck({ store, send, now: NOW, loadCatalogs: catalogs([quake('up-old'), quake('us-old')]) }), { fresh: 0, sent: 0, removed: 0, failed: 0 });

  const latest = catalogs([quake('up-old'), quake('us-old'), quake('up-new', { mag: 4.6 }), quake('us-new', { mag: 3.1 })]);
  const result = await runPushCheck({ store, send, now: NOW, loadCatalogs: latest });
  assert.deepEqual(result, { fresh: 2, sent: 1, removed: 0, failed: 0 });
  assert.equal(sent[0].endpoint, 'https://fcm.googleapis.com/fcm/send/all');
  assert.equal(sent[0].message.title, '2 nuevos registros en tu zona');
  assert.equal(sent[0].message.id, 'up-new');

  // Another instance with an empty cache must not announce the same records again.
  const other = createRedisStore(redis, { now: () => NOW });
  assert.equal((await runPushCheck({ store: other, send, now: NOW, loadCatalogs: latest })).fresh, 0);
  assert.equal((await runPushCheck({ store, send, now: NOW, loadCatalogs: latest })).fresh, 0);
  assert.equal(sent.length, 1);
});

test('a source that was unavailable is seeded when it returns instead of announcing its whole catalog', async () => {
  const store = createRedisStore(fakeRedis(), { now: () => NOW });
  const sent = [];
  await subscribe(store, 'https://fcm.googleapis.com/fcm/send/all');
  await runPushCheck({ store, now: NOW, send: async () => sent.push(1), loadCatalogs: catalogs([quake('us-old')], ['usgs']) });
  const result = await runPushCheck({ store, now: NOW, send: async () => sent.push(1), loadCatalogs: catalogs([quake('us-old'), quake('up-a'), quake('up-b')]) });
  assert.equal(result.fresh, 0);
  assert.equal(sent.length, 0);
});

test('expired subscriptions are removed, other push errors are kept', async () => {
  const store = createRedisStore(fakeRedis(), { now: () => NOW });
  await subscribe(store, 'https://fcm.googleapis.com/fcm/send/gone');
  await subscribe(store, 'https://updates.push.services.mozilla.com/wpush/v2/busy');
  await runPushCheck({ store, now: NOW, send: async () => {}, loadCatalogs: catalogs([quake('us-old')]) });
  const send = async subscription => { throw Object.assign(new Error('push failed'), { statusCode: subscription.endpoint.includes('gone') ? 410 : 503 }); };
  const result = await runPushCheck({ store, now: NOW, send, loadCatalogs: catalogs([quake('us-old'), quake('us-new')]) });
  assert.deepEqual(result, { fresh: 1, sent: 0, removed: 1, failed: 1 });
  assert.deepEqual((await store.subscriptions()).map(record => record.subscription.endpoint), ['https://updates.push.services.mozilla.com/wpush/v2/busy']);
});

test('subscription filters apply distance from a stored location and the period', async () => {
  const store = createRedisStore(fakeRedis(), { now: () => NOW });
  const sent = [];
  await subscribe(store, 'https://fcm.googleapis.com/fcm/send/costa-rica', { located: true, lat: 9.93, lon: -84.08, radius: 100 });
  await subscribe(store, 'https://fcm.googleapis.com/fcm/send/hour', { hours: 1 });
  await runPushCheck({ store, now: NOW, send: async () => {}, loadCatalogs: catalogs([quake('us-old')]) });
  const late = quake('us-late', { time: NOW - 2 * HOUR });
  const result = await runPushCheck({ store, now: NOW, send: async (subscription, message) => sent.push(message), loadCatalogs: catalogs([quake('us-old'), quake('us-new'), late]) });
  assert.equal(result.fresh, 2);
  assert.equal(result.sent, 1); // Costa Rica is ~420 km away; the hour filter accepts only us-new.
  assert.equal(sent[0].id, 'us-new');
  assert.match(sent[0].body, /km del centro de Panamá/);
});
