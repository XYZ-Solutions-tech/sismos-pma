import { newRecordsMessage } from './domain.js';

// Local notifications come from the open panel after each catalog check. Web Push
// (api/push-check.js, every minute) covers the panel closed; both use the same tag,
// so a push for a record already announced locally replaces it silently.
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const worker = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null);

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

export async function showNotification(title, body, data = {}, tag) {
  if (notificationPermission() !== 'granted') return;
  const options = { body, data, tag, icon: '/icon-192.png', lang: 'es' };
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
  const { title, body, id, tag } = newRecordsMessage(events, fromWhere);
  return showNotification(title, body, { id }, tag);
}

// ——— Web Push: the server stores the subscription with the panel's filters ———

const keyBytes = key => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sameKey = (buffer, bytes) => Boolean(buffer) && new Uint8Array(buffer).every((byte, index) => byte === bytes[index]) && buffer.byteLength === bytes.length;

async function savePush(subscription, filters) {
  const response = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription, filters }) });
  return response.ok;
}

// True when this browser now receives avisos with the panel closed. `filters` is read
// right before saving, so a location found meanwhile is not overwritten.
export async function enablePush(filters) {
  const registration = await worker;
  if (!registration?.pushManager || notificationPermission() !== 'granted') return false;
  try {
    const { publicKey } = await (await fetch('/api/push', { cache: 'no-store' })).json();
    if (!publicKey) return false;
    const key = keyBytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) { await subscription.unsubscribe(); subscription = null; }
    // Some browsers never answer when their push service is off (e.g. Brave by default): give up after 15 s.
    subscription ??= await Promise.race([registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Servicio push sin respuesta')), 15_000))]);
    return await savePush(subscription, filters());
  } catch { return false; }
}

export async function updatePushFilters(filters) {
  const subscription = await (await worker)?.pushManager?.getSubscription().catch(() => null);
  if (subscription) await savePush(subscription, filters).catch(() => {});
}

export async function disablePush() {
  const subscription = await (await worker)?.pushManager?.getSubscription().catch(() => null);
  if (!subscription) return;
  await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}

// A tapped notification focuses the panel and selects its event.
export function onNotificationSelect(handler) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'select-event') handler(event.data.id); });
  navigator.serviceWorker.startMessages();
}
