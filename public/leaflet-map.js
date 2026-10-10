import { createOverlay, mapPadding } from "./overlay.js";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

export function createLeafletMap(onSelect) {
  const map = L.map("map", {
    zoomControl: false,
    minZoom: 2,
    maxZoom: 17,
  }).setView([8.1, -80.3], 7);
  L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
  const attribution = "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
  const atlas = L.layerGroup([
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { attribution, maxZoom: 17, maxNativeZoom: 16 }),
    L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 17, maxNativeZoom: 16 }),
  ]);
  const satellite = L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
    attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 17,
  });
  atlas.addTo(map);
  let tileFailures = 0;
  for (const layer of [...atlas.getLayers(), satellite]) {
    layer.on("tileerror", () => {
      if (++tileFailures >= 3)
        document.getElementById("map-error").hidden = false;
    });
    layer.on("tileload", () => {
      tileFailures = 0;
      document.getElementById("map-error").hidden = true;
    });
  }

  const markers = new Map();
  const quiet = { interactive: false };
  const shapes = {
    p: L.polygon([], { ...quiet, color: "#3fd8b0", weight: 1.8, dashArray: "6 6", fillColor: "#3fd8b0", fillOpacity: 0.05 }),
    s: L.polygon([], { ...quiet, color: "#b39dff", weight: 3, opacity: 0.95, fillColor: "#b39dff", fillOpacity: 0.08 }),
    link: L.polyline([], { ...quiet, color: "#e8eef0", opacity: 0.6, weight: 1.2, dashArray: "2 6" }),
    radius: L.circle([0, 0], { ...quiet, radius: 1, color: "#5b7882", opacity: 0.5, weight: 1, dashArray: "6 7", fill: false }),
    accuracy: L.circle([0, 0], { ...quiet, radius: 1, color: "#4c8dff", opacity: 0.6, weight: 1, fillColor: "#4c8dff", fillOpacity: 0.12 }),
  };
  const show = (shape, visible) => {
    if (visible && !map.hasLayer(shape)) shape.addTo(map);
    if (!visible && map.hasLayer(shape)) shape.remove();
  };
  const latLngs = (points) => points.map((point) => [point.lat, point.lon]);

  const overlay = createOverlay(
    {
      set(id, node, lat, lon, z) {
        let marker = markers.get(id);
        if (!marker) {
          marker = L.marker([lat, lon], {
            icon: L.divIcon({ html: node, className: "html-icon", iconSize: [0, 0] }),
            interactive: false,
            keyboard: false,
            zIndexOffset: z * 100,
          }).addTo(map);
          L.DomEvent.disableClickPropagation(node);
          markers.set(id, marker);
          return;
        }
        const at = marker.getLatLng();
        if (at.lat !== lat || at.lng !== lon) marker.setLatLng([lat, lon]);
        if (marker.options.zIndexOffset !== z * 100) marker.setZIndexOffset(z * 100);
      },
      remove(id) {
        markers.get(id)?.remove();
        markers.delete(id);
      },
      waves(p, s) {
        if (p) shapes.p.setLatLngs(latLngs(p));
        if (s) shapes.s.setLatLngs(latLngs(s));
        show(shapes.p, Boolean(p));
        show(shapes.s, Boolean(s));
      },
      link(from, to) {
        if (from) shapes.link.setLatLngs([[from.lat, from.lon], [to.lat, to.lon]]);
        show(shapes.link, Boolean(from));
      },
      radius(center, km) {
        shapes.radius.setLatLng([center.lat, center.lon]).setRadius(km * 1000);
        show(shapes.radius, true);
      },
      accuracy(center, meters) {
        if (meters) shapes.accuracy.setLatLng([center.lat, center.lon]).setRadius(meters);
        show(shapes.accuracy, Boolean(meters));
      },
    },
    onSelect,
  );

  const fitPoints = (points, maxZoom) => {
    const padding = mapPadding();
    map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lon])), {
      paddingTopLeft: [padding.left, padding.top],
      paddingBottomRight: [padding.right, padding.bottom],
      maxZoom,
    });
  };

  return {
    draw: overlay.draw,
    setWaves: overlay.waves,
    setCenterStatus: overlay.status,
    flashCenter: overlay.flash,
    replay: overlay.replay,
    focus(event, center) {
      fitPoints([event, center], 9);
    },
    fit(events, center) {
      if (events.length) fitPoints([...events, center], 8);
      else map.setView([center.lat, center.lon], 7);
    },
    panTo(center) {
      map.setView([center.lat, center.lon], Math.max(8, map.getZoom()));
    },
    zoomBy(delta) {
      map.setZoom(map.getZoom() + delta);
    },
    satellite(enabled) {
      map.removeLayer(enabled ? atlas : satellite);
      (enabled ? satellite : atlas).addTo(map);
    },
  };
}
