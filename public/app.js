import { PANAMA, HOUR, REFRESH_MS, SOURCE_LABELS, filterEvents, histogram, changes, magnitudeColor, escapeHTML, displayPlace, findTwin, twinIds, isProvisionalDepth,
  uniqueEvents, clockHourComparison, energyTrend, trendDirection, energyJump, formatEnergy, formatRatio, formatTNT, normalize } from './domain.js';
import { geoShakeMessage } from './geoshake.js';
import { loadEarthquakes, readSettings, saveSettings } from './data.js';
import { createEarthquakeMap } from './map.js';
import { WAVE_SPEED, arrivalSeconds, surfaceRadiusKm } from './waves.js';
import { notificationPermission, requestNotifications, showNotification, notifyNewRecords, onNotificationSelect, welcomeSetup, promptInstall, enablePush, updatePushFilters, disablePush } from './notify.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { ...readSettings(), center: { ...PANAMA }, located: null, events: [], visible: [], selected: null,
  previous: null, newIds: new Map(), sort: 'time', loading: false, loaded: false, failed: false, locating: false,
  sources: [], seenSources: new Set(), nextAt: Date.now() + REFRESH_MS, fitNext: false, stale: false, satellite: false };
// Selected-event wave replay and whole-period timelapse share one animation loop.
const player = { mode: 'waves', playing: !reducedMotion, speed: 4, t: 0, key: null, stage: null, raf: 0, last: 0, painted: 0,
  replay: { playing: false, duration: 60, t: 0, drawn: null, start: 0, end: 0, hours: 0, bins: [] } };
let welcomeReady = false;
const updateWelcome = welcomeSetup({ enabled: () => state.notify, activate: toggleNotify, ready: () => welcomeReady });
const map = await createEarthquakeMap(selectEvent);
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const timeFormat = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const shortTime = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false });
const dateFormat = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const magText = mag => mag === null ? '—' : mag.toFixed(1);
const periodText = () => state.hours === 1 ? 'la última hora' : state.hours === 24 ? 'las últimas 24 horas' : 'los últimos 7 días';
const periodShort = () => state.hours === 1 ? '1 h' : state.hours === 24 ? '24 h' : '7 días';
const activeSources = () => state.sources.filter(source => state.source === 'all' || source.id === state.source);
const sourceIsStale = source => source.stale || !source.available || Date.now() - source.fetchedAt > 5 * 60_000 || Boolean(source.generated && Date.now() - source.generated > 5 * 60_000);
const fromWhere = () => state.located ? 'de ti' : state.center.label === PANAMA.label ? 'del centro de Panamá' : 'del centro de consulta';
const toWhere = () => state.located ? 'a ti' : state.center.label === PANAMA.label ? 'al centro de Panamá' : 'al centro de consulta';
const ago = timestamp => {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  return minutes < 1 ? 'hace menos de 1 min' : minutes < 60 ? `hace ${minutes} min` : minutes < 1440 ? `hace ${Math.floor(minutes / 60)} h ${minutes % 60} min` : dateFormat.format(timestamp);
};
const selectedEvent = () => state.visible.find(e => e.id === state.selected);

function notice(message, kind = '') {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').className = `notice ${kind}`;
}

function selectEvent(id) {
  state.selected = id;
  render();
  const event = selectedEvent();
  if (event) map.focus(event, state.center);
}

function waveTimes(event = selectedEvent()) {
  if (!event || event.source === 'geoshake') return null;
  const depth = event.depth ?? 0;
  const p = arrivalSeconds(event.distance, depth, WAVE_SPEED.p);
  const s = arrivalSeconds(event.distance, depth, WAVE_SPEED.s);
  return { event, depth, p, s, end: s + 12 };
}

function renderDetail(event) {
  $('detail').hidden = !event;
  if (!event) return;
  const color = magnitudeColor(event.mag);
  const place = displayPlace(event.place);
  const times = waveTimes(event);
  const unknownDepth = event.source === 'geoshake';
  const status = { reviewed: 'Revisado', preliminary: 'Preliminar', automatic: 'Automático' }[event.status] || 'Sin estado';
  const twin = findTwin(event, state.events);
  const twinVisible = twin && state.visible.some(e => e.id === twin.id);
  const twinText = twin ? `También en ${SOURCE_LABELS[twin.source]} (probablemente el mismo sismo): <strong>M ${magText(twin.mag)}</strong> · ${timeFormat.format(twin.time)}` : '';
  const provisional = isProvisionalDepth(event.depth);
  $('detail').innerHTML = `<div class="detail-head"><span>Sismo seleccionado</span><span class="badge">${SOURCE_LABELS[event.source]} · ${status}</span></div>
    <div class="detail-top"><span class="detail-mag" style="--mag-color:${color}"><small>M</small>${magText(event.mag)}</span><div><h3>${escapeHTML(place.title)}</h3><p>${place.region ? `${escapeHTML(place.region)} · ` : ''}${dateFormat.format(event.time)} · ${ago(event.time)}</p></div></div>
    <div class="detail-grid">
      <div><strong>${num.format(event.distance)}<small> km</small></strong><span>${fromWhere()}</span></div>
      <div><strong>${event.depth === null ? '—' : event.depth.toFixed(1)}<small> km</small></strong><span>${provisional ? 'prof. provisional' : 'de profundidad'}</span></div>
      <div class="tile p" id="tile-p"><strong>${unknownDepth ? '—' : `+${times?.p.toFixed(1)}`}<small> s</small></strong><span>${unknownDepth ? 'onda P: llegada no disponible' : `onda P llegó ${toWhere()}`}</span></div>
      <div class="tile s" id="tile-s"><strong>${unknownDepth ? '—' : `+${times?.s.toFixed(1)}`}<small> s</small></strong><span>${unknownDepth ? 'onda S: llegada no disponible' : `onda S llegó ${toWhere()}`}</span></div>
    </div>
    ${unknownDepth ? '<p class="detail-note">GeoShake no informa profundidad. No hay una estimación de llegada de ondas disponible. Se excluye de la comparación de energía para evitar duplicar registros oficiales.</p>' : ''}
    ${provisional ? '<p class="detail-note">10 km suele ser una profundidad provisional o fijada cuando no se pudo calcular: no es necesariamente una medición exacta. Los tiempos P y S la usan como aproximación.</p>' : ''}
    ${twin ? (twinVisible ? `<button class="twin" data-id="${escapeHTML(twin.id)}"><i style="background:${magnitudeColor(twin.mag)}"></i><span>${twinText}</span></button>` : `<p class="twin"><i style="background:${magnitudeColor(twin.mag)}"></i><span>${twinText}</span></p>`) : ''}
    <div class="detail-bottom"><span>${event.magType ? `Tipo ${escapeHTML(event.magType)}` : 'Tipo de magnitud no informado'} · ${event.felt === null ? 'percepción no informada' : `${num.format(event.felt)} reportes de percepción`}</span><a href="${escapeHTML(event.url)}" target="_blank" rel="noopener noreferrer">Ver ficha ${SOURCE_LABELS[event.source]} ↗</a></div>`;
}

