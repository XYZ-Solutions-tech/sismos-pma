import { GEOSHAKE_URL } from '../public/geoshake.js';

// Same-origin proxy: the upstream SSE does not advertise cross-origin access.
// Rotate before the function duration limit; EventSource reconnects automatically.
export const maxDuration = 300;
export async function GET() {
  const upstream = await fetch(`${GEOSHAKE_URL}/api/live`, {
    headers: { Accept: 'text/event-stream' }, signal: AbortSignal.timeout(240_000),
  });
  if (!upstream.ok || !upstream.body) return new Response('GeoShake no disponible', { status: 502 });
  return new Response(upstream.body, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
