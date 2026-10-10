export const PANAMA = { lat: 8.54, lon: -80.78, label: 'Panamá y alrededores' };
export const HOUR = 3_600_000;
export const REFRESH_MS = 30_000;
export const SOURCE_LABELS = { up: 'Geociencias UP', usgs: 'USGS', all: 'Ambas fuentes' };

function eventURL(feature) {
  if (feature.properties.source === 'up') {
    try {
      const url = new URL(feature.properties.url);
      if (url.origin === 'https://sismosgeociencias.up.ac.pa' && url.pathname === '/ultimosismo.html') return url.href;
    } catch { /* Invalid upstream link: use the official catalog. */ }
    return 'https://sismosgeociencias.up.ac.pa/';
  }
  return `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(feature.id)}`;
}

export function distanceKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const deltaLat = rad(b.lat - a.lat);
  const deltaLon = rad(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function normalize(features) {
  return features.flatMap(feature => {
    const p = feature.properties;
    const [lon, lat, depth] = feature.geometry?.coordinates || [];
    if (!p || p.type !== 'earthquake' || !feature.id || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(p.time)) return [];
    return [{ id: feature.id, source: p.source === 'up' ? 'up' : 'usgs', lat, lon, depth: Number.isFinite(depth) ? depth : null,
      mag: Number.isFinite(p.mag) ? p.mag : null, time: p.time, updated: p.updated,
      place: p.place || 'Ubicación sin descripción', magType: p.magType || '', status: p.status,
      felt: Number.isFinite(p.felt) ? p.felt : null, mmi: Number.isFinite(p.mmi) ? p.mmi : null,
      url: eventURL(feature) }];
  }).sort((a, b) => b.time - a.time);
}

export function filterEvents(events, options, now = Date.now()) {
  return events.filter(event => (!options.source || options.source === 'all' || event.source === options.source) && event.time >= now - options.hours * HOUR && event.time <= now &&
      (options.minMag === 0 || (event.mag !== null && event.mag >= options.minMag)))
    .map(event => ({ ...event, distance: distanceKm(options.center, event) }))
    .filter(event => event.distance <= options.radius);
}

export function histogram(events, hours, now = Date.now(), count = 24) {
  const start = now - hours * HOUR;
  const width = hours * HOUR / count;
  const bins = Array.from({ length: count }, (_, index) => ({ time: start + index * width, count: 0, maxMag: null }));
  for (const event of events) {
    if (event.time < start || event.time > now) continue;
    const index = Math.min(count - 1, Math.floor((event.time - start) / width));
    bins[index].count++;
    if (event.mag !== null) bins[index].maxMag = Math.max(bins[index].maxMag ?? -Infinity, event.mag);
  }
  return bins;
}

export function changes(previous, events) {
  if (!previous) return { added: [], revised: [] };
  return { added: events.filter(event => !previous.has(event.id)),
    revised: events.filter(event => previous.has(event.id) && previous.get(event.id) !== event.updated) };
}

export function magnitudeColor(mag) {
  return mag === null ? '#7d9299' : mag >= 6 ? '#e5484d' : mag >= 5 ? '#f08c4a' : mag >= 4 ? '#e9c46a' : '#7fa9b3';
}

// UP describes places as "Localizado en <región> a <n>km <dirección>": keep the useful part as title.
export function displayPlace(place) {
  const match = /^Localizado en\s*(.*?)\s*a (\d+)\s*km\s+(.+)$/i.exec(place ?? '');
  return match ? { title: `${match[2]} km ${match[3]}`, region: match[1] } : { title: place ?? '', region: '' };
}

// The same earthquake published by the other catalog: close in time and space, never merged.
export function findTwin(event, events, maxSeconds = 20, maxKm = 80) {
  let best = null;
  for (const other of events) {
    if (other.source === event.source || other.id === event.id) continue;
    const gap = Math.abs(other.time - event.time);
    if (gap > maxSeconds * 1000 || distanceKm(event, other) > maxKm) continue;
    if (!best || gap < Math.abs(best.time - event.time)) best = other;
  }
  return best;
}

// Ids of the records that have a twin among `events` (same criteria as findTwin). Sorted window, not O(n²).
export function twinIds(events, maxSeconds = 20, maxKm = 80) {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const ids = new Set();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].time - sorted[i].time <= maxSeconds * 1000; j++) {
      if (sorted[i].source === sorted[j].source || distanceKm(sorted[i], sorted[j]) > maxKm) continue;
      ids.add(sorted[i].id);
      ids.add(sorted[j].id);
    }
  }
  return ids;
}

// Catalogs publish 10 km when the depth could not be resolved (fixed or preliminary): not necessarily a measurement.
export function isProvisionalDepth(depth) {
  return depth === 10;
}

const kmFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const clockFormat = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false });

// One notification per check for the new records of a query (local or Web Push).
// `events` come from filterEvents (with `distance`); the tag lets a push replace the local one.
export function newRecordsMessage(events, fromWhere) {
  const top = events.reduce((best, e) => ((e.mag ?? -Infinity) > (best.mag ?? -Infinity) ? e : best));
  const mag = top.mag === null ? '—' : top.mag.toFixed(1);
  const place = displayPlace(top.place).title;
  const where = `${kmFormat.format(top.distance)} km ${fromWhere}`;
  const tag = `sismo-${top.id}`;
  if (events.length === 1) {
    return { title: `Sismo M ${mag} · ${SOURCE_LABELS[top.source]}`, body: `${place}\n${where} · ${clockFormat.format(top.time)} (hora de Panamá)`, id: top.id, tag };
  }
  return { title: `${events.length} nuevos registros en tu zona`, body: `Mayor: M ${mag} · ${place}\n${where} · ${SOURCE_LABELS[top.source]}`, id: top.id, tag };
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