function renderSources() {
  for (const id of ['up', 'usgs', 'geoshake']) {
    const source = state.sources.find(source => source.id === id);
    const stale = source && sourceIsStale(source);
    const latest = filterEvents(state.events, { ...state, source: id }).reduce((time, event) => Math.max(time, event.time), 0);
    $(`source-${id}`).classList.toggle('warning', Boolean(stale));
    $(`source-${id}`).textContent = !source ? `${SOURCE_LABELS[id]}: consultando…` : !source.available ? `${SOURCE_LABELS[id]}: consulta no disponible` :
      `${SOURCE_LABELS[id]}: ${stale ? 'datos anteriores · ' : ''}consultado ${timeFormat.format(source.fetchedAt)} · último en tu consulta ${latest ? dateFormat.format(latest) : 'ninguno'}`;
  }
  $('count-note').textContent = state.source === 'all' ? 'Un sismo puede tener un registro en cada fuente y aparecer en varios catálogos («también en…»). Los conteos son registros, no sismos únicos.' : `Mostrando registros de ${SOURCE_LABELS[state.source]}.`;
  const sources = activeSources();
  state.stale = sources.some(sourceIsStale);
  if (state.loaded && !state.loading) connection(state.stale ? 'Fuente sin actualizar' : 'Consultas al día', state.stale);
  $('updated').textContent = sources.filter(s => s.available).map(s => `${s.label}: consultado ${timeFormat.format(s.fetchedAt)}${s.generated ? ` · catálogo ${timeFormat.format(s.generated)}` : ''}`).join(' / ') || 'Esperando primera consulta';
}

function renderLocation() {
  $('location-card').classList.toggle('located', Boolean(state.located));
  $('location-title').textContent = state.locating ? 'Buscando tu ubicación…' : state.located ? 'Usando tu ubicación' : 'Centro de Panamá';
  $('location-sub').textContent = state.located ? `Precisión ≈ ${num.format(state.located.accuracy)} m · distancias y ondas desde ti · no se guarda`
    : 'Activa tu ubicación para medir distancias y ondas desde ti.';
  $('locate').hidden = Boolean(state.located);
  $('locate').disabled = state.locating;
  $('reset-location').hidden = !state.located;
  $('center-map').setAttribute('aria-label', state.located ? 'Centrar en tu ubicación' : 'Usar mi ubicación');
  $('center-map').title = $('center-map').getAttribute('aria-label');
}

function renderNotify() {
  const on = state.notify && notificationPermission() === 'granted';
  $('notify').setAttribute('aria-pressed', on);
  $('notify').querySelector('span').textContent = on ? 'Avisos activos' : 'Activar avisos';
}

// Filters the server uses for Web Push. A personal location leaves the browser rounded to ~11 km.
const pushFilters = () => ({ located: Boolean(state.located), lat: Math.round(state.center.lat * 10) / 10, lon: Math.round(state.center.lon * 10) / 10,
  radius: state.radius, minMag: state.minMag, source: state.source, hours: state.hours });
let pushSync = 0;
// The last subscribe request: turning avisos off waits for it, or it would re-create the server record.
let pushTask = Promise.resolve(false);
function syncPush() {
  if (!state.notify) return;
  clearTimeout(pushSync);
  pushSync = setTimeout(() => updatePushFilters(pushFilters()), 1500);
}

