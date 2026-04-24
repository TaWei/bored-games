// ============================================================
// ROOM ROUTES — Hono handlers for room REST API
// ============================================================

import { Hono, type ContentfulStatusCode } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as RoomManager from '../services/room-manager';
import * as Matchmaking from '../services/matchmaking';
import type { Room, GameType } from '@bored-games/shared';
import { isValidRoomCode, isGameAvailable } from '@bored-games/shared';

const rooms = new Hono();

// Validation schemas
const createRoomSchema = z.object({
  gameType: z.string().min(1),
  displayName: z.string().optional(),
});

const joinRoomSchema = z.object({
  displayName: z.string().optional(),
});

const queueSchema = z.object({
  gameType: z.string().min(1),
  displayName: z.string().optional(),
});

// POST /api/rooms — Create a new room
rooms.post('/', zValidator('json', createRoomSchema), async (c) => {
  const { gameType, displayName } = c.req.valid('json');
  const sessionId = c.req.header('x-session-id');

  if (!sessionId) {
    return c.json({ error: 'Missing x-session-id header' }, 401);
  }

  try {
    if (!isGameAvailable(gameType as GameType)) {
      return c.json({ error: `Unknown game type: ${gameType}` }, 400);
    }

    const room = await RoomManager.createRoom(
      gameType as GameType,
      sessionId,
      displayName
    );

    return c.json({ roomCode: room.code, room }, 201);
  } catch (err) {
    console.error('Create room error:', err);
    return c.json({ error: 'Failed to create room' }, 500);
  }
});

// GET /api/rooms/:code — Get room info
rooms.get('/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();

  try {
    const room = await RoomManager.getRoom(code);
    if (!room) {
      return c.json({ error: 'Room not found' }, 404);
    }
    return c.json({ room });
  } catch (err) {
    console.error('Get room error:', err);
    return c.json({ error: 'Failed to get room' }, 500);
  }
});

// POST /api/rooms/:code/join — Join a room
rooms.post(
  '/:code/join',
  zValidator('json', joinRoomSchema),
  async (c) => {
    const code = c.req.param('code').toUpperCase();
    const { displayName } = c.req.valid('json');
    const sessionId = c.req.header('x-session-id');

    if (!sessionId) {
      return c.json({ error: 'Missing x-session-id header' }, 401);
    }

    try {
      const { room, symbol } = await RoomManager.joinRoom(
        code,
        sessionId,
        displayName
      );

      return c.json({ room, symbol }, 200);
    } catch (err) {
      if (err instanceof RoomManager.RoomError) {
        return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
      }
      console.error('Join room error:', err);
      return c.json({ error: 'Failed to join room' }, 500);
    }
  }
);

// POST /api/rooms/:code/join-as-spectator — Watch a game
rooms.post('/:code/join-as-spectator', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const sessionId = c.req.header('x-session-id') ?? c.req.header('x-spectator-id');
  const spectatorId = sessionId ?? `spectator_${Date.now()}`;

  try {
    const room = await RoomManager.joinAsSpectator(code, spectatorId, 'Spectator');
    return c.json({ room }, 200);
  } catch (err) {
    if (err instanceof RoomManager.RoomError) {
      return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
    }
    console.error('Spectate error:', err);
    return c.json({ error: 'Failed to spectate' }, 500);
  }
});

// POST /api/rooms/:code/leave — Leave a room
rooms.post('/:code/leave', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const sessionId = c.req.header('x-session-id');

  if (!sessionId) {
    return c.json({ error: 'Missing x-session-id header' }, 401);
  }

  try {
    await RoomManager.leaveRoom(code, sessionId);
    return c.json({ ok: true });
  } catch (err) {
    console.error('Leave room error:', err);
    return c.json({ error: 'Failed to leave room' }, 500);
  }
});

// GET /api/rooms/:code/state — Get current game state
rooms.get('/:code/state', async (c) => {
  const code = c.req.param('code').toUpperCase();

  try {
    const state = await RoomManager.getGameState(code);
    if (!state) {
      return c.json({ error: 'No game state found' }, 404);
    }
    return c.json({ state });
  } catch (err) {
    console.error('Get game state error:', err);
    return c.json({ error: 'Failed to get game state' }, 500);
  }
});

// POST /api/rooms/queue — Add to matchmaking queue
rooms.post('/queue', zValidator('json', queueSchema), async (c) => {
  const { gameType, displayName } = c.req.valid('json');
  const sessionId = c.req.header('x-session-id');

  if (!sessionId) {
    return c.json({ error: 'Missing x-session-id header' }, 401);
  }

  try {
    if (!isGameAvailable(gameType as GameType)) {
      return c.json({ error: `Unknown game type: ${gameType}` }, 400);
    }

    await Matchmaking.addToQueue(gameType as GameType, sessionId);
    const position = await Matchmaking.getQueuePosition(gameType as GameType, sessionId);

    return c.json({ queued: true, position, gameType }, 200);
  } catch (err) {
    console.error('Join queue error:', err);
    return c.json({ error: 'Failed to join queue' }, 500);
  }
});

// DELETE /api/rooms/queue — Remove from matchmaking queue
rooms.delete('/queue', async (c) => {
  const sessionId = c.req.header('x-session-id');
  const gameType = c.req.query('gameType') ?? 'tic-tac-toe';

  if (!sessionId) {
    return c.json({ error: 'Missing x-session-id header' }, 401);
  }

  try {
    await Matchmaking.removeFromQueue(gameType as GameType, sessionId);
    return c.json({ queued: false });
  } catch (err) {
    console.error('Leave queue error:', err);
    return c.json({ error: 'Failed to leave queue' }, 500);
  }
});

export { rooms };
