import { HOUR, PANAMA, magnitudeColor, SOURCE_LABELS, displayPlace } from './domain.js';
import { markerDiameter, rippleDiameter, burstDiameter, circlePoints, destination, bearing } from './waves.js';

// Provider-agnostic HTML markers. Each map provider supplies an adapter that positions zero-size
// anchor nodes at coordinates and draws the vector shapes (wave fronts, link line, circles).

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function anchor(child) {
  const wrapper = node('div', 'map-anchor');
  wrapper.append(child);
  return wrapper;
}

function phase(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 3600) / 1000;
}

function eventNode(event, onSelect) {
  const root = node('div', 'map-anchor sismo');
  const dot = node('button', 'sismo-dot');
  dot.type = 'button';
  dot.tabIndex = -1; // The list offers the same selection to keyboard users without hundreds of tab stops.
  dot.addEventListener('click', click => { click.stopPropagation(); onSelect(event.id); });
  root.append(node('span', 'sismo-ripple'), node('span', 'sismo-burst'), dot);
  root.style.setProperty('--delay', `-${phase(event.id)}s`);
  return root;
}

function updateEventNode(root, event, { selected, isNew, rippling }) {
  const dot = root.lastChild;
  root.style.setProperty('--c', magnitudeColor(event.mag));
  root.style.setProperty('--d', `${markerDiameter(event.mag)}px`);
  root.style.setProperty('--r', `${rippleDiameter(event.mag)}px`);
  root.style.setProperty('--b', `${burstDiameter(event.mag)}px`);
  root.classList.toggle('selected', selected);
  root.classList.toggle('is-new', isNew);
  root.classList.toggle('rippling', rippling);
  dot.className = `sismo-dot ${event.source}`;
  const label = `M ${event.mag?.toFixed(1) ?? '—'} · ${SOURCE_LABELS[event.source]} · ${displayPlace(event.place).title}`;
  dot.title = label;
  dot.setAttribute('aria-label', label);
  dot.setAttribute('aria-pressed', String(selected));
}

function centerNode() {
  const root = node('div', 'map-anchor center-node');
  const label = node('span', 'center-label');
  label.append(node('b', '', 'Tú'), node('span', 'center-status'));
  root.append(node('span', 'center-halo'), node('span', 'center-hit'), node('span', 'center-dot'), label);
  return root;
}

export function createOverlay(adapter, onSelect) {
  const nodes = new Map();
  const center = centerNode();
  const link = node('span', 'link-label');
  const linkAnchor = anchor(link);
  const tags = { p: anchor(node('span', 'wave-tag p', 'Onda P')), s: anchor(node('span', 'wave-tag s', 'Onda S')) };

  return {
    draw(events, query, selectedId, newIds, options) {
      const keep = new Set();
      for (const event of events) {
        keep.add(event.id);
        let entry = nodes.get(event.id);
        if (!entry) {
          entry = { node: eventNode(event, onSelect) };
          nodes.set(event.id, entry);
        }
        entry.event = event;
        const selected = event.id === selectedId;
        const rippling = options.ripples === 'all' || (options.ripples === 'hour' && options.now - event.time <= HOUR);
        updateEventNode(entry.node, event, { selected, isNew: newIds.has(event.id), rippling });
        adapter.set(`e:${event.id}`, entry.node, event.lat, event.lon, selected ? 900 : 100 + Math.round((event.mag ?? 0) * 10));
      }
      for (const [id] of nodes) {
        if (keep.has(id)) continue;
        adapter.remove(`e:${id}`);
        nodes.delete(id);
      }

      center.classList.toggle('located', Boolean(options.located));
      center.querySelector('b').textContent = options.located ? 'Tú' : query.label === PANAMA.label ? 'Centro de Panamá' : 'Centro de consulta';
      adapter.set('center', center, query.lat, query.lon, 1000);
      adapter.radius(query, options.radius);
      adapter.accuracy(query, options.located?.accuracy > 150 ? options.located.accuracy : null);

      const selected = events.find(event => event.id === selectedId);
      if (selected && selected.distance >= 1) {
        adapter.link(selected, query);
        link.textContent = options.linkText;
        adapter.set('link', linkAnchor, (selected.lat + query.lat) / 2, (selected.lon + query.lon) / 2, 950);
      } else {
        adapter.link(null);
        adapter.remove('link');
      }
    },
    waves(front) {
      if (!front) {
        adapter.waves(null, null);
        adapter.remove('tag-p');
        adapter.remove('tag-s');
        return;
      }
      const ring = km => (km > 0.5 ? circlePoints(front.lat, front.lon, km, 96) : null);
      adapter.waves(ring(front.pKm), ring(front.sKm));
      // Labels ride the fronts at an angle from the epicenter→center line so they never cover its distance label.
      const side = front.toward ? bearing(front, front.toward) + 65 : 0;
      for (const kind of ['p', 's']) {
        const km = front[`${kind}Km`];
        if (km > 12) {
          const top = destination(front.lat, front.lon, km, side);
          adapter.set(`tag-${kind}`, tags[kind], top.lat, top.lon, 960);
        } else adapter.remove(`tag-${kind}`);
      }
    },
    status(text, stage) {
      const status = center.querySelector('.center-status');
      status.textContent = text;
      status.dataset.stage = stage || '';
    },
    flash(stage) {
      center.classList.remove('hit-p', 'hit-s');
      void center.offsetWidth;
      center.classList.add(`hit-${stage}`);
    },
    // Timelapse: hide records not yet published at `time`, burst the ones crossed since `previous`.
    replay(time, previous, periodMs) {
      for (const entry of nodes.values()) {
        const { node: root, event } = entry;
        if (time === null) {
          root.classList.remove('future', 'burst');
          root.style.opacity = '';
          entry.opacity = undefined;
          continue;
        }
        const visible = event.time <= time;
        root.classList.toggle('future', !visible);
        if (!visible) continue;
        if (previous !== null && event.time > previous) {
          root.classList.remove('burst');
          void root.offsetWidth;
          root.classList.add('burst');
        }
        const opacity = Math.max(0.35, 1 - (time - event.time) / (periodMs * 0.25));
        if (entry.opacity === undefined || Math.abs(entry.opacity - opacity) > 0.03) {
          root.style.opacity = opacity.toFixed(2);
          entry.opacity = opacity;
        }
      }
    },
  };
}

// Space the map keeps clear of the floating panels when fitting bounds.
export function mapPadding() {
  const map = document.getElementById('map').getBoundingClientRect();
  if (matchMedia('(max-width: 850px)').matches) return { top: 70, right: 24, bottom: 24, left: 24 };
  const panel = document.querySelector('.event-panel').getBoundingClientRect();
  const detail = document.getElementById('detail');
  const wave = document.getElementById('wave-card').getBoundingClientRect();
  return {
    top: 80,
    left: Math.max(24, panel.right - map.left + 32),
    // Extra room on the right for the label next to your location dot.
    right: (detail.hidden ? 40 : Math.max(40, map.right - detail.getBoundingClientRect().left + 32)) + 150,
    bottom: Math.max(24, map.bottom - wave.top + 24),
  };
}
