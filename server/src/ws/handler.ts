// ============================================================
// WEBSOCKET HANDLER — connection upgrade + message routing
// ============================================================

import type { ServerWebSocket } from 'bun';
import { GameLoop } from './game-loop';
import { getRoom, joinRoom, joinAsSpectator } from '../services/room-manager';
import type { ClientMessage, ServerMessage } from '@bored-games/shared';
import { isValidRoomCode, isValidSessionId } from '@bored-games/shared';
import { redis, redisSub, CHANNELS } from '../lib/redis';

// Global registry of active game loops by room code
const activeGameLoops = new Map<string, GameLoop>();

export function getOrCreateGameLoop(roomCode: string, redisSub: typeof redis): GameLoop {
  let loop = activeGameLoops.get(roomCode);
  if (!loop) {
    loop = new GameLoop(roomCode, null, redisSub);
    activeGameLoops.set(roomCode, loop);
  }
  return loop;
}

export function removeGameLoop(roomCode: string) {
  activeGameLoops.delete(roomCode);
}

export interface WsContext {
  sessionId: string;
  roomCode: string;
  isSpectator: boolean;
}

export async function handleWebSocket(
  ws: ServerWebSocket<WsContext>,
  sessionId: string,
  roomCode: string,
  isSpectator: boolean
): Promise<void> {
  try {
    // Look up room
    const room = await getRoom(roomCode);
    if (!room) {
      ws.send(JSON.stringify({ type: 'ERROR', payload: { code: 'ROOM_NOT_FOUND', message: `Room ${roomCode} not found` } } satisfies ServerMessage));
      ws.close();
      return;
    }

    // Check if room is in a state where joining makes sense
    if (room.status === 'completed' || room.status === 'abandoned') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: { code: 'ROOM_CLOSED', message: 'This room has been closed.' },
      } satisfies ServerMessage));
      ws.close();
      return;
    }

    const displayName = room.players.find(p => p.sessionId === sessionId)?.displayName
      ?? room.spectators.find(s => s.sessionId === sessionId)?.displayName
      ?? 'Player';

    // Join the room (if not already a player)
    if (!isSpectator) {
      try {
        const { symbol } = await joinRoom(roomCode, sessionId);

        // Send connected + room info
        ws.send(JSON.stringify({
          type: 'ROOM_JOINED',
          payload: { room, symbol, mySessionId: sessionId },
        } satisfies ServerMessage));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to join room';
        ws.send(JSON.stringify({
          type: 'ERROR',
          payload: { code: 'JOIN_FAILED', message },
        } satisfies ServerMessage));
        ws.close();
        return;
      }
    } else {
      // Spectator
      try {
        await joinAsSpectator(roomCode, sessionId);
      } catch {
        // Allow spectators even if join fails (graceful)
      }

      ws.send(JSON.stringify({
        type: 'ROOM_JOINED',
        payload: { room, symbol: 'spectator', mySessionId: sessionId },
      } satisfies ServerMessage));
    }

    // Notify other players
    await redis.publish(
      CHANNELS.roomEvents(roomCode),
      JSON.stringify({ type: 'PLAYER_CONNECTED', sessionId, isSpectator })
    );

    // Get or create game loop
    const loop = getOrCreateGameLoop(roomCode, redisSub);

    // Store loop reference in ws.data for the global message handler to use
    (ws.data as WsContext & { loop?: GameLoop }).loop = loop;

    loop.addConnection(ws as unknown as ServerWebSocket<unknown>, sessionId, isSpectator, displayName);

    // Store cleanup function for close handler
    (ws.data as WsContext & { loop?: GameLoop; isSpectator?: boolean }).isSpectator = isSpectator;

  } catch (err) {
    console.error('[WS] handleWebSocket error:', err);
    ws.close(1011, 'Internal error');
  }
}

// Called by index.ts websocket.message handler to route a message to the game loop
export function handleWSMessage(ws: ServerWebSocket<WsContext>, rawMessage: string | Buffer): void {
  const data = ws.data as WsContext & { loop?: GameLoop };
  if (!data.loop) return;

  const sessionId = data.sessionId;
  const raw = rawMessage instanceof Buffer ? rawMessage.toString() : rawMessage;
  data.loop.handleMessage(sessionId, raw);
}

// Called by index.ts websocket.close handler to clean up
export function handleWSClose(ws: ServerWebSocket<WsContext>): void {
  const data = ws.data as WsContext & { loop?: GameLoop; isSpectator?: boolean };
  if (!data.loop) return;

  const { sessionId, roomCode, isSpectator } = data;

  data.loop.removeConnection(sessionId);

  if (!isSpectator) {
    redis.publish(
      CHANNELS.roomEvents(roomCode),
      JSON.stringify({ type: 'PLAYER_LEFT', sessionId, reason: 'disconnected' })
    ).catch(() => {});
  }

  // Clean up loop if no connections
  if (data.loop.connectionCount === 0) {
    setTimeout(() => {
      if (data.loop && data.loop.connectionCount === 0) {
        removeGameLoop(roomCode);
      }
    }, 30_000);
  }
}
