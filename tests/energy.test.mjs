import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, energyJoules, uniqueEvents, energyTrend, trendDirection, energyJump, formatEnergy, formatRatio, formatTNT, histogram, newRecordsMessage } from '../public/domain.js';

const NOW = Date.parse('2026-10-10T04:14:00Z');
const quake = (id, mag, minutesAgo, extra = {}) => ({ id, mag, time: NOW - minutesAgo * 60_000, source: 'usgs', lat: 7.5, lon: -80.3, place: 'Panamá', distance: 120, ...extra });

test('energy follows Gutenberg–Richter: one magnitude unit is about 32 times the energy', () => {
  assert.equal(energyJoules(null), 0);
  assert.ok(Math.abs(energyJoules(6) - 10 ** 13.8) < 1e6);
  assert.ok(Math.abs(energyJoules(6) / energyJoules(5) - 31.62) < 0.01);
});

test('a quake published by both catalogs is summed once, with the USGS record', () => {
  const usgs = quake('us1', 4.6, 10);
  const up = quake('up1', 4.9, 10, { source: 'up', time: usgs.time + 5000 });
  const alone = quake('up2', 3.1, 30, { source: 'up', lat: 9, lon: -82 });
  assert.deepEqual(uniqueEvents([usgs, up, alone]).map(event => event.id), ['us1', 'up2']);
  assert.deepEqual(uniqueEvents([up, alone]).map(event => event.id), ['up1', 'up2']);
});

test('trend compares the last window with the previous one and finds a sharp rise', () => {
  // Like the reference: five small quakes between 10 and 11 p.m., four larger ones after 11.
  const before = [3.1, 3.4, 3.0, 3.6, 3.3].map((mag, i) => quake(`b${i}`, mag, 61 + i * 10));
  const after = [5.9, 4.1, 3.8, 4.4].map((mag, i) => quake(`a${i}`, mag, 2 + i * 3));
  const trend = energyTrend([...before, ...after], HOUR, NOW);
  assert.equal(trend.current.count, 4);
  assert.equal(trend.previous.count, 5);
  assert.equal(trend.current.maxMag, 5.9);
  assert.ok(trend.ratio > 100);
  assert.equal(trendDirection(trend), 'up');
  assert.equal(energyJump(trend), true);
  // Without an M 4+ or without a previous hour with quakes there is no jump to announce.
  assert.equal(energyJump(energyTrend([...before, quake('small', 3.9, 5), quake('small2', 3.9, 6)], HOUR, NOW)), false);
  const fromQuiet = energyTrend([quake('lonely', 5.5, 5)], HOUR, NOW);
  assert.equal(fromQuiet.ratio, null);
  assert.equal(trendDirection(fromQuiet), 'up');
  assert.equal(energyJump(fromQuiet), false);
  assert.equal(trendDirection(energyTrend([], HOUR, NOW)), 'none');
  assert.equal(trendDirection(energyTrend([quake('x', 4, 70), quake('y', 3.9, 10)], HOUR, NOW)), 'same');
  assert.equal(trendDirection(energyTrend([quake('x', 5, 70), quake('y', 3, 10)], HOUR, NOW)), 'down');
});

test('energy and ratios read like the reference chart', () => {
  assert.equal(formatEnergy(2.52e14), '2,52 × 10¹⁴ J');
  assert.equal(formatEnergy(4.78e12), '4,78 × 10¹² J');
  assert.equal(formatEnergy(9.999e13), '1 × 10¹⁴ J');
  assert.equal(formatEnergy(0), '0 J');
  assert.equal(formatRatio(52.7), '52,7×');
  assert.equal(formatTNT(2.52e14), '60,2 kt de TNT');
  assert.equal(formatTNT(1e9), 'menos de 1 t de TNT');
});

test('histogram bins add energy, and a jump changes the notification title only', () => {
  const bins = histogram([quake('a', 5, 30), quake('b', 4, 30)], 1, NOW);
  assert.ok(Math.abs(bins.reduce((sum, bin) => sum + bin.energy, 0) - energyJoules(5) - energyJoules(4)) < 1);
  const events = [quake('a', 5.9, 2)];
  const plain = newRecordsMessage(events, 'de ti');
  const jumped = newRecordsMessage(events, 'de ti', { ratio: 52.7 });
  assert.equal(jumped.title, '↑ Energía: 52,7× la hora anterior');
  assert.equal(jumped.body, `${plain.title}\n${plain.body}`);
  assert.equal(jumped.tag, plain.tag);
});
