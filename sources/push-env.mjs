import { Redis } from '@upstash/redis';
import webpush from 'web-push';
import { createRedisStore } from './push.mjs';

// Shared by the push functions; the store keeps its seen-record cache per instance.
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
const redisConfigured = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
export const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && redisConfigured);
export const publicKey = pushConfigured ? VAPID_PUBLIC_KEY : null;
export const store = pushConfigured ? createRedisStore(Redis.fromEnv()) : null;

const vapidDetails = { subject: 'https://sismos-pma.xyzsolutions.tech', publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
export const sendPush = (subscription, message, options = {}) =>
  webpush.sendNotification(subscription, JSON.stringify(message), { TTL: 3600, urgency: 'high', ...options, vapidDetails });
