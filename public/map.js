import { createLeafletMap } from "./leaflet-map.js";

export async function createEarthquakeMap(onSelect) {
  let config;
  let rejected = false;
  try { rejected = sessionStorage.getItem("sismos-google-rejected") === "1"; } catch { /* Storage may be disabled. */ }
  try {
    const response = await fetch("/api/map-config", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) config = await response.json();
    if (config?.googleMapsKey && !rejected) {
      const { createGoogleMap } = await import("./google-map.js");
      const map = await createGoogleMap(onSelect, config.googleMapsKey);
      document.getElementById("map-provider").textContent = "Google Maps";
      return map;
    }
  } catch (cause) {
    console.warn("Google Maps no disponible:", cause);
    const error = document.getElementById("map-error");
    error.textContent =
      "No se pudo cargar Google Maps. El mapa alternativo conserva los puntos y los datos.";
    error.hidden = false;
  }
  document.getElementById("map-provider").textContent = rejected
    ? "Mapa alternativo · Google rechazó la clave en este dominio"
    : config?.googleMapsKey
    ? "Mapa alternativo · Google no disponible"
    : "Mapa alternativo · Google pendiente de configurar";
  return createLeafletMap(onSelect);
}
