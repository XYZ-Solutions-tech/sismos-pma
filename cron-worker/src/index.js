export { GeoShakeStream } from './geoshake-stream.js';

// Triggers the panel's Web Push check every minute: Vercel Hobby cron jobs run once a day.
// CRON_SECRET is a Worker secret with the same value as the Vercel environment variable.
export default {
  async fetch(request, env) {
    // Operational status only; never accept public event injection.
    if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`)
      return new Response('No autorizado', { status: 401 });
    return Response.json(await env.GEOSHAKE_STREAM.getByName('receiver').start());
  },
  async scheduled(controller, env) {
    const health = await env.GEOSHAKE_STREAM.getByName('receiver').start();
    console.log(JSON.stringify({ geoshake: health }));
    const response = await fetch(env.CHECK_URL, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`push-check HTTP ${response.status}: ${body.slice(0, 200)}`);
    console.log(body);
  },
};
