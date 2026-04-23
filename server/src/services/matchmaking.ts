// ============================================================
// MATCHMAKING — Queue management and room creation helpers
// ============================================================

import { redis, KEYS, CHANNELS } from '../lib/redis';
import { config } from '../lib/config';
import { createRoom, joinRoom, getRoom } from './room-manager';
import type { GameType, Room } from '@bored-games/shared';

// Queue TTL: 5 minutes (player will be auto-removed)
const QUEUE_TTL_SECS = 300;

// ----- Quick-play queue -----

/**
 * Add a player to the matchmaking queue for a game type.
 */
export async function addToQueue(
  gameType: GameType,
  sessionId: string
): Promise<{ position: number }> {
  const key = KEYS.queue(gameType);
  const timestamp = Date.now();

  // Score = timestamp for FIFO ordering
  await redis.zadd(key, timestamp, sessionId);
  await redis.expire(key, QUEUE_TTL_SECS);

  const position = await redis.zrank(key, sessionId);
  return { position: (position ?? 0) + 1 };
}

/**
 * Remove a player from the matchmaking queue.
 */
export async function removeFromQueue(
  gameType: GameType,
  sessionId: string
): Promise<void> {
  await redis.zrem(KEYS.queue(gameType), sessionId);
}

/**
 * Check if a session is currently in any queue.
 * Returns the game type if found, null otherwise.
 */
export async function getQueuePosition(
  gameType: GameType,
  sessionId: string
): Promise<number | null> {
  const key = KEYS.queue(gameType);
  const rank = await redis.zrank(key, sessionId);
  return rank ?? null;
}

/**
 * Process the matchmaking queue for a game type.
 * If 2+ players are waiting, create a room and notify them.
 * This should be called periodically (e.g., every 2 seconds).
 */
export async function processQueue(gameType: GameType): Promise<void> {
  const key = KEYS.queue(gameType);
  const engine = { minPlayers: 2, maxPlayers: 2 } as const; // TODO: pull from engine

  // Get the first N players from the queue
  const players = await redis.zrange(key, 0, engine.minPlayers - 1); // -2 because we need at least 2

  if (players.length < engine.minPlayers) {
    return; // Not enough players
  }

  // Try to create a room with these players
  // Use the first player as the host
  const hostSessionId = players[0]!;

  try {
    const room = await createRoom(gameType, hostSessionId);

    // Add remaining players to the room
    for (let i = 1; i < players.length; i++) {
      try {
        await joinRoom(room.code, players[i]!);
      } catch {
        // Player might have left queue or joined elsewhere — skip
        await removeFromQueue(gameType, players[i]!);
      }
    }

    // Remove all matched players from the queue
    await redis.zrem(key, ...players);

    // Notify matched players via Redis pub/sub
    await redis.publish(
      CHANNELS.globalEvents,
      JSON.stringify({
        type: 'QUEUE_MATCHED',
        roomCode: room.code,
        matchedSessionIds: players,
      })
    );

    if (process.env.NODE_ENV === 'development') {
      console.log(`🎮 Queue match: ${gameType} — room ${room.code} created`);
    }
  } catch (err) {
    console.error('Queue processing error:', err);
    // Remove any added players from queue on error
    await redis.zrem(key, ...players);
  }
}

// ----- Room + quick join (single call) -----

/**
 * Create a room and return the code (for lobby flow).
 */
export async function createAndReturnCode(
  gameType: GameType,
  sessionId: string
): Promise<{ roomCode: string }> {
  const room = await createRoom(gameType, sessionId);
  return { roomCode: room.code };
}

/**
 * Join a room by code (wrapper around room-manager).
 */
export async function joinByCode(
  code: string,
  sessionId: string
): Promise<Room> {
  const { room } = await joinRoom(code, sessionId);
  return room;
}
