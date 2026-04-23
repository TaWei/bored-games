// ============================================================
// REDIS CLIENT — ioredis setup with pub/sub support
// ============================================================

import Redis from 'ioredis';
import { REDIS_URL, isDevelopment } from './config';

// Main client for general operations
export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    if (times > 3) {
      console.error('Redis: max retries exceeded, giving up');
      return null;
    }
    return Math.min(times * 200, 2000);
  },
});

// Dedicated subscriber client for Pub/Sub
// Note: ioredis uses separate connections for subscribing
export const redisSub = new Redis(REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
});

redis.on('connect', () => {
  if (isDevelopment) console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});

redisSub.on('connect', () => {
  if (isDevelopment) console.log('✅ Redis subscriber connected');
});

redisSub.on('error', (err) => {
  console.error('❌ Redis subscriber error:', err.message);
});

// Connect on module load
(async () => {
  try {
    await redis.connect();
    await redisSub.connect();
  } catch (err) {
    console.warn('⚠️  Redis connection failed — some features may be unavailable');
    console.warn('   Run: docker-compose up -d');
  }
})();

// ----- Redis key helpers -----

export const KEYS = {
  room: (code: string) => `room:${code}`,
  roomPlayers: (code: string) => `room:${code}:players`,
  roomSpectators: (code: string) => `room:${code}:spectators`,
  roomState: (code: string) => `room:${code}:state`,
  roomGameLoop: (code: string) => `room:${code}:gameloop`,
  session: (sessionId: string) => `session:${sessionId}`,
  queue: (gameType: string) => `queue:${gameType}`,
  rateLimit: (sessionId: string, action: string) =>
    `ratelimit:${action}:${sessionId}`,
} as const;

// ----- Pub/Sub channels -----

export const CHANNELS = {
  roomEvents: (roomCode: string) => `room:${roomCode}:events`,
  gameEvents: (roomCode: string) => `game:${roomCode}:events`,
  globalEvents: 'global:events',
} as const;
