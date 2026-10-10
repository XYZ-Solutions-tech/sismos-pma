import { setupUpdates } from './updates.js';
import { watchInstall, promptInstall } from './notify.js';

setupUpdates();
const displayMode = matchMedia('(display-mode: standalone)');
const installed = () => displayMode.matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
let started = false;
async function openApp() {
  if (!installed() || started) return;
  started = true;
  document.getElementById('installation').hidden = true;
  document.querySelector('.workspace').hidden = false;
  await import('./app.js');
}
watchInstall(available => { document.getElementById('landing-install').hidden = !available; });
document.getElementById('landing-install').addEventListener('click', promptInstall);
addEventListener('appinstalled', () => { document.getElementById('landing-installed').hidden = false; });
displayMode.addEventListener('change', openApp);
await openApp();
