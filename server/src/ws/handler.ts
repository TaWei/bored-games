// ============================================================
// WEBSOCKET HANDLER — connection upgrade + message routing
// ============================================================

import type { ServerWebSocket } from 'bun';
import { GameLoop } from './game-loop';
import { getRoom, joinRoom, joinAsSpectator } from '../services/room-manager';
import type { ClientMessage, ServerMessage } from '@bored-games/shared';
import { isValidRoomCode, isValidSessionId } from '@bored-games/shared';
import { redis, redisSub, CHANNELS, KEYS } from '../lib/redis';
import { ROOM_TTL_MS } from '../lib/config';

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
    console.log(`[WS] handleWebSocket — sessionId=${sessionId} room=${roomCode} spectator=${isSpectator}`);

    // Keep ws alive — Bun may GC the ws reference if we don't store it
    // (Bun's WebSocket uses a pooled reference model)
    const wsRef = ws;

    // Look up room
    console.log(`[WS] calling getRoom for room=${roomCode}...`);
    console.log(`[WS] ws ref check — ws=${typeof wsRef === 'undefined' ? 'undefined' : 'defined'}, ws.data=${ws.data ? 'exists' : 'null'}`);

    let room: Awaited<ReturnType<typeof getRoom>>;
    try {
      room = await getRoom(roomCode);
    } catch (err) {
      console.log(`[WS] getRoom THREW ERROR — err=${err}, closing socket with 1011`);
      ws.close(1011, 'Redis error');
      return;
    }
    console.log(`[WS] getRoom result — room: ${room ? `status=${room.status} players=${room.players.length}` : 'null'}`);
    if (!room) {
      ws.send(JSON.stringify({ type: 'ERROR', payload: { code: 'ROOM_NOT_FOUND', message: `Room ${roomCode} not found` } } satisfies ServerMessage));
      ws.close();
      return;
    }

    // Check if room is in a state where joining makes sense
    if (room.status === 'completed') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: { code: 'ROOM_CLOSED', message: 'This room has been closed.' },
      } satisfies ServerMessage));
      ws.close();
      return;
    }

    // Allow reconnection to in_progress rooms (player disconnecting/reconnecting)
    // Also allow abandoned rooms so players can rejoin if they disconnected mid-game
    if (room.status === 'abandoned') {
      // Re-enable the room for the original players to rejoin
      room.status = 'in_progress';
      await redis.set(KEYS.room(roomCode), JSON.stringify(room), 'EX', ROOM_TTL_MS);
    }

    const displayName = room.players.find(p => p.sessionId === sessionId)?.displayName
      ?? room.spectators.find(s => s.sessionId === sessionId)?.displayName
      ?? 'Player';

    // Join the room (if not already a player).
    // Use the room we already fetched above — don't call joinRoom again if the
    // player is already in room.players (handles the reconnect-after-HTTP-join case
    // where the player was added by the REST call but the WS is a fresh connection).
    if (!isSpectator) {
      const alreadyJoined = room.players.some((p) => p.sessionId === sessionId);
      try {
        const { symbol } = alreadyJoined
          ? { symbol: room.players.find((p) => p.sessionId === sessionId)!.symbol }
          : await joinRoom(roomCode, sessionId);

        // Notify other players of (re)connection via Redis pub/sub
        // The GameLoop subscriber receives PLAYER_JOINED and broadcasts to all clients
        if (alreadyJoined) {
          await redis.publish(
            CHANNELS.roomEvents(roomCode),
            JSON.stringify({ type: 'PLAYER_JOINED', sessionId })
          );
        }

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
  console.log(`[WS] handleWSMessage — sessionId=${data.sessionId} roomCode=${data.roomCode} hasLoop=${!!data.loop} msg=${typeof rawMessage === 'string' ? rawMessage.slice(0, 100) : 'Blob'}`);
  if (!data.loop) {
    console.warn('[WS] handleWSMessage — no loop! ws.data:', JSON.stringify(data));
    return;
  }

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

  if (!isSpectator && !(data as any).intentionallyLeft) {
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
