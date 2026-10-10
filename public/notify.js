import { SOURCE_LABELS, displayPlace } from './domain.js';

// Local notifications only: there is no push server. Each catalog check of an
// open panel (or one the browser still runs in the background) may show one.
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const worker = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null);
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const clock = new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false });
const magText = mag => mag === null ? '—' : mag.toFixed(1);

// beforeinstallprompt can fire while app.js is still awaiting the map, so capture it on import.
let installPrompt = null;
let onInstallChange = () => {};
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; onInstallChange(true); });
addEventListener('appinstalled', () => { installPrompt = null; onInstallChange(false); });

export function watchInstall(callback) {
  onInstallChange = callback;
  callback(Boolean(installPrompt));
}

export async function promptInstall() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  onInstallChange(false);
  await prompt.prompt();
}

// 'granted' | 'default' | 'denied', or 'install' (iOS only allows them in the home screen app) | 'unsupported'.
export function notificationPermission() {
  if (!('Notification' in window)) return iOS && !standalone ? 'install' : 'unsupported';
  return Notification.permission;
}

export async function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  return notificationPermission();
}

export async function showNotification(title, body, data = {}) {
  if (notificationPermission() !== 'granted') return;
  const options = { body, data, icon: '/icon-192.png', lang: 'es' };
  try {
    // Android only shows notifications through the service worker.
    const registration = await worker;
    if (registration) await registration.showNotification(title, options);
    else new Notification(title, options);
  } catch { /* Blocked by the browser or the operating system. */ }
}

// `events` come from filterEvents (with `distance`); one notification per check.
export function notifyNewRecords(events, fromWhere) {
  if (!events.length) return;
  const top = events.reduce((best, e) => ((e.mag ?? -Infinity) > (best.mag ?? -Infinity) ? e : best));
  const place = displayPlace(top.place).title;
  const where = `${num.format(top.distance)} km ${fromWhere}`;
  if (events.length === 1) {
    return showNotification(`Sismo M ${magText(top.mag)} · ${SOURCE_LABELS[top.source]}`, `${place}\n${where} · ${clock.format(top.time)} (hora de Panamá)`, { id: top.id });
  }
  return showNotification(`${events.length} nuevos registros en tu zona`, `Mayor: M ${magText(top.mag)} · ${place}\n${where} · ${SOURCE_LABELS[top.source]}`, { id: top.id });
}

// A tapped notification focuses the panel and selects its event.
export function onNotificationSelect(handler) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'select-event') handler(event.data.id); });
  navigator.serviceWorker.startMessages();
}
