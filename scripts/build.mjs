// Static output for Vercel: the panel files plus Leaflet, which the local server reads from node_modules.
import { cp, rm, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await cp(new URL('public/', root), dist, { recursive: true });
for (const file of ['leaflet.js', 'leaflet.css']) await cp(new URL(`node_modules/leaflet/dist/${file}`, root), new URL(file, dist));
// Vercel Web Analytics `inject()` as a browser module (the panel has no bundler).
await cp(new URL('node_modules/@vercel/analytics/dist/index.mjs', root), new URL('vendor/vercel-analytics.js', dist));

// Stamp every production release into the worker so the browser detects each deploy.
const release = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || new Date().toISOString();
const workerPath = new URL('sw.js', dist);
await writeFile(workerPath, (await readFile(workerPath, 'utf8')).replace('__RELEASE__', release.replace(/[^a-zA-Z0-9_.:-]/g, '')));
