import { pushConfigured, publicKey, store } from '../sources/push-env.mjs';
import { parseSubscription, subscriptionKey } from '../sources/push.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const sameOrigin = request => request.headers.get('origin') === new URL(request.url).origin;

// Web Push key for the panel; null when push is not configured (e.g. local server).
export function GET() {
  return json({ publicKey });
}

// Subscribe or update filters. The service worker sends oldEndpoint when the browser rotates a subscription.
export async function POST(request) {
  if (!pushConfigured) return json({ error: 'Avisos push no disponibles' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Origen no permitido' }, 403);
  const body = await request.json().catch(() => null);
  const oldKey = typeof body?.oldEndpoint === 'string' ? subscriptionKey(body.oldEndpoint) : null;
  const previous = oldKey ? await store.getSubscription(oldKey) : null;
  const record = parseSubscription(body, previous?.filters);
  if (!record) return json({ error: 'Suscripción no válida' }, 400);
  if (!await store.saveSubscription(subscriptionKey(record.subscription.endpoint), record)) return json({ error: 'Límite de suscripciones alcanzado' }, 503);
  if (oldKey && oldKey !== subscriptionKey(record.subscription.endpoint)) await store.removeSubscription(oldKey);
  return new Response(null, { status: 204 });
}

export async function DELETE(request) {
  if (!pushConfigured) return json({ error: 'Avisos push no disponibles' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Origen no permitido' }, 403);
  const body = await request.json().catch(() => null);
  if (typeof body?.endpoint !== 'string') return json({ error: 'Falta la suscripción' }, 400);
  await store.removeSubscription(subscriptionKey(body.endpoint));
  return new Response(null, { status: 204 });
}
