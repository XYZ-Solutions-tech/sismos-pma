import { GEOCIENCIAS_URL, parseGeociencias } from './geociencias.mjs';

const TTL = 30_000;
const STALE_MS = 5 * 60_000;
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';

export function createCatalog({ id, label, url, parse }, { fetchImpl = fetch, now = Date.now } = {}) {
  let cached;
  let inFlight;
  let nextAttempt = 0;
  let error = null;

  function snapshot() {
    const generated = cached?.data.metadata?.generated ?? null;
    return { data: cached?.data ?? null, info: { id, label, url, available: Boolean(cached),
      fetchedAt: cached?.fetchedAt ?? null, generated, error,
      stale: Boolean(error) || Boolean(generated && now() - generated > STALE_MS) || Boolean(cached && now() - cached.fetchedAt > STALE_MS),
      latestEventAt: cached?.data.features.reduce((latest, feature) => Number.isFinite(feature.properties?.time) ? Math.max(latest, feature.properties.time) : latest, 0) || null } };
  }

  return async function load() {
    if (inFlight) return inFlight;
    if (now() < nextAttempt) return snapshot();
    nextAttempt = now() + TTL;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: id === 'up' ? 'text/html' : 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = parse(await response.text());
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Respuesta inesperada');
        cached = { data, fetchedAt: now() };
        error = null;
      } catch (failure) {
        error = `${label}: ${failure.name === 'TimeoutError' ? 'la consulta tardó demasiado' : failure.message}`;
      }
      return snapshot();
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}

export function parseUSGS(text) {
  const data = JSON.parse(text);
  if (!Number.isFinite(data.metadata?.generated)) throw new Error('Hora del catálogo no disponible');
  if (!Array.isArray(data.features)) throw new Error('Respuesta inesperada');
  // Keep only what the panel reads: the full weekly feed is ~1.4 MB on every check.
  return { type: data.type, metadata: { generated: data.metadata.generated },
    features: data.features.filter(feature => feature.properties?.type === 'earthquake').map(({ id, geometry, properties: p }) => ({ type: 'Feature', id, geometry,
      properties: { type: p.type, source: 'usgs', time: p.time, updated: p.updated, mag: p.mag, magType: p.magType, place: p.place, status: p.status, felt: p.felt, mmi: p.mmi } })) };
}

const catalogs = [
  createCatalog({ id: 'up', label: 'Geociencias UP', url: GEOCIENCIAS_URL, parse: parseGeociencias }),
  createCatalog({ id: 'usgs', label: 'USGS', url: USGS_URL, parse: parseUSGS }),
];

export async function loadCatalogs() {
  const results = await Promise.all(catalogs.map(load => load()));
  return { data: { type: 'FeatureCollection', features: results.flatMap(result => result.data?.features || []) }, sources: results.map(result => result.info) };
}
