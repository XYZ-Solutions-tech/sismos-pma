export function setupUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let applying = false;
  let registration;
  const banner = document.getElementById('app-update');
  const offer = () => { banner.hidden = !registration?.waiting; };
  document.getElementById('open-update').addEventListener('click', () => {
    if (!registration?.waiting) return location.reload();
    applying = true;
    document.getElementById('open-update').disabled = true;
    registration.waiting.postMessage({ type: 'apply-update' });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'update-ready') offer();
    if (event.data?.type === 'apply-update') {
      applying = true;
      if (registration?.waiting) registration.waiting.postMessage({ type: 'apply-update' });
      else location.reload();
    }
  });
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(value => {
    registration = value;
    offer();
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => { if (installing.state === 'installed') offer(); });
    });
    const check = () => registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(() => { if (!document.hidden) check(); }, 60_000);
    check();
  }).catch(() => {});
}
