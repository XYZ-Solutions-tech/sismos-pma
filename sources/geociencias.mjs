import { createHash } from 'node:crypto';

export const GEOCIENCIAS_URL = 'https://sismosgeociencias.up.ac.pa/';

// The official detail links carry the same values shown in the catalog table.
// Only decode ampersands: an unescaped "&lt=" is the latitude parameter.
export function parseGeociencias(html) {
  if (!html.includes('Lista de sismos registrados') || !/<table\b/i.test(html)) {
    throw new Error('El formato del listado de Geociencias UP cambió.');
  }
  const records = new Map();
  let detailLinks = 0;
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(match[1].replace(/&amp;|&#38;|&#x26;/gi, '&'), GEOCIENCIAS_URL); } catch { continue; }
    if (url.origin !== new URL(GEOCIENCIAS_URL).origin || url.pathname !== '/ultimosismo.html') continue;
    detailLinks++;
    const params = url.searchParams;
    const date = params.get('f');
    const clock = /^(\d{1,2}):(\d{2}):(\d{2})(AM|PM)$/i.exec(params.get('h') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !clock) continue;
    const [, hour, minute, second, meridiem] = clock;
    if (+hour < 1 || +hour > 12 || +minute > 59 || +second > 59) continue;
    const hours24 = (+hour % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    const time = Date.parse(`${date}T${String(hours24).padStart(2, '0')}:${minute}:${second}-05:00`);
    if (!Number.isFinite(time) || new Date(time - 5 * 3_600_000).toISOString().slice(0, 10) !== date) continue;
    const numeric = name => params.has(name) && params.get(name).trim() !== '' ? Number(params.get(name)) : NaN;
    const lat = numeric('lt');
    const lon = numeric('ln');
    const mag = numeric('m');
    const depthMatch = /^(-?\d+(?:\.\d+)?)\s*km$/i.exec(params.get('p') || '');
    const depth = depthMatch ? Number(depthMatch[1]) : null;
    if (![lat, lon, mag].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || mag < -2 || mag > 10) continue;
    const status = params.get('e') === 'REVISADO' ? 'reviewed' : params.get('e') === 'PRELIMINAR' ? 'preliminary' : 'unknown';
    const place = (params.get('r') || 'Ubicación sin descripción').trim();
    // UP publishes no persistent event ID. This identifies a catalog record,
    // not a confirmed physical match with any record from another network.
    const id = `up-${createHash('sha256').update(`${time}|${lat}|${lon}`).digest('hex').slice(0, 20)}`;
    const revision = createHash('sha256').update(JSON.stringify({ mag, depth, status, place })).digest('hex');
    records.set(id, { type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat, depth] },
      properties: { type: 'earthquake', source: 'up', time, mag, place, status, updated: revision, url: url.href } });
  }
  if (!records.size && (detailLinks || /\b(?:REVISADO|PRELIMINAR)\b/.test(html))) throw new Error('No se pudieron interpretar los registros de Geociencias UP.');
  return { type: 'FeatureCollection', features: [...records.values()].sort((a, b) => b.properties.time - a.properties.time), metadata: { generated: null } };
}