async function toggleNotify() {
  if (state.notify && notificationPermission() === 'granted') {
    state.notify = false;
    saveSettings(state);
    renderNotify();
    pushTask.then(disablePush);
    return notice('Avisos desactivados. Se borró la suscripción de este dispositivo.');
  }
  const permission = await requestNotifications();
  if (permission === 'granted') {
    state.notify = true;
    saveSettings(state);
    renderNotify();
    const scope = `${num.format(state.radius)} km ${fromWhere()}${state.minMag ? ` desde M ${state.minMag}` : ''}`;
    const push = await (pushTask = enablePush(pushFilters));
    showNotification('Avisos activados', `Nuevos registros a ${scope}${push ? ', también con el panel cerrado.' : ' mientras el panel esté abierto.'}`);
    notice(push ? `Avisos activados para nuevos registros a ${scope}, también con el panel cerrado (revisión cada minuto). Cambiar los filtros actualiza los avisos.`
      : `Avisos activados para nuevos registros a ${scope}. Este navegador solo los recibe mientras el panel esté abierto.`);
  } else if (permission === 'install') {
    notice('En iPhone y iPad los avisos requieren abrir el panel desde la pantalla de inicio: Compartir → Agregar a inicio, y actívalos desde allí.', 'warning');
  } else if (permission === 'denied') {
    notice('Las notificaciones están bloqueadas para este sitio. Permítelas en la configuración del navegador.', 'warning');
  } else if (permission === 'unsupported') {
    notice('Este navegador no permite notificaciones.', 'warning');
  }
}

function renderStats(now) {
  const known = state.visible.filter(e => e.mag !== null);
  const top = known.reduce((best, e) => (!best || e.mag > best.mag ? e : best), null);
  const available = activeSources().some(source => source.available);
  $('stat-count').textContent = available ? num.format(state.visible.length) : '—';
  $('stat-period').textContent = `registros · ${periodShort()}`;
  $('stat-max-value').textContent = top ? `M ${magText(top.mag)}` : '—';
  $('stat-max-value').style.color = top ? magnitudeColor(top.mag) : '';
  $('stat-max-time').textContent = top ? `mayor · ${shortTime.format(top.time)}` : 'mayor';
  $('stat-max').disabled = !top;
  $('stat-max').dataset.id = top?.id || '';
  $('stat-hour').textContent = available ? state.visible.filter(e => e.time >= now - HOUR).length : '—';
  const bins = histogram(state.visible, state.hours, now);
  const max = Math.max(1, ...bins.map(bin => bin.count));
  $('sparkline').innerHTML = bins.map(bin => `<i style="height:${bin.count ? 4 + bin.count / max * 30 : 2}px;background:${bin.count ? magnitudeColor(bin.maxMag) : ''}"></i>`).join('');
  $('sparkline').setAttribute('aria-label', `${state.visible.length} registros en ${periodText()}; máximo ${Math.max(0, ...bins.map(b => b.count))} por intervalo.`);
  $('spark-start').textContent = state.hours === 1 ? 'hace 1 h' : state.hours === 24 ? 'hace 24 h' : 'hace 7 días';
  $('spark-middle').textContent = state.hours === 1 ? 'hace 30 min' : state.hours === 24 ? 'hace 12 h' : 'hace 3,5 días';
}

