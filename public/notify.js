import { newRecordsMessage } from './domain.js';

// Local notifications come from the open panel after each catalog check. Web Push
// (api/push-check.js, every minute) covers the panel closed; both use the same tag,
// so a push for a record already announced locally replaces it silently.
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const worker = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null);

// beforeinstallprompt can fire while app.js is still awaiting the map, so capture it on import.
let installPrompt = null;
let onInstallChange = () => {};
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; onInstallChange(true); });
addEventListener('appinstalled', () => { standalone = true; installPrompt = null; try { localStorage.setItem('sismos-installed', '1'); } catch {} onInstallChange(false); });

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
  if (iOS && !standalone) return 'install';
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
export function notifyNewRecords(events, fromWhere, jump = null) {
  if (!events.length) return;
  const { title, body, id, tag } = newRecordsMessage(events, fromWhere, jump || null);
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

// First-visit setup. Dismissing is remembered for this visit only; completed steps stay hidden.
export function welcomeSetup({ enabled, activate, ready = () => true }) {
  const dialog = document.getElementById('welcome');
  const install = document.getElementById('welcome-install');
  const notify = document.getElementById('welcome-notify');
  const installText = document.getElementById('welcome-install-text');
  const notifyText = document.getElementById('welcome-notify-text');
  let dismissed = false;
  let busy = false;
  const installed = () => {
    try { return standalone || localStorage.getItem('sismos-installed') === '1'; } catch { return standalone; }
  };
  function update() {
    const permission = notificationPermission();
    const needsInstall = !installed();
    const needsNotify = !(enabled() && permission === 'granted');
    document.getElementById('welcome-install-step').hidden = !needsInstall;
    document.getElementById('welcome-notify-step').hidden = !needsNotify;
    install.textContent = installPrompt ? 'Instalar app' : 'Cómo instalar';
    installText.textContent = iOS ? 'Toca Compartir → Agregar a pantalla de inicio. Después abre Sismos PMA desde su ícono.'
      : 'Instálala para abrir Sismos PMA desde su propio ícono. También puedes buscar «Instalar app» en el menú del navegador.';
    notify.disabled = !ready() || busy || ['install', 'denied', 'unsupported'].includes(permission);
    notify.textContent = busy ? 'Activando…' : 'Activar avisos';
    notifyText.textContent = permission === 'install' ? 'Primero instala la app y ábrela desde la pantalla de inicio para permitir los avisos.'
      : permission === 'denied' ? 'Los avisos están bloqueados. Permítelos en los ajustes de este sitio en tu navegador.'
      : permission === 'unsupported' ? 'Este navegador no admite avisos. Prueba con Safari, Chrome o Edge.'
      : 'Recibe nuevos sismos según tus filtros, incluso con la app cerrada. Te pediremos permiso al tocar el botón.';
    if (!needsInstall && !needsNotify) { if (dialog.open) dialog.close(); }
    else if (!dismissed && !dialog.open) dialog.showModal();
  }
  watchInstall(available => { document.getElementById('install').hidden = !available; update(); });
  install.addEventListener('click', async () => {
    if (installPrompt) { await promptInstall(); update(); }
    else { installText.focus(); }
  });
  notify.addEventListener('click', async () => {
    if (enabled() && notificationPermission() === 'granted') return;
    busy = true;
    // activate() calls requestPermission synchronously from this click, before its first await.
    const task = activate();
    update();
    try { await task; } finally { busy = false; update(); }
  });
  document.getElementById('welcome-later').addEventListener('click', () => { dismissed = true; dialog.close(); });
  dialog.addEventListener('cancel', () => { dismissed = true; });
  return update;
}
