// Average crustal velocities. Real arrivals vary with depth, path and local geology.
export const WAVE_SPEED = { p: 6.0, s: 3.5 };
const EARTH_KM = 6371.0088;

export function hypocentralKm(distanceKm, depthKm) {
  return Math.hypot(distanceKm, depthKm ?? 0);
}

export function arrivalSeconds(distanceKm, depthKm, speed) {
  return hypocentralKm(distanceKm, depthKm) / speed;
}

// Radius on the surface reached by a front that left the hypocenter `seconds` ago.
export function surfaceRadiusKm(seconds, speed, depthKm) {
  const travelled = Math.max(0, seconds) * speed;
  const depth = depthKm ?? 0;
  return travelled <= depth ? 0 : Math.sqrt(travelled ** 2 - depth ** 2);
}

export function destination(lat, lon, distanceKm, bearingDeg) {
  const rad = Math.PI / 180;
  const angular = distanceKm / EARTH_KM;
  const bearing = bearingDeg * rad;
  const lat1 = lat * rad;
  const lon1 = lon * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lon: ((lon2 / rad + 540) % 360) - 180 };
}

export function bearing(from, to) {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export function circlePoints(lat, lon, radiusKm, count = 120) {
  return Array.from({ length: count + 1 }, (_, index) => destination(lat, lon, radiusKm, (index / count) * 360));
}

// Symbolic ring per record: grows with magnitude (≈ energy), capped so large events stay readable.
export function rippleDiameter(mag) {
  return Math.round(Math.max(18, Math.min(220, 14 * 1.75 ** ((mag ?? 3) - 3))));
}

export function markerDiameter(mag) {
  return Math.round(Math.max(7, Math.min(26, 6 + Math.max(0, (mag ?? 3) - 2.5) * 3.2)));
}

export function burstDiameter(mag) {
  return Math.round(Math.max(28, Math.min(520, 32 * 1.8 ** ((mag ?? 3) - 3))));
}
