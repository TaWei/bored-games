// ============================================================
// SERVER CONFIG — validated environment variables
// ============================================================

import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/bored_games'),
  /** How long before an idle room is automatically cleaned up (ms) */
  ROOM_TTL_MS: z.string().default('1800000').transform(Number), // 30 min
  /** How long to wait for a disconnected player before forfeiting (ms) */
  RECONNECT_WINDOW_MS: z.string().default('60000').transform(Number), // 60 sec
  /** Heartbeat interval (ms) */
  HEARTBEAT_INTERVAL_MS: z.string().default('10000').transform(Number), // 10 sec
  /** Max moves per minute per session */
  MOVE_RATE_LIMIT: z.string().default('30').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = parsed.data;

export const {
  PORT,
  NODE_ENV,
  REDIS_URL,
  DATABASE_URL,
  ROOM_TTL_MS,
  RECONNECT_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  MOVE_RATE_LIMIT,
} = config;

export const isProduction = NODE_ENV === 'production';
export const isDevelopment = NODE_ENV === 'development';
