import { loadCatalogs } from '../sources/catalogs.mjs';

// Every open panel polls this endpoint. The CDN shares one response per region
// for a few seconds; the module cache in catalogs.mjs limits upstream requests.
export async function GET() {
  return Response.json(await loadCatalogs(), {
    headers: { 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'max-age=15' },
  });
}