function render() {
  const now = Date.now();
  for (const [id, timestamp] of state.newIds) if (now - timestamp > 5 * 60_000) state.newIds.delete(id);
  state.visible = filterEvents(state.events, state, now);
  if (state.sort === 'distance') state.visible.sort((a, b) => a.distance - b.distance);
  if (state.sort === 'mag') state.visible.sort((a, b) => (b.mag ?? -Infinity) - (a.mag ?? -Infinity) || b.time - a.time);
  if (!state.visible.some(e => e.id === state.selected)) state.selected = state.visible[0]?.id || null;
  $('region-name').textContent = state.located ? 'Alrededor de tu ubicación' : state.center.label;
  $('radius').value = state.radius;
  $('min-mag').value = state.minMag;
  $('source').value = state.source;
  document.querySelectorAll('[data-hours]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.hours) === state.hours));
  document.querySelectorAll('[data-ripples]').forEach(button => button.setAttribute('aria-pressed', button.dataset.ripples === state.ripples));
  const available = activeSources().some(source => source.available);
  $('event-count').textContent = available ? state.visible.length : '—';
  // Both catalogs can publish the same earthquake: flag the pairs, never merge or subtract them.
  const twins = state.source === 'all' ? twinIds(state.visible) : new Set();
  const pairs = Math.min(...['up', 'usgs'].map(source => state.visible.filter(e => e.source === source && twins.has(e.id)).length));
  $('list-subtitle').textContent = `${num.format(state.radius)} km · ${periodShort()} · distancias ${fromWhere()}${pairs ? ` · ${pairs} ${pairs === 1 ? 'sismo' : 'sismos'} en ambas fuentes` : ''}`;
  const newIds = new Set(state.newIds.keys());
  $('events').innerHTML = state.visible.length ? state.visible.map(event => {
    const place = displayPlace(event.place);
    const depth = event.depth === null ? 'prof. —' : isProvisionalDepth(event.depth) ? 'prof. 10 km (prov.)' : `prof. ${num.format(event.depth)} km`;
    const other = event.source === 'up' ? 'USGS' : 'UP';
    return `<button class="event ${event.id === state.selected ? 'selected' : ''}" data-id="${escapeHTML(event.id)}" aria-pressed="${event.id === state.selected}">
    <span class="event-mag" style="--mag-color:${magnitudeColor(event.mag)}">${magText(event.mag)}</span><span class="event-info"><span class="event-place">${escapeHTML(place.title)}</span><span class="event-time">${timeFormat.format(event.time)} · ${ago(event.time)}${newIds.has(event.id) ? '<b class="new-tag">Nuevo</b>' : ''}</span><span class="event-meta"><b>${num.format(event.distance)} km</b><span>${depth}</span><i class="source-tag ${event.source}">${event.source === 'up' ? 'UP' : SOURCE_LABELS[event.source]}${event.status === 'preliminary' ? ' · prelim.' : ''}</i>${twins.has(event.id) ? `<i class="twin-tag" title="Probablemente el mismo sismo que un registro de ${other}">también en ${other}</i>` : ''}</span></span></button>`;
  }).join('') : `<p class="empty">${available ? 'No hay registros publicados que coincidan con estos filtros. Amplía el radio, el período o baja la magnitud mínima.' : state.failed || state.sources.length ? 'La fuente seleccionada no está disponible. Puedes cambiar de fuente o esperar el próximo intento.' : 'Consultando USGS y Geociencias UP…'}</p>`;
  renderDetail(selectedEvent());
  renderLocation();
  renderStats(now);
  const selected = selectedEvent();
  map.draw(state.visible, state.center, player.mode === 'replay' ? null : state.selected, newIds, {
    ripples: player.mode === 'replay' ? 'none' : state.ripples, now, radius: state.radius, located: state.located,
    linkText: selected ? `${num.format(selected.distance)} km ${fromWhere()}` : '',
  });
  if (state.fitNext && state.loaded) { map.fit(state.visible, state.center); state.fitNext = false; }
  renderActivity(now);
  renderTrend(now);
  renderSources();
  renderNotify();
  syncPlayer();
}

// ——— Frequency and energy trend (one record per earthquake) ———

const sismos = count => `${count} ${count === 1 ? 'sismo' : 'sismos'}`;
// The last window against the previous one, in words. `before` names the previous window.
function trendSummary(trend, before) {
  const { current, previous, ratio } = trend;
  const direction = trendDirection(trend);
  const arrow = { up: '↑', down: '↓', same: '→', none: '·' }[direction];
  const change = direction === 'none' ? 'sin sismos en ambas'
    : ratio === null ? `sube (${before}: sin sismos)`
    : !current.energy ? `sin sismos (${before}: ${sismos(previous.count)})`
    : ratio >= 1 ? `${formatRatio(ratio)} ${before}` : `${formatRatio(1 / ratio)} menos que ${before}`;
  const short = direction === 'none' ? 'sin sismos' : ratio === null ? 'sube' : !current.energy ? 'sin sismos'
    : ratio >= 1 ? formatRatio(ratio) : `${formatRatio(1 / ratio)} menos`;
  return { direction, arrow, change, short, counts: `${sismos(current.count)} (antes ${previous.count})` };
}

function renderTrend(now) {
  const card = $('trend-card');
  if (!activeSources().some(source => source.available)) {
    card.dataset.trend = 'none';
    $('trend-arrow').textContent = '·';
    $('trend-detail').textContent = 'Esperando los catálogos…';
    $('activity-trend').innerHTML = '';
    $('energy-comparison').innerHTML = '';
    return;
  }
  // Ignores the period filter: always the last hours, with radius, magnitude and source.
  const recent = uniqueEvents(filterEvents(state.events, { ...state, hours: 12 }, now));
  const comparison = clockHourComparison(recent, now);
  const { previous, current, ratio, start } = comparison;
  const maximum = Math.max(previous.energy, current.energy, 1);
  const changed = ratio === null ? (current.energy ? 'Sin energía en la hora anterior' : 'Sin energía registrada')
    : ratio >= 1 ? `${formatRatio(ratio)} la energía anterior` : current.energy ? `${formatRatio(1 / ratio)} menos energía` : 'Sin energía en la franja actual';
  const chart = $('energy-comparison');
  chart.dataset.direction = ratio !== null && ratio > 1 ? 'up' : 'down';
  chart.innerHTML = `<div class="energy-totals"><strong>${formatEnergy(previous.energy)}</strong><strong>${formatEnergy(current.energy)}</strong></div>
    <strong class="energy-ratio">${escapeHTML(changed)}</strong>
    <p>${sismos(current.count)} en la franja actual, frente a ${sismos(previous.count)} en la hora anterior.</p>
    <div class="energy-bars" role="img" aria-label="Energía aproximada, escala lineal: anterior ${formatEnergy(previous.energy)}, actual ${formatEnergy(current.energy)}">
      ${[previous, current].map(v => `<div><span>${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v.energy / 1e12)}</span><i style="height:${v.energy ? Math.max(2, v.energy / maximum * 150) : 0}px"></i></div>`).join('')}
    </div><div class="energy-periods"><span>${shortTime.format(start - HOUR)}–${shortTime.format(start)}</span><span>${shortTime.format(start)}–${shortTime.format(now)}</span></div>
    <p>Barras en billones de julios (10¹² J). Franja actual incompleta; no se extrapola. Esto describe lo registrado, no predice si la actividad se calmará. GeoShake se excluye de energía y frecuencia para evitar duplicar los catálogos oficiales.</p>`;
  const hour = energyTrend(recent, HOUR, now);
  const six = energyTrend(recent, 6 * HOUR, now);
  const h = trendSummary(hour, 'la hora anterior');
  const s = trendSummary(six, 'las 6 h anteriores');
  card.dataset.trend = h.direction;
  $('trend-arrow').textContent = h.arrow;
  $('trend-title').textContent = h.direction === 'none' ? 'Energía: sin sismos en las últimas 2 horas' : `Energía: ${h.change}`;
  $('trend-detail').textContent = h.direction === 'none' ? `6 h: ${s.arrow} ${s.short}`
    : `${formatEnergy(hour.current.energy)} · ${h.counts} · 6 h: ${s.arrow} ${s.short}`;
  card.setAttribute('aria-label', `${$('trend-title').textContent}. Ver frecuencia y energía`);
  $('activity-trend').innerHTML = [[hour, h, 'Última hora'], [six, s, 'Últimas 6 h']].map(([trend, summary, label]) =>
    `<div class="trend-row" data-trend="${summary.direction}"><span>${label}</span><strong>${formatEnergy(trend.current.energy)}${trend.current.energy ? ` · ${formatTNT(trend.current.energy)}` : ''}</strong><small><b>${summary.arrow} ${escapeHTML(summary.change)}</b> · ${summary.counts}</small></div>`).join('');
}

