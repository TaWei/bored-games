// ============================================================
// ROOM MANAGER — Redis-backed room lifecycle
// TTL-based cleanup, player slots, state management
// ============================================================

import { redis, KEYS, CHANNELS } from '../lib/redis';
import { config, ROOM_TTL_MS } from '../lib/config';
import { generateRoomCode, isValidRoomCode, generateDisplayName, isValidDisplayName, sanitizeDisplayName } from '@bored-games/shared';
import type {
  Room,
  RoomStatus,
  Player,
  Spectator,
  GameType,
  GameState,
} from '@bored-games/shared';
import { getEngine } from '@bored-games/shared/games';

// ----- Errors -----

export class RoomError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

// ----- Room creation -----

/**
 * Create a new room for a given game type.
 * Generates a unique room code, registers in Redis.
 */
export async function createRoom(
  gameType: GameType,
  hostSessionId: string,
  displayName?: string
): Promise<Room> {
  // Validate game type
  const engine = getEngine(gameType);

  // Generate unique code (retry on collision, rare)
  let code: string = generateRoomCode();
  for (let attempt = 1; attempt < 10; attempt++) {
    const exists = await redis.exists(KEYS.room(code));
    if (!exists) break;
    code = generateRoomCode();
  }

  const name = sanitizeDisplayName(displayName ?? generateDisplayName());

  const room: Room = {
    code,
    gameType,
    hostSessionId,
    status: 'waiting',
    players: [
      {
        sessionId: hostSessionId,
        displayName: name,
        symbol: engine.minPlayers === 2 ? 'X' : '1', // first player gets X
        joinedAt: Date.now(),
      },
    ],
    spectators: [],
    createdAt: Date.now(),
    maxPlayers: engine.maxPlayers,
    rematchRequests: [],
  };

  // Store room metadata
  await redis.set(KEYS.room(code), JSON.stringify(room), 'PX', ROOM_TTL_MS);

  return room;
}

// ----- Join room -----

/**
 * Add a player to an existing room.
 * Returns the updated room.
 * Throws RoomError if room not found or full.
 */
export async function joinRoom(
  code: string,
  sessionId: string,
  displayName?: string
): Promise<{ room: Room; symbol: string }> {
  if (!isValidRoomCode(code)) {
    throw new RoomError('Invalid room code format.', 'INVALID_CODE');
  }

  const raw = await redis.get(KEYS.room(code));
  if (!raw) {
    throw new RoomError('Room not found. Check the code and try again.', 'ROOM_NOT_FOUND', 404);
  }

  const room: Room = JSON.parse(raw);

  // Check if already in room (handles reconnect after game started)
  if (room.players.some((p) => p.sessionId === sessionId)) {
    // Player already in room — return current room (even if game in progress)
    return { room, symbol: room.players.find((p) => p.sessionId === sessionId)!.symbol };
  }

  if (room.status !== 'waiting') {
    throw new RoomError('This game has already started.', 'GAME_IN_PROGRESS', 400);
  }

  if (room.players.length >= room.maxPlayers) {
    throw new RoomError('Room is full.', 'ROOM_FULL', 400);
  }

  const engine = getEngine(room.gameType);
  const symbol = room.players.length === 0 ? 'X' : 'O';
  const name = sanitizeDisplayName(displayName ?? generateDisplayName());

  const player: Player = {
    sessionId,
    displayName: name,
    symbol,
    joinedAt: Date.now(),
  };

  room.players.push(player);

  // If room is now full, start the game
  if (room.players.length >= room.maxPlayers) {
    room.status = 'in_progress';
  }

  await redis.set(KEYS.room(code), JSON.stringify(room), 'PX', ROOM_TTL_MS);

  // Notify other players via pub/sub
  await redis.publish(
    CHANNELS.roomEvents(code),
    JSON.stringify({ type: 'PLAYER_JOINED', player })
  );

  return { room, symbol };
}

// ----- Join as spectator -----

