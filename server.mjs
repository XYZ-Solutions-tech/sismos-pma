import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadCatalogs } from './sources/catalogs.mjs';

const root = new URL('./', import.meta.url);
const port = Number(process.env.SISMOS_PORT || 8787);
const routes = new Map([
  ['/', ['public/index.html', 'text/html']],
  ...['entry.js', 'updates.js', 'geoshake.js', 'styles.css', 'app.js', 'domain.js', 'data.js', 'map.js', 'leaflet-map.js', 'google-map.js', 'waves.js', 'overlay.js', 'notify.js', 'sw.js'].map(name => [`/${name}`, [`public/${name}`, name.endsWith('.css') ? 'text/css' : 'text/javascript']]),
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ...['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].map(name => [`/${name}`, [`public/${name}`, 'image/png']]),
  ['/leaflet.js', ['node_modules/leaflet/dist/leaflet.js', 'text/javascript']],
  ['/leaflet.css', ['node_modules/leaflet/dist/leaflet.css', 'text/css']],
]);
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const nonce = randomBytes(18).toString('base64');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https://maps.googleapis.com https://maps.gstatic.com 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://server.arcgisonline.com https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:; font-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:; manifest-src 'self'; frame-src https://*.google.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return json(res, 403, { error: 'Solo acceso local' });
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Método no permitido' });
  try {
    const pathname = new URL(req.url, `http://localhost:${port}`).pathname;
    if (pathname === '/api/health') return json(res, 200, { app: 'sismos-local' });
    if (pathname === '/api/map-config') {
      let googleMapsKey = process.env.SISMOS_GOOGLE_MAPS_KEY || null;
      if (!googleMapsKey) {
        try { googleMapsKey = JSON.parse(await readFile(new URL('.runtime/google-maps.json', root), 'utf8')).googleMapsKey || null; } catch { /* Google is optional until configured. */ }
      }
      return json(res, 200, { googleMapsKey });
    }
    if (pathname === '/api/geoshake-live') {
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const upstream = await fetch('https://api.geoshake.org/api/live', { signal: controller.signal });
      if (!upstream.ok || !upstream.body) return json(res, 502, { error: 'GeoShake no disponible' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' });
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => res.end());
      stream.pipe(res);
      return;
    }
    if (pathname === '/api/earthquakes') {
      return json(res, 200, await loadCatalogs());
    }
    const route = routes.get(pathname);
    if (!route) return json(res, 404, { error: 'No encontrado' });
    const bytes = await readFile(new URL(route[0], root));
    const body = route[1] === 'text/html' ? bytes.toString().replace(/<script\b/g, `<script nonce="${nonce}"`) : bytes;
    res.writeHead(200, { 'Content-Type': route[1].startsWith('image/') ? route[1] : `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(error.message);
    json(res, 500, { error: 'No se pudo cargar el panel.' });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Sismos local: http://localhost:${port} (${fileURLToPath(root)})`));