function renderActivity(now) {
  const unique = uniqueEvents(state.visible);
  const bins = histogram(unique, state.hours, now);
  const max = Math.max(1, ...bins.map(bin => bin.count));
  $('chart').innerHTML = bins.map(bin => `<div class="chart-column" title="${dateFormat.format(bin.time)}: ${sismos(bin.count)} · ${formatEnergy(bin.energy)}"><span class="bar-count">${bin.count || ''}</span><div class="bar" style="height:${bin.count / max * 75}px;background:${magnitudeColor(bin.maxMag)}"></div></div>`).join('');
  // Energy spans orders of magnitude: log scale, empty intervals on the baseline.
  const logs = bins.filter(bin => bin.energy > 0).map(bin => Math.log10(bin.energy));
  const low = Math.min(...logs) - 0.5;
  const high = Math.max(...logs);
  const points = bins.map((bin, index) => {
    const share = !bin.energy ? 0 : high - low < 0.01 ? 0.8 : (Math.log10(bin.energy) - low) / (high - low);
    return `${((index + 0.5) / bins.length * 240).toFixed(1)},${(100 - share * 92).toFixed(1)}`;
  });
  $('energy-line').innerHTML = logs.length ? `<polyline points="${points.join(' ')}" />` : '';
  const total = bins.reduce((sum, bin) => sum + bin.energy, 0);
  $('chart').setAttribute('aria-label', `${sismos(unique.length)} en ${periodText()}, energía total ${formatEnergy(total)}, repartidos en 24 intervalos. Máximo de ${Math.max(0, ...bins.map(b => b.count))} por intervalo.`);
  $('activity-subtitle').textContent = state.hours === 24 ? 'Sismos y energía por hora dentro de tu consulta' : state.hours === 1 ? 'Sismos y energía cada 2,5 minutos dentro de tu consulta' : 'Sismos y energía cada 7 horas dentro de tu consulta';
  $('last-hour').textContent = unique.filter(e => e.time >= now - HOUR).length;
  $('chart-start').textContent = state.hours === 1 ? 'Hace 1 hora' : state.hours === 24 ? 'Hace 24 horas' : 'Hace 7 días';
  $('chart-middle').textContent = state.hours === 1 ? 'Hace 30 min' : state.hours === 24 ? 'Hace 12 horas' : 'Hace 3,5 días';
}

// ——— Wave replay of the selected event ———

function syncPlayer() {
  if (player.mode === 'replay') {
    if (player.replay.hours !== state.hours) startReplay();
    else { renderReplayBins(); map.replay(player.replay.t, null, player.replay.end - player.replay.start); paintReplay(); }
    return;
  }
  const times = waveTimes();
  const key = times ? `${times.event.id}|${state.center.lat}|${state.center.lon}` : null;
  if (key !== player.key) {
    player.key = key;
    player.stage = null;
    player.t = times && (!player.playing || reducedMotion) ? times.s : 0;
    if (times) {
      const where = state.located ? 'ti' : state.center.label === PANAMA.label ? 'el centro de Panamá' : 'el centro de consulta';
      $('wave-title').textContent = `Ondas del M ${magText(times.event.mag)} hacia ${where}`;
      $('wave-sub').textContent = `Repetición educativa, no alerta · ocurrió ${dateFormat.format(times.event.time)} · P ${WAVE_SPEED.p.toFixed(1)} km/s · S ${WAVE_SPEED.s.toFixed(1)} km/s (medias)`;
      $('label-p').textContent = `P ${times.p.toFixed(1)} s`;
      $('label-s').textContent = `S ${times.s.toFixed(1)} s`;
      for (const kind of ['p', 's']) {
        const left = `${(times[kind] / times.end) * 100}%`;
        $(`mark-${kind}`).style.left = left;
        $(`label-${kind}`).style.left = left;
      }
    } else {
      $('wave-title').textContent = selectedEvent()?.source === 'geoshake' ? 'GeoShake: profundidad no disponible' : 'Selecciona un sismo';
      $('wave-sub').textContent = 'Repetición educativa de las ondas P y S desde el epicentro hasta tu ubicación. No es una alerta.';
    }
    $('wave-card').classList.toggle('empty', !times);
  }
  paintWaves();
  animate();
}

function paintWaves() {
  const times = waveTimes();
  if (!times) {
    map.setWaves(null);
    map.setCenterStatus('', '');
    return;
  }
  const t = player.t;
  const showing = t <= times.end;
  map.setWaves(showing ? { lat: times.event.lat, lon: times.event.lon, toward: state.center,
    pKm: surfaceRadiusKm(t, WAVE_SPEED.p, times.depth), sKm: surfaceRadiusKm(t, WAVE_SPEED.s, times.depth) } : null);
  const stage = t >= times.s ? 's' : t >= times.p ? 'p' : '';
  if (stage !== player.stage) {
    if (stage && player.stage !== null && player.playing) map.flashCenter(stage);
    player.stage = stage;
    map.setCenterStatus(stage === 's' ? 'llegó onda S' : stage === 'p' ? 'llegó onda P' : 'esperando ondas', stage);
  }
  const shown = Math.min(t, times.end);
  const percent = `${(shown / times.end) * 100}%`;
  $('wave-time').textContent = `+${shown.toFixed(1)} s`;
  $('wave-fill').style.width = percent;
  $('wave-head').style.left = percent;
  $('tile-p')?.classList.toggle('arrived', t >= times.p);
  $('tile-s')?.classList.toggle('arrived', t >= times.s);
}

