import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeociencias } from '../sources/geociencias.mjs';
import { createCatalog, parseUSGS } from '../sources/catalogs.mjs';
import { normalize, filterEvents, PANAMA } from '../public/domain.js';

function html(...links) {
  return `<h1>Lista de sismos registrados por el Instituto de Geociencias UP</h1><table>${links.map(link => `<tr><td><a href="${link}">Ver</a></td></tr>`).join('')}</table>`;
}
function link(overrides = {}) {
  const fields = { z: '9', lt: '7.51040', ln: '-80.72610', p: '2km', e: 'REVISADO', h: '7:57:39PM', f: '2026-10-09', m: '4.5', r: 'Localizado a 33km al oeste de Tonosí', ...overrides };
  return `ultimosismo.html?${new URLSearchParams(fields)}`;
}

test('UP parses local Panama time, source links, status, and repeated desktop/mobile rows once', () => {
  const original = link();
  const catalog = parseGeociencias(html(original, original, original.replaceAll('&', '&amp;')));
  const [event] = normalize(catalog.features);
  assert.equal(catalog.features.length, 1);
  assert.equal(event.time, Date.parse('2026-10-09T19:57:39-05:00'));
  assert.equal(event.source, 'up');
  assert.equal(event.status, 'reviewed');
  assert.equal(event.depth, 2);
  assert.equal(event.mag, 4.5);
  assert.equal(event.place, 'Localizado a 33km al oeste de Tonosí');
  assert.equal(new URL(event.url).searchParams.get('lt'), '7.51040');
  assert.equal(catalog.metadata.generated, null);
});

test('UP handles midnight and noon and rejects malformed dates, missing coordinates and external links', () => {
  const catalog = parseGeociencias(html(link({ h: '12:00:00AM' }), link({ h: '12:00:00PM' }),
    link({ h: '19:00:00PM' }), link({ f: '2026-02-30' }), link({ lt: '' }), link({ ln: '181' }),
    `https://example.com/${link()}`));
  assert.deepEqual(catalog.features.map(e => new Date(e.properties.time).toISOString()), ['2026-10-09T17:00:00.000Z', '2026-10-09T05:00:00.000Z']);
  assert.throws(() => parseGeociencias('<html>maintenance</html>'), /formato/);
  assert.throws(() => parseGeociencias(html(link({ lt: 'invalid' }))), /interpretar/);
  assert.throws(() => parseGeociencias(html(link().replace('ultimosismo.html', 'formato-nuevo.html'))), /interpretar/);
});

test('UP revisions keep the record identity when magnitude, depth or review state changes', () => {
  const [before] = normalize(parseGeociencias(html(link({ e: 'PRELIMINAR' }))).features);
  const [after] = normalize(parseGeociencias(html(link({ e: 'REVISADO', m: '4.8', p: '5km' }))).features);
  assert.equal(before.id, after.id);
  assert.notEqual(before.updated, after.updated);
});

test('source filters preserve separate UP and USGS values for the same reported origin', () => {
  const up = normalize(parseGeociencias(html(link())).features)[0];
  const usgs = { ...up, id: 'us-example', source: 'usgs', mag: 4.2 };
  const options = { center: PANAMA, radius: 1000, hours: 24, minMag: 0, source: 'all' };
  const now = up.time + 60_000;
  assert.equal(filterEvents([up, usgs], options, now).length, 2);
  assert.deepEqual(filterEvents([up, usgs], { ...options, source: 'up' }, now).map(e => e.mag), [4.5]);
  assert.deepEqual(filterEvents([up, usgs], { ...options, source: 'usgs' }, now).map(e => e.mag), [4.2]);
});

test('source cache retains last successful data on failure, retries after TTL and does not change revision on refresh', async () => {
  let now = 100_000;
  let calls = 0;
  let fail = false;
  const load = createCatalog({ id: 'up', label: 'Geociencias UP', url: 'https://sismosgeociencias.up.ac.pa/', parse: parseGeociencias }, {
    now: () => now,
    fetchImpl: async () => { calls++; if (fail) throw new Error('network unavailable'); return { ok: true, text: async () => html(link()) }; },
  });
  const first = await load();
  assert.equal(first.info.available, true);
  assert.equal(first.info.stale, false);
  const revision = first.data.features[0].properties.updated;
  await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  now += 60_001;
  fail = true;
  const stale = await load();
  assert.equal(stale.info.available, true);
  assert.equal(stale.info.stale, true);
  assert.equal(stale.info.fetchedAt, first.info.fetchedAt);
  assert.equal(stale.data.features[0].properties.updated, revision);
  assert.match(stale.info.error, /network unavailable/);
  await load();
  assert.equal(calls, 2);
  now += 60_001;
  fail = false;
  const recovered = await load();
  assert.equal(recovered.info.stale, false);
  assert.equal(recovered.info.error, null);
  assert.equal(recovered.data.features[0].properties.updated, revision);
});

test('USGS feed keeps only earthquakes and the fields the panel reads', () => {
  const quake = { type: 'Feature', id: 'us7000abcd', geometry: { type: 'Point', coordinates: [-80, 8, 10] },
    properties: { type: 'earthquake', time: 1000, updated: 2000, mag: 4.1, magType: 'mb', place: 'Panama', status: 'reviewed', felt: null, mmi: 3.2, url: 'https://example.com', detail: 'x', sig: 271 } };
  const blast = { ...quake, id: 'us-blast', properties: { ...quake.properties, type: 'quarry blast' } };
  const catalog = parseUSGS(JSON.stringify({ type: 'FeatureCollection', metadata: { generated: 3000 }, features: [quake, blast] }));
  assert.deepEqual(catalog.metadata, { generated: 3000 });
  assert.deepEqual(catalog.features.map(feature => feature.id), ['us7000abcd']);
  assert.deepEqual(Object.keys(catalog.features[0].properties).sort(), ['felt', 'mag', 'magType', 'mmi', 'place', 'source', 'status', 'time', 'type', 'updated']);
  assert.deepEqual(normalize(catalog.features)[0], normalize([quake])[0]);
  assert.throws(() => parseUSGS(JSON.stringify({ type: 'FeatureCollection', features: [] })), /Hora/);
});
