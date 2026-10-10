import { DurableObject } from 'cloudflare:workers';
import { GEOSHAKE_URL, createSSEParser, geoShakeFeature } from '../../public/geoshake.js';

// A single durable receiver, independent of browser tabs. Rotate sessions below the
// 15-minute alarm wall-time limit; alarms reconnect after restarts and outages.
export class GeoShakeStream extends DurableObject {
  async start() {
    if (!this.running && await this.ctx.storage.getAlarm() === null)
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    return { running: Boolean(this.running), ...await this.ctx.storage.get('health') };
  }

  async enqueue(raw) {
    if (!geoShakeFeature(raw) || raw.originMs < Date.now() - 300_000 || raw.originMs > Date.now() + 10_000) return;
    // Keep the small event contract; ignore station waveforms and untrusted extra fields.
    const event = { event_id: raw.event_id, originMs: raw.originMs, lat: raw.lat, lon: raw.lon,
      nStations: raw.nStations, stage: raw.stage, official: { magnitude: raw.official?.magnitude } };
    await this.ctx.storage.put(`pending:${raw.event_id}`, event);
  }

  async flush() {
    const queue = await this.ctx.storage.list({ prefix: 'pending:', limit: 50 });
    for (const [key, event] of queue) {
      if (event.originMs < Date.now() - 300_000) { await this.ctx.storage.delete(key); continue; }
      const response = await fetch(this.env.GEOSHAKE_INGEST_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${this.env.CRON_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event), signal: AbortSignal.timeout(15_000),
      });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`GeoShake ingest HTTP ${response.status}`);
      await this.ctx.storage.delete(key);
      console.log(`GeoShake event ${event.event_id} forwarded`);
    }
  }

  async alarm() {
    this.running = true;
    let delay = 1000;
    const controller = new AbortController();
    const rotate = setTimeout(() => controller.abort(), 240_000);
    try {
      await this.flush();
      const response = await fetch(`${GEOSHAKE_URL}/api/live`, { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
        throw new Error(`GeoShake SSE HTTP ${response.status}`);
      await this.ctx.storage.put('health', { connectedAt: Date.now(), error: null });
      console.log('GeoShake SSE connected');
      // Reconcile the latest confirmed events after any reconnect. Old events never notify.
      const snapshot = await fetch(`${GEOSHAKE_URL}/api/events`, { signal: AbortSignal.timeout(10_000) });
      if (!snapshot.ok) throw new Error(`GeoShake snapshot HTTP ${snapshot.status}`);
      const events = await snapshot.json();
      if (!Array.isArray(events)) throw new Error('GeoShake snapshot invalid');
      for (const event of events.slice(0, 50)) await this.enqueue(event);
      await this.flush();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const batch = [];
      const parse = createSSEParser(data => {
        try { const message = JSON.parse(data); if (message?.type === 'event') batch.push(message.payload); } catch { /* Ignore malformed frames. */ }
      });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          parse(decoder.decode(value, { stream: true }));
          if (batch.length) {
            for (const event of batch.splice(0)) await this.enqueue(event);
            await this.flush();
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (!controller.signal.aborted) {
        delay = 10_000;
        await this.ctx.storage.put('health', { error: error.message, failedAt: Date.now() });
        console.error(error.message);
      }
    } finally {
      clearTimeout(rotate);
      controller.abort();
      this.running = false;
      await this.ctx.storage.setAlarm(Date.now() + delay);
    }
  }
}
