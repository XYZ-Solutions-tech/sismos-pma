import { geoShakeFeature } from '../public/geoshake.js';
import { normalize, filterEvents, newRecordsMessage } from '../public/domain.js';

export function parseGeoShake(text) {
  const events = JSON.parse(text);
  if (!Array.isArray(events)) throw new Error('Catálogo GeoShake inesperado');
  return { type: 'FeatureCollection', features: events.map(geoShakeFeature).filter(Boolean) };
}

// Receipts are per subscriber: retry failed deliveries without repeating successful ones.
// Never announce reconnect snapshots older than five minutes.
export async function sendGeoShakeEvent(raw, { store, send, now = Date.now() }) {
  const feature = geoShakeFeature(raw);
  if (!feature) throw new Error('Evento GeoShake inválido');
  const event = normalize([feature])[0];
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (event.time < now - 300_000 || event.time > now + 10_000) return result;
  for (const record of await store.subscriptions()) {
    const matches = filterEvents([event], { ...record.filters, center: { lat: record.filters.lat, lon: record.filters.lon } }, Math.max(now, event.time));
    if (!matches.length || !await store.claimDelivery(event.id, record.key)) { result.skipped++; continue; }
    try {
      const message = newRecordsMessage(matches, record.filters.located ? 'de ti' : 'del centro de Panamá', null, now);
      // Depth is unknown. Do not manufacture a P/S arrival time from a zero-depth assumption.
      message.body = message.body.split('\nOnda S')[0] + '\nGeoShake · profundidad no informada; llegada de ondas no disponible';
      await send(record.subscription, message, { TTL: 60, urgency: 'high' });
      result.sent++;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) await store.removeSubscription(record.key);
      else { await store.releaseDelivery(event.id, record.key); result.failed++; }
    }
  }
  return result;
}
