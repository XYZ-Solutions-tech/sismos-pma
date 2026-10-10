// Triggers the panel's Web Push check every minute: Vercel Hobby cron jobs run once a day.
// CRON_SECRET is a Worker secret with the same value as the Vercel environment variable.
export default {
  async scheduled(controller, env) {
    const response = await fetch(env.CHECK_URL, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`push-check HTTP ${response.status}: ${body.slice(0, 200)}`);
    console.log(body);
  },
};