function updatePlayButtons() {
  const waves = $('wave-play');
  waves.classList.toggle('playing', player.playing);
  waves.setAttribute('aria-label', player.playing ? 'Pausar repetición de ondas' : 'Reproducir ondas');
  const replay = $('replay-play');
  replay.classList.toggle('playing', player.replay.playing);
  replay.setAttribute('aria-label', player.replay.playing ? 'Pausar repetición del período' : 'Reproducir el período');
}

function animate() {
  updatePlayButtons();
  const busy = player.mode === 'waves' ? player.playing && Boolean(selectedEvent()) : player.replay.playing;
  if (busy && !player.raf) {
    player.last = performance.now();
    player.raf = requestAnimationFrame(frame);
  }
}

function frame(now) {
  const dt = Math.min(0.25, (now - player.last) / 1000);
  player.last = now;
  if (player.mode === 'waves') {
    const times = waveTimes();
    if (times && player.playing) {
      player.t += dt * player.speed;
      if (player.t > times.end + 3) { player.t = 0; player.stage = ''; map.setCenterStatus('esperando ondas', ''); }
    }
  } else if (player.replay.playing) {
    const replay = player.replay;
    replay.t += dt * ((replay.end - replay.start) / replay.duration); // whole period in `duration` seconds
    if (replay.t >= replay.end) { replay.t = replay.end; replay.playing = false; }
  }
  if (now - player.painted >= 33) {
    player.painted = now;
    if (player.mode === 'waves') paintWaves(); else paintReplay();
  }
  const busy = player.mode === 'waves' ? player.playing && Boolean(selectedEvent()) : player.replay.playing;
  player.raf = busy ? requestAnimationFrame(frame) : 0;
  if (!busy) { if (player.mode === 'waves') paintWaves(); else paintReplay(); updatePlayButtons(); }
}

// ——— Timelapse of the whole period ———

function startReplay() {
  const replay = player.replay;
  replay.end = Date.now();
  replay.start = replay.end - state.hours * HOUR;
  replay.hours = state.hours;
  const first = state.visible.reduce((min, e) => Math.min(min, e.time), Infinity);
  replay.t = Number.isFinite(first) ? Math.max(replay.start, first - (replay.end - replay.start) * 0.02) : replay.start;
  replay.drawn = null;
  replay.playing = true;
  $('replay-start').textContent = dateFormat.format(replay.start);
  $('replay-middle').textContent = dateFormat.format((replay.start + replay.end) / 2);
  renderReplayBins();
  map.replay(replay.t, null, replay.end - replay.start);
  paintReplay();
  animate();
}

function renderReplayBins() {
  const replay = player.replay;
  const span = replay.end - replay.start;
  const width = span / 48;
  const bins = Array.from({ length: 48 }, (_, index) => ({ start: replay.start + index * width, count: 0, maxMag: null }));
  for (const event of state.visible) {
    if (event.time < replay.start || event.time > replay.end) continue;
    const bin = bins[Math.min(47, Math.floor((event.time - replay.start) / width))];
    bin.count++;
    if (event.mag !== null) bin.maxMag = Math.max(bin.maxMag ?? -Infinity, event.mag);
  }
  const max = Math.max(1, ...bins.map(bin => bin.count));
  replay.bins = bins;
  $('replay-bins').innerHTML = bins.map((bin, index) => `<button data-bin="${index}" aria-label="${dateFormat.format(bin.start)}: ${bin.count} registros"><i style="height:${bin.count ? 6 + bin.count / max * 50 : 3}px;${bin.count ? `background:${magnitudeColor(bin.maxMag)}` : ''}"></i></button>`).join('');
}

function paintReplay() {
  const replay = player.replay;
  map.replay(replay.t, replay.drawn, replay.end - replay.start);
  replay.drawn = replay.t;
  const shown = state.visible.filter(e => e.time <= replay.t);
  const top = shown.reduce((best, e) => (e.mag !== null && (!best || e.mag > best.mag) ? e : best), null);
  $('replay-clock').textContent = state.hours === 168 ? dateFormat.format(replay.t) : shortTime.format(replay.t);
  $('replay-sub').textContent = `${shown.length} ${shown.length === 1 ? 'registro' : 'registros'} hasta esta hora${top ? ` · mayor M ${magText(top.mag)}` : ''} · ${replay.playing ? 'cada sismo lanza su onda al ocurrir' : 'en pausa'}`;
  const percent = ((replay.t - replay.start) / (replay.end - replay.start)) * 100;
  $('replay-head').style.left = `${Math.max(0, Math.min(100, percent))}%`;
  $('replay-bins').querySelectorAll('button').forEach((button, index) => button.classList.toggle('future', replay.bins[index]?.start > replay.t));
}

function setMode(mode) {
  if (player.mode === mode) return;
  player.mode = mode;
  $('tab-waves').setAttribute('aria-selected', mode === 'waves');
  $('tab-replay').setAttribute('aria-selected', mode === 'replay');
  $('wave-panel').hidden = mode !== 'waves';
  $('replay-panel').hidden = mode !== 'replay';
  if (mode === 'replay') {
    map.setWaves(null);
    map.setCenterStatus('', '');
    player.replay.hours = 0; // render() → syncPlayer() starts a fresh timelapse.
    render();
  } else {
    player.replay.playing = false;
    player.replay.hours = 0;
    map.replay(null, null, 1);
    player.key = null;
    render();
  }
}

