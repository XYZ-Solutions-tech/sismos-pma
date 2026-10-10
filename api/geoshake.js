import { timingSafeEqual } from 'node:crypto';
import { pushConfigured, store, sendPush } from '../sources/push-env.mjs';
import { sendGeoShakeEvent } from '../sources/geoshake.mjs';

export async function POST(request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET ?? ''}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (!process.env.CRON_SECRET || expected.length !== received.length || !timingSafeEqual(expected, received))
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  if (!pushConfigured) return Response.json({ error: 'Push no configurado' }, { status: 503 });
  const text = await request.text();
  if (text.length > 16384) return Response.json({ error: 'Evento demasiado grande' }, { status: 413 });
  let raw;
  try { raw = JSON.parse(text); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }
  let result;
  try { result = await sendGeoShakeEvent(raw, { store, send: sendPush }); }
  catch (error) { if (error.message === 'Evento GeoShake inválido') return Response.json({ error: error.message }, { status: 400 }); throw error; }
  return Response.json(result, { status: result.failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
