import { createOverlay, mapPadding } from "./overlay.js";

const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1a2b31" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a9bbc1" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b171c" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b171c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6f878f" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#5b7882" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#24373e" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c434b" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

async function loadSDK(key) {
  if (window.google?.maps?.Map) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.nonce = document.querySelector("script[nonce]")?.nonce || "";
    const timer = setTimeout(
      () => reject(new Error("Google Maps no respondió")),
      15_000,
    );
    let loaded = false;
    window.initSismosGoogleMap = () => {
      clearTimeout(timer);
      loaded = true;
      resolve();
    };
    window.gm_authFailure = () => {
      clearTimeout(timer);
      // Google validates the key after the SDK loads (e.g. a referrer not allowed for this domain):
      // reload once with the alternative map for the rest of the session.
      try { sessionStorage.setItem("sismos-google-rejected", "1"); } catch { /* Storage may be disabled. */ }
      if (loaded) location.reload();
      const error = document.getElementById("map-error");
      error.textContent =
        "Google rechazó la configuración del mapa. Revisa la clave, las restricciones y la facturación del proyecto.";
      error.hidden = false;
      reject(new Error("Google Maps no autorizó esta clave"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("No se pudo cargar Google Maps"));
    };
    const params = new URLSearchParams({
      key,
      callback: "initSismosGoogleMap",
      v: "weekly",
      loading: "async",
      language: "es",
      region: "PA",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    document.head.append(script);
  });
}

const dashed = (color, opacity, scale, repeat) => [
  {
    icon: { path: "M 0,-1 0,1", strokeColor: color, strokeOpacity: opacity, scale },
    offset: "0",
    repeat,
  },
];

export async function createGoogleMap(onSelect, key) {
  await loadSDK(key);
  const maps = google.maps;
  const map = new maps.Map(document.getElementById("map"), {
    center: { lat: 8.1, lng: -80.3 },
    zoom: 7,
    minZoom: 2,
    maxZoom: 18,
    mapTypeId: "roadmap",
    renderingType: maps.RenderingType.RASTER,
    backgroundColor: "#0b171c",
    disableDefaultUI: true,
    scaleControl: true,
    clickableIcons: false,
    gestureHandling: "greedy",
    styles: DARK_STYLE,
  });

  class HtmlLayer extends maps.OverlayView {
    constructor() {
      super();
      this.container = document.createElement("div");
      this.container.className = "html-layer";
      this.items = new Map();
    }
    onAdd() {
      this.getPanes().overlayMouseTarget.append(this.container);
    }
    onRemove() {
      this.container.remove();
    }
    place(item) {
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new maps.LatLng(item.lat, item.lon));
      item.node.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
    // Named put/drop: OverlayView inherits MVCObject#set, which setMap() relies on.
    put(id, node, lat, lon, z) {
      let item = this.items.get(id);
      if (!item) {
        item = { node };
        this.items.set(id, item);
        this.container.append(node);
      }
      Object.assign(item, { lat, lon });
      node.style.zIndex = z;
      this.place(item);
    }
    drop(id) {
      this.items.get(id)?.node.remove();
      this.items.delete(id);
    }
    draw() {
      for (const item of this.items.values()) this.place(item);
    }
  }

  const layer = new HtmlLayer();
  layer.setMap(map);
  const path = (points) => points.map((point) => ({ lat: point.lat, lng: point.lon }));
  const shapes = {
    pFill: new maps.Polygon({ map, visible: false, clickable: false, strokeOpacity: 0, fillColor: "#3fd8b0", fillOpacity: 0.05, zIndex: 1 }),
    pLine: new maps.Polyline({ map, visible: false, clickable: false, strokeOpacity: 0, icons: dashed("#3fd8b0", 1, 2.5, "11px"), zIndex: 3 }),
    s: new maps.Polygon({ map, visible: false, clickable: false, strokeColor: "#b39dff", strokeWeight: 3, strokeOpacity: 0.95, fillColor: "#b39dff", fillOpacity: 0.08, zIndex: 2 }),
    link: new maps.Polyline({ map, visible: false, clickable: false, geodesic: true, strokeOpacity: 0, icons: dashed("#e8eef0", 0.6, 1.5, "8px"), zIndex: 4 }),
    radius: new maps.Circle({ map, visible: false, clickable: false, strokeColor: "#5b7882", strokeOpacity: 0.5, strokeWeight: 1, fillOpacity: 0 }),
    accuracy: new maps.Circle({ map, visible: false, clickable: false, strokeColor: "#4c8dff", strokeOpacity: 0.6, strokeWeight: 1, fillColor: "#4c8dff", fillOpacity: 0.12 }),
  };

  const overlay = createOverlay(
    {
      set: (id, node, lat, lon, z) => layer.put(id, node, lat, lon, z),
      remove: (id) => layer.drop(id),
      waves(p, s) {
        if (p) {
          shapes.pFill.setPath(path(p));
          shapes.pLine.setPath(path(p));
        }
        shapes.pFill.setVisible(Boolean(p));
        shapes.pLine.setVisible(Boolean(p));
        if (s) shapes.s.setPath(path(s));
        shapes.s.setVisible(Boolean(s));
      },
      link(from, to) {
        if (from) shapes.link.setPath([{ lat: from.lat, lng: from.lon }, { lat: to.lat, lng: to.lon }]);
        shapes.link.setVisible(Boolean(from));
      },
      radius(center, km) {
        shapes.radius.setCenter({ lat: center.lat, lng: center.lon });
        shapes.radius.setRadius(km * 1000);
        shapes.radius.setVisible(true);
      },
      accuracy(center, meters) {
        if (meters) {
          shapes.accuracy.setCenter({ lat: center.lat, lng: center.lon });
          shapes.accuracy.setRadius(meters);
        }
        shapes.accuracy.setVisible(Boolean(meters));
      },
    },
    onSelect,
  );

  const fitPoints = (points, maxZoom) => {
    const bounds = new maps.LatLngBounds();
    points.forEach((point) => bounds.extend({ lat: point.lat, lng: point.lon }));
    map.fitBounds(bounds, mapPadding());
    maps.event.addListenerOnce(map, "idle", () => {
      if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
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
      if (!events.length) {
        map.setCenter({ lat: center.lat, lng: center.lon });
        map.setZoom(7);
        return;
      }
      fitPoints([...events, center], 8);
    },
    panTo(center) {
      map.panTo({ lat: center.lat, lng: center.lon });
      if (map.getZoom() < 8) map.setZoom(8);
    },
    zoomBy(delta) {
      map.setZoom(map.getZoom() + delta);
    },
    satellite(enabled) {
      map.setMapTypeId(enabled ? "hybrid" : "roadmap");
    },
  };
}
