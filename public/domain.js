import { WAVE_SPEED, arrivalSeconds } from './waves.js';

export const PANAMA = { lat: 8.54, lon: -80.78, label: 'Panamá y alrededores' };
export const HOUR = 3_600_000;
export const REFRESH_MS = 30_000;
export const SOURCE_LABELS = { up: 'Geociencias UP', usgs: 'USGS', geoshake: 'GeoShake', all: 'Todas las fuentes' };

function eventURL(feature) {
  if (feature.properties.source === 'geoshake') return 'https://map.geoshake.org';
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
    return [{ id: feature.id, source: ['up', 'geoshake'].includes(p.source) ? p.source : 'usgs', lat, lon, depth: Number.isFinite(depth) ? depth : null,
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
  const bins = Array.from({ length: count }, (_, index) => ({ time: start + index * width, count: 0, maxMag: null, energy: 0 }));
  for (const event of events) {
    if (event.time < start || event.time > now) continue;
    const index = Math.min(count - 1, Math.floor((event.time - start) / width));
    bins[index].count++;
    bins[index].energy += energyJoules(event.mag);
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
    if (other.source === 'geoshake' || event.source === 'geoshake' || other.source === event.source || other.id === event.id) continue;
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
      if (sorted[i].source === 'geoshake' || sorted[j].source === 'geoshake' || sorted[i].source === sorted[j].source || distanceKm(sorted[i], sorted[j]) > maxKm) continue;
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
const decimalFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const ratioFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const clockFormat = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false });

// ——— Energy and trend ———

// Approximate radiated energy, Gutenberg–Richter: log10 E(J) = 1.5 M + 4.8. One magnitude unit ≈ 32× the energy.
export const energyJoules = mag => (mag === null ? 0 : 10 ** (1.5 * mag + 4.8));

// One record per earthquake for sums and trends: a quake published by both catalogs counts once,
// with the USGS record (twins always pair a UP record with a USGS one).
export function uniqueEvents(events) {
  events = events.filter(event => event.source !== 'geoshake');
  const twins = twinIds(events);
  return twins.size ? events.filter(event => !(event.source === 'up' && twins.has(event.id))) : events;
}

// Earthquakes and energy in the last `window` and in the one before. ratio is null when the
// previous window had no energy (nothing to compare with).
export function energyTrend(events, window = HOUR, now = Date.now()) {
  const span = (from, to) => events.filter(event => event.time > from && event.time <= to).reduce((sum, event) => ({
    count: sum.count + 1, energy: sum.energy + energyJoules(event.mag), maxMag: Math.max(sum.maxMag ?? -Infinity, event.mag ?? -Infinity),
  }), { count: 0, energy: 0, maxMag: null });
  const current = span(now - window, now);
  const previous = span(now - 2 * window, now - window);
  return { current, previous, ratio: previous.energy ? current.energy / previous.energy : null };
}

// Compare the current (incomplete) clock hour with the preceding full hour.
export function clockHourComparison(events, now = Date.now()) {
  const start = Math.floor(now / HOUR) * HOUR; // Panama UTC-5 has whole-hour boundaries.
  const sum = (from, to, inclusive) => events.filter(e => e.time >= from && (inclusive ? e.time <= to : e.time < to))
    .reduce((v, e) => ({ count: v.count + 1, energy: v.energy + energyJoules(e.mag) }), { count: 0, energy: 0 });
  const previous = sum(start - HOUR, start, false);
  const current = sum(start, now, true);
  return { previous, current, ratio: previous.energy ? current.energy / previous.energy : null, start, now };
}

// 'up' | 'down' | 'same' | 'none'. Energy varies by orders of magnitude, so within ×2 counts as similar.
export function trendDirection({ current, previous, ratio }) {
  if (!current.energy && !previous.energy) return 'none';
  if (ratio === null) return 'up';
  return ratio >= 2 ? 'up' : ratio <= 0.5 ? 'down' : 'same';
}

// A sharp rise worth saying in a notification: ≥10× a previous window that also had earthquakes, with an M 4+.
// After a quiet window the record notification itself (with its magnitude) says enough.
export const energyJump = trend => trend.ratio !== null && trend.ratio >= 10 && (trend.current.maxMag ?? -Infinity) >= 4;

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function formatEnergy(joules) {
  if (!joules) return '0 J';
  let exponent = Math.floor(Math.log10(joules));
  let mantissa = Math.round(joules / 10 ** exponent * 100) / 100;
  if (mantissa >= 10) { mantissa /= 10; exponent++; }
  return `${decimalFormat.format(mantissa)} × 10${String(exponent).replace('-', '⁻').replace(/\d/g, digit => SUPERSCRIPT[digit])} J`;
}

export const formatRatio = ratio => `${ratio >= 100 ? kmFormat.format(ratio) : ratioFormat.format(ratio)}×`;

// TNT equivalent (1 t = 4.184 × 10⁹ J), only to give the energy a familiar scale.
export function formatTNT(joules) {
  const tons = joules / 4.184e9;
  if (tons < 1) return 'menos de 1 t de TNT';
  if (tons < 1000) return `${kmFormat.format(tons)} t de TNT`;
  if (tons < 1e6) return `${ratioFormat.format(tons / 1000)} kt de TNT`;
  return `${ratioFormat.format(tons / 1e6)} Mt de TNT`;
}

const secondsFormat = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// Estimated S-wave arrival at the query center (hypocentral distance, average crustal speed).
// Catalogs publish minutes after the quake, so it has almost always arrived when the notice is sent.
export function arrivalLine(event, fromWhere, now = Date.now()) {
  if (!Number.isFinite(event.distance) || event.source === 'geoshake') return '';
  const at = event.time + arrivalSeconds(event.distance, event.depth, WAVE_SPEED.s) * 1000;
  const toWhere = fromWhere.replace(/^del /, 'al ').replace(/^de /, 'a ');
  return at <= now ? `\nOnda S llegó ${toWhere} ≈ ${secondsFormat.format(at)}` : `\nOnda S llegaría ${toWhere} ≈ ${secondsFormat.format(at)} (estimado)`;
}

// One notification per check for the new records of a query (local or Web Push).
// `events` come from filterEvents (with `distance`); the tag lets a push replace the local one.
// With `jump` (an energyTrend that passed energyJump) the title announces the rise.
export function newRecordsMessage(events, fromWhere, jump = null, now = Date.now()) {
  const top = events.reduce((best, e) => ((e.mag ?? -Infinity) > (best.mag ?? -Infinity) ? e : best));
  const mag = top.mag === null ? '—' : top.mag.toFixed(1);
  const place = displayPlace(top.place).title;
  const where = `${kmFormat.format(top.distance)} km ${fromWhere}`;
  const tag = `sismo-${top.id}`;
  const arrival = arrivalLine(top, fromWhere, now);
  const message = events.length === 1
    ? { title: `Sismo M ${mag} · ${SOURCE_LABELS[top.source]}`, body: `${place}\n${where} · ${clockFormat.format(top.time)} (hora de Panamá)${arrival}`, id: top.id, tag }
    : { title: `${events.length} nuevos registros en tu zona`, body: `Mayor: M ${mag} · ${place}\n${where} · ${SOURCE_LABELS[top.source]}${arrival}`, id: top.id, tag };
  if (!jump) return message;
  return { ...message, title: `↑ Energía: ${formatRatio(jump.ratio)} la hora anterior`, body: `${message.title}\n${message.body}` };
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
