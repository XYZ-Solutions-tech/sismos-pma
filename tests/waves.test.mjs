import test from 'node:test';
import assert from 'node:assert/strict';
import { WAVE_SPEED, arrivalSeconds, surfaceRadiusKm, destination, bearing, circlePoints, rippleDiameter, markerDiameter } from '../public/waves.js';
import { distanceKm, displayPlace, findTwin } from '../public/domain.js';

test('arrival times use hypocentral distance and average crustal speeds', () => {
  const p = arrivalSeconds(207.07, 12.6, WAVE_SPEED.p);
  const s = arrivalSeconds(207.07, 12.6, WAVE_SPEED.s);
  assert.ok(Math.abs(p - 34.58) < 0.05);
  assert.ok(Math.abs(s - 59.28) < 0.05);
  assert.ok(s > p);
  assert.equal(arrivalSeconds(0, 0, WAVE_SPEED.p), 0);
});

test('a front reaches the surface only after travelling the hypocenter depth', () => {
  assert.equal(surfaceRadiusKm(1, 6, 10), 0);
  assert.equal(surfaceRadiusKm(-5, 6, 0), 0);
  assert.ok(Math.abs(surfaceRadiusKm(10, 6, 36) - 48) < 1e-9);
  const t = arrivalSeconds(120, 15, 3.5);
  assert.ok(Math.abs(surfaceRadiusKm(t, 3.5, 15) - 120) < 1e-9);
});

test('wave rings are drawn at the requested geodesic radius', () => {
  const center = { lat: 7.587, lon: -80.769 };
  for (const bearing of [0, 90, 180, 270]) {
    assert.ok(Math.abs(distanceKm(center, destination(center.lat, center.lon, 207, bearing)) - 207) < 0.01);
  }
  const ring = circlePoints(center.lat, center.lon, 50, 24);
  assert.equal(ring.length, 25);
  assert.deepEqual(ring[0], ring[24]);
  const wrapped = destination(0, 179.9, 50, 90);
  assert.ok(wrapped.lon < -179 && wrapped.lon >= -180);
});

test('marker and ripple sizes grow with magnitude and stay bounded', () => {
  assert.ok(rippleDiameter(7.7) > rippleDiameter(5) && rippleDiameter(5) > rippleDiameter(4));
  assert.equal(rippleDiameter(10), 220);
  assert.equal(rippleDiameter(null), rippleDiameter(3));
  assert.ok(markerDiameter(2) >= 7 && markerDiameter(9) <= 26);
});

test('UP place descriptions keep the distance and reference point as title', () => {
  assert.deepEqual(displayPlace('Localizado en Panamá a 32km al sur de Soná'), { title: '32 km al sur de Soná', region: 'Panamá' });
  assert.deepEqual(displayPlace('Localizado en a 33km al oeste de Tonosí'), { title: '33 km al oeste de Tonosí', region: '' });
  assert.deepEqual(displayPlace('Localizado en Frente a la costa de Centroamérica a 703km al suroeste de Puerto Armuelles'),
    { title: '703 km al suroeste de Puerto Armuelles', region: 'Frente a la costa de Centroamérica' });
  assert.deepEqual(displayPlace('12 km WSW of Pitaloza Arriba, Panama'), { title: '12 km WSW of Pitaloza Arriba, Panama', region: '' });
});

test('twin records come from the other catalog, close in time and space', () => {
  const usgs = { id: 'us1', source: 'usgs', time: 1_000_000, lat: 7.587, lon: -80.769 };
  const events = [usgs,
    { id: 'up-far', source: 'up', time: 1_001_000, lat: 9.5, lon: -79 },
    { id: 'up-late', source: 'up', time: 1_060_000, lat: 7.56, lon: -80.76 },
    { id: 'up-twin', source: 'up', time: 999_000, lat: 7.559, lon: -80.759 },
    { id: 'us2', source: 'usgs', time: 1_000_500, lat: 7.58, lon: -80.77 }];
  assert.equal(findTwin(usgs, events)?.id, 'up-twin');
  assert.equal(findTwin(events[2], events), null);
});

test('bearing points from the epicenter toward the query center', () => {
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) < 1e-9);
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 1e-9);
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }) - 180) < 1e-9);
});
