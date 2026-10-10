import { timingSafeEqual } from 'node:crypto';
import { loadCatalogs } from '../sources/catalogs.mjs';
import { runPushCheck, runReleaseCheck } from '../sources/push.mjs';
import { pushConfigured, store, sendPush } from '../sources/push-env.mjs';

// Called every minute by the Cloudflare Worker in cron-worker/ (Vercel Hobby cron jobs are daily).
// CRON_SECRET is also what a Vercel cron job would send, so it can move there unchanged.
function authorized(request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET ?? ''}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return Boolean(process.env.CRON_SECRET) && expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: 'No autorizado' }, { status: 401 });
  if (!pushConfigured) return Response.json({ error: 'Avisos push no configurados' }, { status: 503 });
  const updates = await runReleaseCheck({ store, send: sendPush, release: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA });
  const result = await runPushCheck({ store, loadCatalogs, send: sendPush });
  return Response.json({ ...result, updates }, { headers: { 'Cache-Control': 'no-store' } });
}