// ——— Location ———

function locate(quiet = false) {
  if (!navigator.geolocation) return quiet || notice('Este navegador no ofrece ubicación. Puedes seguir consultando Panamá.', 'warning');
  state.locating = true;
  renderLocation();
  navigator.geolocation.getCurrentPosition(position => {
    state.center = { lat: position.coords.latitude, lon: position.coords.longitude, label: 'Tu ubicación' };
    state.located = { accuracy: position.coords.accuracy };
    state.locating = false;
    state.fitNext = true;
    if (!quiet) notice(`Ubicación obtenida con precisión aproximada de ${num.format(position.coords.accuracy)} m. No se guarda.`);
    render();
    syncPush();
  }, () => {
    state.locating = false;
    renderLocation();
    if (!quiet) notice('No se pudo obtener tu ubicación. Revisa el permiso del navegador; se mantiene el centro de consulta actual.', 'warning');
  }, { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 });
}

function connection(label, warning = false) {
  $('connection').classList.toggle('warning', warning);
  $('connection').querySelector('span').textContent = label;
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  $('refresh').disabled = true;
  connection('Consultando fuentes');
  try {
    const payload = await loadEarthquakes(AbortSignal.timeout(25_000));
    const detected = changes(state.previous, payload.events);
    const diff = { added: detected.added.filter(e => state.seenSources.has(e.source)), revised: detected.revised.filter(e => state.seenSources.has(e.source)) };
    const live = state.events.filter(e => e.source === 'geoshake' && !payload.events.some(p => p.id === e.id));
    payload.events.push(...live.filter(e => e.time >= Date.now() - 7 * 24 * HOUR));
    state.events = payload.events;
    state.sources = payload.sources;
    state.loaded = payload.sources.some(source => source.available);
    state.failed = !state.loaded;
    state.stale = activeSources().some(sourceIsStale);
    for (const source of payload.sources) if (source.available) state.seenSources.add(source.id);
    for (const event of diff.added) state.newIds.set(event.id, Date.now());
    state.previous = new Map(payload.events.map(e => [e.id, e.updated]));
    const addedEvents = filterEvents(diff.added.filter(e => e.source !== 'geoshake'), state);
    const addedHere = addedEvents.length;
    const revisedHere = filterEvents(diff.revised, state).length;
    // A sharp energy rise is said once an hour, in the notice and in the notification title.
    const hourTrend = energyTrend(uniqueEvents(filterEvents(state.events, { ...state, hours: 2 })), HOUR);
    const jump = addedHere && energyJump(hourTrend) && !(state.jumpAt > Date.now() - HOUR) ? hourTrend : null;
    if (jump) state.jumpAt = Date.now();
    if (state.stale) notice(activeSources().filter(sourceIsStale).map(source => source.error || `${source.label}: datos sin actualizar`).join('. ') + '. Se muestran los datos disponibles de cada fuente.', 'warning');
    else if (jump) notice(`${addedHere} ${addedHere === 1 ? 'nuevo registro' : 'nuevos registros'} en tu zona. La energía de la última hora es ${formatRatio(jump.ratio)} la de la hora anterior.`, 'warning');
    else if (addedHere) notice(`${addedHere} ${addedHere === 1 ? 'nuevo registro publicado' : 'nuevos registros publicados'} en tu zona. Resaltados durante 5 minutos.`);
    else if (revisedHere) notice(`Las fuentes revisaron ${revisedHere} ${revisedHere === 1 ? 'registro' : 'registros'} de esta consulta.`);
    else notice('');
    connection(state.stale ? 'Fuente sin actualizar' : 'Consultas al día', state.stale);
    render();
    if (state.notify) notifyNewRecords(addedEvents, fromWhere(), jump);
  } catch (error) {
    state.failed = true;
    state.stale = true;
    connection('Sin conexión', true);
    notice(`${error.name === 'TimeoutError' ? 'La consulta tardó demasiado en responder.' : error.message} ${state.loaded ? 'Los datos visibles pertenecen a la última consulta exitosa.' : ''}`, 'warning');
    if (!state.loaded) render();
  } finally {
    state.loading = false;
    state.nextAt = Date.now() + REFRESH_MS;
    $('refresh').disabled = false;
  }
}

