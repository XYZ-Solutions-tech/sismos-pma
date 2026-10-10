// GeoShake Open Data, CC BY 4.0: https://api.geoshake.org/developer
export const GEOSHAKE_URL = 'https://api.geoshake.org';

export function geoShakeFeature(event) {
  if (!event || !Number.isSafeInteger(event.event_id) || event.event_id < 1 ||
      !Number.isFinite(event.originMs) || !Number.isFinite(event.lat) || Math.abs(event.lat) > 90 ||
      !Number.isFinite(event.lon) || Math.abs(event.lon) > 180 || !Number.isInteger(event.nStations) || event.nStations < 2) return null;
  const mag = event.official?.magnitude;
  return { type: 'Feature', id: `geoshake-${event.event_id}`,
    geometry: { type: 'Point', coordinates: [event.lon, event.lat, null] },
    properties: { type: 'earthquake', source: 'geoshake', time: event.originMs,
      updated: JSON.stringify([event.stage ?? null, Number.isFinite(mag) ? mag : null]),
      mag: Number.isFinite(mag) && mag >= 0 && mag <= 10 ? mag : null,
      place: `Detección GeoShake · ${event.nStations} estaciones`, status: 'automatic',
      url: 'https://map.geoshake.org', depthUnknown: true } };
}

// The stream also carries individual triggers and waveforms. Only confirmed event messages count.
export function geoShakeMessage(data) {
  try {
    const message = JSON.parse(data);
    return message?.type === 'event' ? geoShakeFeature(message.payload) : null;
  } catch { return null; }
}

// Incremental SSE framing, shared by the receiver and its tests. Bound partial frames.
export function createSSEParser(onData) {
  let buffer = '';
  let data = [];
  return chunk => {
    buffer += chunk;
    if (buffer.length > 262144) throw new Error('GeoShake SSE frame too large');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) {
        if (data.length) onData(data.join('\n'));
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
        if (data.join('\n').length > 262144) throw new Error('GeoShake SSE data too large');
      }
    }
  };
}
