import { normalize } from './domain.js';

export async function loadEarthquakes(signal) {
  const response = await fetch('/api/earthquakes', { signal, cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Los catálogos no están disponibles.');
  return { ...payload, events: normalize(payload.data.features) };
}

const DEFAULTS = { radius: 1000, hours: 24, minMag: 0, source: 'all', ripples: 'all', notify: false };

export function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('sismos-settings'));
    return { radius: [100, 300, 500, 1000, 2000].includes(saved?.radius) ? saved.radius : DEFAULTS.radius,
      hours: [1, 24, 168].includes(saved?.hours) ? saved.hours : DEFAULTS.hours,
      minMag: [0, 3, 4, 5, 6].includes(saved?.minMag) ? saved.minMag : DEFAULTS.minMag,
      source: ['up', 'usgs', 'geoshake', 'all'].includes(saved?.source) ? saved.source : DEFAULTS.source,
      ripples: ['all', 'hour', 'none'].includes(saved?.ripples) ? saved.ripples : DEFAULTS.ripples,
      notify: saved?.notify === true };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(settings) {
  try { localStorage.setItem('sismos-settings', JSON.stringify({ radius: settings.radius, hours: settings.hours, minMag: settings.minMag, source: settings.source, ripples: settings.ripples, notify: settings.notify })); } catch { /* Storage may be disabled. */ }
}
