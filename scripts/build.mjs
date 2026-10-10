// Static output for Vercel: the panel files plus Leaflet, which the local server reads from node_modules.
import { cp, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await cp(new URL('public/', root), dist, { recursive: true });
for (const file of ['leaflet.js', 'leaflet.css']) await cp(new URL(`node_modules/leaflet/dist/${file}`, root), new URL(file, dist));
// Vercel Web Analytics `inject()` as a browser module (the panel has no bundler).
await cp(new URL('node_modules/@vercel/analytics/dist/index.mjs', root), new URL('vendor/vercel-analytics.js', dist));