export async function joinAsSpectator(
  code: string,
  sessionId: string,
  displayName?: string
): Promise<Room> {
  if (!isValidRoomCode(code)) {
    throw new RoomError('Invalid room code format.', 'INVALID_CODE');
  }

  const raw = await redis.get(KEYS.room(code));
  if (!raw) {
    throw new RoomError('Room not found.', 'ROOM_NOT_FOUND', 404);
  }

  const room: Room = JSON.parse(raw);

  if (room.spectators.some((s) => s.sessionId === sessionId)) {
    return room; // already spectating
  }

  room.spectators.push({
    sessionId,
    displayName: sanitizeDisplayName(displayName ?? 'Spectator'),
    joinedAt: Date.now(),
  });

  await redis.set(KEYS.room(code), JSON.stringify(room), 'PX', ROOM_TTL_MS);

  await redis.publish(
    CHANNELS.roomEvents(code),
    JSON.stringify({ type: 'SPECTATOR_JOINED', spectator: { sessionId, displayName } })
  );

  return room;
}

// ----- Leave room -----

export async function leaveRoom(
  code: string,
  sessionId: string
): Promise<void> {
  const raw = await redis.get(KEYS.room(code));
  if (!raw) return;

  const room: Room = JSON.parse(raw);

  room.players = room.players.filter((p) => p.sessionId !== sessionId);
  room.spectators = room.spectators.filter((s) => s.sessionId !== sessionId);

  if (room.players.length === 0) {
    // No one left — close room
    await closeRoom(code);
    return;
  }

  // If host left, reassign host
  if (room.hostSessionId === sessionId) {
    room.hostSessionId = room.players[0]!.sessionId;
  }

  // If player left mid-game, mark as abandoned
  if (room.status === 'in_progress') {
    room.status = 'abandoned';
  }

  await redis.set(KEYS.room(code), JSON.stringify(room), 'PX', ROOM_TTL_MS);

  await redis.publish(
    CHANNELS.roomEvents(code),
    JSON.stringify({ type: 'PLAYER_LEFT', sessionId, reason: 'left' })
  );
}

// ----- Get room -----

export async function getRoom(code: string): Promise<Room | null> {
  if (!isValidRoomCode(code)) return null;
  const raw = await redis.get(KEYS.room(code));
  if (!raw) return null;
  return JSON.parse(raw) as Room;
}

// ----- Update room status -----

export async function updateRoomStatus(
  code: string,
  status: RoomStatus
): Promise<void> {
  const raw = await redis.get(KEYS.room(code));
  if (!raw) return;

  const room: Room = JSON.parse(raw);
  room.status = status;

  await redis.set(KEYS.room(code), JSON.stringify(room), 'PX', ROOM_TTL_MS);
}

// ----- Refresh TTL -----

export async function refreshTTL(code: string): Promise<void> {
  await redis.expire(KEYS.room(code), Math.floor(ROOM_TTL_MS / 1000));
}

// ----- Close room -----

export async function closeRoom(code: string): Promise<void> {
  await redis.del(KEYS.room(code));
  await redis.del(KEYS.roomPlayers(code));
  await redis.del(KEYS.roomSpectators(code));
  await redis.del(KEYS.roomState(code));
}

// ----- Game state management -----

export async function saveGameState(
  code: string,
  state: GameState
): Promise<void> {
  await redis.set(KEYS.roomState(code), JSON.stringify(state), 'PX', ROOM_TTL_MS);
  await refreshTTL(code);
}

export async function getGameState(code: string): Promise<GameState | null> {
  const raw = await redis.get(KEYS.roomState(code));
  if (!raw) return null;
  return JSON.parse(raw) as GameState;
}

// ----- Rate limiting -----

export async function checkRateLimit(
  sessionId: string,
  action: string,
  limit: number,
  windowSecs = 60
): Promise<{ allowed: boolean; remaining: number }> {
  const key = KEYS.rateLimit(sessionId, action);
  const now = Date.now();
  const windowStart = now - windowSecs * 1000;

  // Remove old entries
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count current entries
  const count = await redis.zcard(key);

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  // Add new entry
  await redis.zadd(key, now, `${now}`);
  await redis.expire(key, windowSecs);

  return { allowed: true, remaining: limit - count - 1 };
}