function changedFilters() { saveSettings(state); render(); syncPush(); }
$('events').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) selectEvent(button.dataset.id); });
$('detail').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) selectEvent(button.dataset.id); });
$('stat-max').addEventListener('click', () => { if ($('stat-max').dataset.id) selectEvent($('stat-max').dataset.id); });
document.querySelectorAll('[data-hours]').forEach(button => button.addEventListener('click', () => { state.hours = Number(button.dataset.hours); changedFilters(); }));
document.querySelectorAll('[data-ripples]').forEach(button => button.addEventListener('click', () => { state.ripples = button.dataset.ripples; changedFilters(); }));
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {
  player.speed = Number(button.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach(other => other.setAttribute('aria-pressed', other === button));
}));
document.querySelectorAll('[data-duration]').forEach(button => button.addEventListener('click', () => {
  player.replay.duration = Number(button.dataset.duration);
  document.querySelectorAll('[data-duration]').forEach(other => other.setAttribute('aria-pressed', other === button));
}));
$('wave-play').addEventListener('click', () => {
  const times = waveTimes();
  player.playing = !player.playing;
  if (player.playing && times && player.t >= times.end) { player.t = 0; player.stage = ''; }
  paintWaves();
  animate();
});
$('replay-play').addEventListener('click', () => {
  const replay = player.replay;
  replay.playing = !replay.playing;
  if (replay.playing && replay.t >= replay.end) { replay.t = replay.start; replay.drawn = null; }
  paintReplay();
  animate();
});
$('replay-bins').addEventListener('click', event => {
  const button = event.target.closest('[data-bin]');
  if (!button) return;
  player.replay.t = player.replay.bins[Number(button.dataset.bin)].start;
  player.replay.drawn = null;
  paintReplay();
});
$('replay-top').addEventListener('click', () => {
  const top = state.visible.reduce((best, e) => (e.mag !== null && (!best || e.mag > best.mag) ? e : best), null);
  if (!top) return;
  player.replay.t = Math.max(player.replay.start, top.time - 1000);
  player.replay.drawn = player.replay.t;
  player.replay.duration = 180;
  document.querySelectorAll('[data-duration]').forEach(other => other.setAttribute('aria-pressed', other.dataset.duration === '180'));
  player.replay.playing = true;
  paintReplay();
  animate();
});
$('tab-waves').addEventListener('click', () => setMode('waves'));
$('tab-replay').addEventListener('click', () => setMode('replay'));
$('radius').addEventListener('change', () => { state.radius = Number($('radius').value); state.fitNext = true; changedFilters(); });
$('min-mag').addEventListener('change', () => { state.minMag = Number($('min-mag').value); changedFilters(); });
$('source').addEventListener('change', () => { state.source = $('source').value; state.fitNext = true; notice(''); changedFilters(); });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; render(); });
$('refresh').addEventListener('click', refresh);
$('notify').addEventListener('click', async () => { await toggleNotify(); updateWelcome(); });
$('install').addEventListener('click', promptInstall);
welcomeReady = true;
updateWelcome();
onNotificationSelect(id => selectEvent(id));
$('fit-map').addEventListener('click', () => map.fit(state.visible, state.center));
$('zoom-in').addEventListener('click', () => map.zoomBy(1));
$('zoom-out').addEventListener('click', () => map.zoomBy(-1));
$('center-map').addEventListener('click', () => (state.located ? map.panTo(state.center) : locate()));
$('satellite').addEventListener('click', () => { state.satellite = !state.satellite; map.satellite(state.satellite); $('satellite').setAttribute('aria-pressed', state.satellite); });
$('about-button').addEventListener('click', () => $('about').showModal());
$('close-about').addEventListener('click', () => $('about').close());
$('activity-button').addEventListener('click', () => $('activity-dialog').showModal());
$('trend-card').addEventListener('click', () => $('activity-dialog').showModal());
$('close-activity').addEventListener('click', () => $('activity-dialog').close());
$('locate').addEventListener('click', () => locate());
$('reset-location').addEventListener('click', () => { state.center = { ...PANAMA }; state.located = null; state.fitNext = true; notice(''); render(); syncPush(); });
setInterval(() => {
  const seconds = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
  $('countdown').textContent = state.loading ? 'Consultando…' : `Próxima consulta en ${seconds} s`;
  if (!seconds && !state.loading) refresh();
  if (state.loaded && activeSources().some(sourceIsStale) && !state.stale) {
    renderSources();
    notice('Una fuente lleva más de 5 minutos sin una consulta reciente. Se conservan los últimos datos disponibles.', 'warning');
  }
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() >= state.nextAt) refresh(); });
addEventListener('online', refresh);
// Ask for the position on load only when the browser already has permission; otherwise wait for a click.
navigator.permissions?.query({ name: 'geolocation' }).then(status => { if (status.state === 'granted') locate(true); }).catch(() => {});
render();
refresh();

// EventSource reconnects automatically; individual station triggers are not earthquake events.
const geoStream = new EventSource('/api/geoshake-live');
geoStream.onopen = () => { $('geoshake-live').textContent = 'GeoShake: conexión en vivo'; };
geoStream.onerror = () => { $('geoshake-live').textContent = 'GeoShake: reconectando; catálogo disponible en las consultas'; };
geoStream.onmessage = message => {
  const feature = geoShakeMessage(message.data);
  if (!feature) return;
  const event = normalize([feature])[0];
  const isNew = !state.events.some(e => e.id === event.id);
  state.events = [event, ...state.events.filter(e => e.id !== event.id)].sort((a, b) => b.time - a.time);
  state.previous?.set(event.id, event.updated);
  const source = state.sources.find(s => s.id === 'geoshake');
  if (source) Object.assign(source, { available: true, fetchedAt: Date.now(), error: null, stale: false });
  if (isNew && event.time >= Date.now() - 300_000) state.newIds.set(event.id, Date.now());
  render();
  if (isNew && event.time >= Date.now() - 300_000 && state.notify) notifyNewRecords(filterEvents([event], state), fromWhere());
};
addEventListener('pagehide', () => geoStream.close(), { once: true });
// Re-register Web Push on every visit: covers avisos activated before push existed and lost server records.
if (state.notify && notificationPermission() === 'granted') pushTask = enablePush(pushFilters);
// Vercel Web Analytics exists only on the deployed site (script served from /_vercel/insights).
if (!['localhost', '127.0.0.1'].includes(location.hostname)) import('/vendor/vercel-analytics.js').then(({ inject }) => inject()).catch(() => {});
