import { createHash } from 'node:crypto';
import { PANAMA, HOUR, normalize, filterEvents, newRecordsMessage, uniqueEvents, energyTrend, energyJump } from '../public/domain.js';

const SUBSCRIPTIONS = 'sismos:subs';
const seenKey = source => `sismos:seen:${source}`;
const SEEN_MS = 8 * 24 * HOUR; // longer than the 7-day USGS feed and the longest period filter
const MAX_SUBSCRIPTIONS = 5000;
// Browser push services; anything else is not a real subscription.
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

export const subscriptionKey = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

// Validates what the panel sends. A personal location is kept rounded to 0.1° (~11 km).
export function parseSubscription(body, previousFilters) {
  const { subscription, filters = previousFilters } = body ?? {};
  let url;
  try { url = new URL(subscription?.endpoint); } catch { return null; }
  const { p256dh, auth } = subscription.keys ?? {};
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some(host => host.test(url.hostname)) || url.href.length > 1000 ||
    typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100 || !filters) return null;
  const located = filters.located === true && Number.isFinite(filters.lat) && Number.isFinite(filters.lon) && Math.abs(filters.lat) <= 90 && Math.abs(filters.lon) <= 180;
  return {
    subscription: { endpoint: subscription.endpoint, keys: { p256dh, auth } },
    filters: { located, lat: located ? Math.round(filters.lat * 10) / 10 : PANAMA.lat, lon: located ? Math.round(filters.lon * 10) / 10 : PANAMA.lon,
      radius: [100, 300, 500, 1000, 2000].includes(filters.radius) ? filters.radius : 1000,
      minMag: [0, 3, 4, 5, 6].includes(filters.minMag) ? filters.minMag : 0,
      source: ['up', 'usgs', 'geoshake', 'all'].includes(filters.source) ? filters.source : 'all',
      hours: [1, 24, 168].includes(filters.hours) ? filters.hours : 24 },
  };
}

// Seen record IDs live in one sorted set per source (score = origin time). The set is
// cached per function instance; ZADD NX decides which run announces a record, so two
// instances never notify the same one.
export function createRedisStore(redis, { now = Date.now } = {}) {
  const seen = new Map();
  return {
    async seen(source) {
      if (!seen.has(source)) {
        await redis.zremrangebyscore(seenKey(source), '-inf', now() - SEEN_MS);
        seen.set(source, new Set((await redis.zrange(seenKey(source), 0, -1)).map(String)));
      }
      return seen.get(source);
    },
    async seed(source, events) {
      if (events.length) await redis.zadd(seenKey(source), ...events.map(event => ({ score: event.time, member: event.id })));
      seen.set(source, new Set(events.map(event => event.id)));
    },
    async claim(source, events) {
      const pipeline = redis.pipeline();
      for (const event of events) pipeline.zadd(seenKey(source), { nx: true }, { score: event.time, member: event.id });
      const added = await pipeline.exec();
      for (const event of events) seen.get(source)?.add(event.id);
      return events.filter((_, index) => added[index] === 1);
    },
    getRelease: () => redis.get('sismos:release'),
    saveRelease: release => redis.set('sismos:release', release),
    claimDelivery: (id, key) => redis.set(`sismos:delivery:${id}:${key}`, 1, { nx: true, ex: 8 * 86400 }),
    releaseDelivery: (id, key) => redis.del(`sismos:delivery:${id}:${key}`),
    async subscriptions() {
      return Object.entries(await redis.hgetall(SUBSCRIPTIONS) ?? {}).map(([key, record]) => ({ key, ...record }));
    },
    getSubscription: key => redis.hget(SUBSCRIPTIONS, key),
    async saveSubscription(key, record) {
      if (!await redis.hexists(SUBSCRIPTIONS, key) && await redis.hlen(SUBSCRIPTIONS) >= MAX_SUBSCRIPTIONS) return false;
      await redis.hset(SUBSCRIPTIONS, { [key]: { ...record, updatedAt: now() } });
      return true;
    },
    removeSubscription: key => redis.hdel(SUBSCRIPTIONS, key),
    // Remembers when this subscriber was last told about an energy jump (once an hour).
    async markJump(key, record, at) {
      const { subscription, filters, updatedAt } = record;
      await redis.hset(SUBSCRIPTIONS, { [key]: { subscription, filters, updatedAt, jumpAt: at } });
    },
  };
}

// One scheduled check: new records per source, then one push per matching subscription.
// The first successful fetch of a source only seeds it, like the panel's first load.
export async function runPushCheck({ store, loadCatalogs, send, now = Date.now() }) {
  const payload = await loadCatalogs();
  const events = normalize(payload.data.features);
  const fresh = [];
  for (const source of payload.sources) {
    if (source.id === 'geoshake' || !source.available || source.error) continue;
    const current = events.filter(event => event.source === source.id);
    const known = await store.seen(source.id);
    if (!known.size) { await store.seed(source.id, current); continue; }
    const candidates = current.filter(event => !known.has(event.id));
    if (candidates.length) fresh.push(...await store.claim(source.id, candidates));
  }
  const result = { fresh: fresh.length, sent: 0, removed: 0, failed: 0 };
  if (!fresh.length) return result;
  await Promise.all((await store.subscriptions()).map(async record => {
    const { key, subscription, filters } = record;
    const center = { lat: filters.lat, lon: filters.lon };
    const matches = filterEvents(fresh, { ...filters, center }, now);
    if (!matches.length) return;
    // Energy of the last hour against the previous one, same filters, one record per earthquake.
    const trend = energyTrend(uniqueEvents(filterEvents(events, { ...filters, hours: 2, center }, now)), HOUR, now);
    const jump = energyJump(trend) && !(record.jumpAt > now - HOUR) ? trend : null;
    try {
      await send(subscription, newRecordsMessage(matches, filters.located ? 'de ti' : 'del centro de Panamá', jump));
      if (jump) await store.markJump(key, record, now);
      result.sent++;
    } catch (error) {
      // 404/410: the browser dropped the subscription.
      if (error.statusCode === 404 || error.statusCode === 410) { await store.removeSubscription(key); result.removed++; }
      else { result.failed++; console.error(`push ${key}: ${error.statusCode ?? ''} ${error.message}`); }
    }
  }));
  return result;
}

// Release notices share subscriptions, but do not use earthquake/location filters.
export async function runReleaseCheck({ store, send, release }) {
  const result = { sent: 0, failed: 0 };
  if (!release) return result;
  const previous = await store.getRelease();
  if (!previous) { await store.saveRelease(release); return result; }
  if (previous === release) return result;
  await Promise.all((await store.subscriptions()).map(async ({ key, subscription }) => {
    if (!await store.claimDelivery(`release-${release}`, key)) return;
    try {
      await send(subscription, { title: 'Nueva versión disponible', body: 'Toca para abrir la nueva versión de Sismos PMA.',
        tag: 'app-update', type: 'app-update', release }, { TTL: 86400, urgency: 'normal' });
      result.sent++;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await store.removeSubscription(key);
      else { await store.releaseDelivery(`release-${release}`, key); result.failed++; }
    }
  }));
  if (!result.failed) await store.saveRelease(release);
  return result;
}
