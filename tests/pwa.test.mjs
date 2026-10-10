import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker(active, permission = 'granted') {
  const handlers = {}, notices = [], messages = [];
  let skipped = 0;
  const self = { registration: { active, showNotification: async (...args) => notices.push(args) },
    Notification: { permission }, clients: { matchAll: async () => [{ postMessage: message => messages.push(message) }] },
    skipWaiting: async () => { skipped++; }, addEventListener: (type, handler) => { handlers[type] = handler; } };
  vm.runInNewContext(source, { self, caches: { open: async () => ({ addAll: async () => {} }) } });
  const dispatch = async (type, data = {}) => { let task; handlers[type]({ ...data, waitUntil: value => { task = value; } }); await task; };
  return { dispatch, notices, messages, skipped: () => skipped };
}
test('first installation activates without a misleading release notification', async () => {
  const sw = worker(null);
  await sw.dispatch('install');
  assert.equal(sw.skipped(), 1);
  assert.equal(sw.notices.length, 0);
});
test('an update waits for acceptance, announces itself, and activates on click', async () => {
  const sw = worker({});
  await sw.dispatch('install');
  assert.equal(sw.skipped(), 0);
  assert.equal(sw.notices[0][1].data.type, 'app-update');
  assert.equal(sw.messages[0].type, 'update-ready');
  await sw.dispatch('message', { data: { type: 'apply-update' } });
  assert.equal(sw.skipped(), 1);
});
test('an update still offers the in-app control without notification permission', async () => {
  const sw = worker({}, 'denied');
  await sw.dispatch('install');
  assert.equal(sw.notices.length, 0);
  assert.equal(sw.messages.length, 1);
  assert.equal(sw.skipped(), 0);
});

import { runReleaseCheck } from '../sources/push.mjs';
test('release push seeds once, retries failures, and does not repeat successful recipients', async () => {
  let release = null;
  const receipts = new Set();
  const delivered = [];
  const store = { getRelease: async () => release, saveRelease: async value => { release = value; },
    subscriptions: async () => [{ key: 'a', subscription: 'a' }, { key: 'b', subscription: 'b' }],
    claimDelivery: async (id, key) => { const receipt = `${id}:${key}`; if (receipts.has(receipt)) return false; receipts.add(receipt); return true; },
    releaseDelivery: async (id, key) => receipts.delete(`${id}:${key}`) };
  let fail = true;
  const send = async (subscriber, message) => { if (subscriber === 'b' && fail) throw new Error('temporary'); delivered.push([subscriber, message.type]); };
  await runReleaseCheck({ store, send, release: 'one' });
  assert.equal(delivered.length, 0);
  assert.equal((await runReleaseCheck({ store, send, release: 'two' })).failed, 1);
  fail = false;
  await runReleaseCheck({ store, send, release: 'two' });
  await runReleaseCheck({ store, send, release: 'two' });
  assert.deepEqual(delivered, [['a', 'app-update'], ['b', 'app-update']]);
  assert.equal(release, 'two');
});
