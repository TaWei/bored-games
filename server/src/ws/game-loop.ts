// ============================================================
// GAME LOOP — Per-room game state machine
// Manages: state, turns, moves, win detection, pub/sub
// ============================================================

import type { ServerWebSocket } from 'bun';
import { redis, CHANNELS } from '../lib/redis';
import { config, ROOM_TTL_MS, MOVE_RATE_LIMIT } from '../lib/config';
import {
  getRoom,
  saveGameState,
  updateRoomStatus,
  leaveRoom,
  checkRateLimit,
  refreshTTL,
} from '../services/room-manager';
import { recordGameResult } from '../services/leaderboard';
import { hashSessionId } from '../services/leaderboard';
import { getEngine } from '@bored-games/shared/games';
import type {
  GameState,
  Move,
  ServerMessage,
  ClientMessage,
  Room,
} from '@bored-games/shared';

interface Connection {
  ws: ServerWebSocket<ConnectionData>;
  sessionId: string;
  isSpectator: boolean;
  displayName: string;
  lastHeartbeat: number;
}

interface ConnectionData {
  sessionId: string;
  roomCode: string;
  isSpectator: boolean;
}

export class GameLoop {
  private connections = new Map<string, Connection>(); // sessionId → connection
  private state: GameState | null = null;
  private room: Room | null = null;
  private roomCode: string;
  private redisSub: typeof import('../lib/redis').redisSub;
  private unsub: (() => void) | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private gameStartTime: number = 0;
  private messageHandlers: Map<string, (msg: ClientMessage, conn: Connection) => void>;

  constructor(roomCode: string, _redis: unknown, redisSub: typeof import('../lib/redis').redisSub) {
    this.roomCode = roomCode;
    this.redisSub = redisSub;
    this.messageHandlers = new Map([
      ['MOVE', this.handleMove.bind(this)],
      ['CHAT', this.handleChat.bind(this)],
      ['HEARTBEAT', this.handleHeartbeat.bind(this)],
      ['REMATCH_REQUEST', this.handleRematchRequest.bind(this)],
      ['RESIGN', this.handleResign.bind(this)],
      ['LEAVE_ROOM', this.handleLeaveRoom.bind(this)],
    ]);
  }

  // ----- Connection management -----

  get connectionCount(): number {
    return this.connections.size;
  }

  addConnection(
    ws: ServerWebSocket<ConnectionData>,
    sessionId: string,
    isSpectator = false,
    displayName = 'Player'
  ): void {
    if (this.connections.has(sessionId)) {
      // Reconnection — replace old connection
      const existing = this.connections.get(sessionId)!;
      try {
        existing.ws.close();
      } catch {
        // already closed
      }
    }

    this.connections.set(sessionId, {
      ws,
      sessionId,
      isSpectator,
      displayName,
      lastHeartbeat: Date.now(),
    });

    // Subscribe to Redis pub/sub for this room
    if (!this.unsub) {
      this.subscribeToRoomEvents();
    }

    // Refresh room TTL on any activity
    refreshTTL(this.roomCode).catch(console.error);

    // If room is waiting and has 2 players, start the game
    this.checkAndStartGame().catch(console.error);
  }

  removeConnection(sessionId: string): void {
    this.connections.delete(sessionId);

    // If all connections gone, clean up
    if (this.connections.size === 0) {
      this.cleanup();
    }
  }

  async handleMessage(sessionId: string, rawMessage: string | Blob): Promise<void> {
    const conn = this.connections.get(sessionId);
    if (!conn) return;

    let msg: ClientMessage;
    try {
      if (rawMessage instanceof Blob) {
        msg = JSON.parse(await rawMessage.text()) as ClientMessage;
      } else {
        msg = JSON.parse(rawMessage) as ClientMessage;
      }
    } catch {
      this.sendTo(sessionId, {
        type: 'ERROR',
        payload: { code: 'BAD_MESSAGE', message: 'Invalid JSON message.' },
      });
      return;
    }

    const handler = this.messageHandlers.get(msg.type);
    if (handler) {
      handler(msg, conn);
    }
  }

  // ----- Message handlers -----

  private async handleMove(
    msg: Extract<ClientMessage, { type: 'MOVE' }>,
    conn: Connection
  ): Promise<void> {
    if (conn.isSpectator) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'SPECTATORS_CANNOT_MOVE', message: 'Spectators cannot make moves.' },
      });
    }

    if (!this.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'GAME_NOT_STARTED', message: 'Game has not started yet.' },
      });
    }

    if (this.state.result) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'GAME_OVER', message: 'Game has already ended.' },
      });
    }

    // Rate limiting
    const rateCheck = await checkRateLimit(conn.sessionId, 'move', MOVE_RATE_LIMIT);
    if (!rateCheck.allowed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: {
          code: 'RATE_LIMITED',
          message: `Slow down! Max ${MOVE_RATE_LIMIT} moves per minute.`,
        },
      });
    }

    // Validate move via game engine
    const engine = getEngine(this.state.gameType);
    const result = engine.applyMove(this.state, msg.payload.move, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: {
          code: result.error?.code ?? 'INVALID_MOVE',
          message: result.error?.message ?? 'Invalid move.',
        },
      });
    }

    // Update state
    this.state = result.state;

    // Broadcast to ALL connections
    await this.broadcast({
      type: 'STATE_UPDATE',
      payload: { state: this.state, lastMove: msg.payload.move },
    });

    // Persist to Redis
    await saveGameState(this.roomCode, this.state);

    // Check for game end
    if (this.state.result) {
      await this.handleGameEnd();
    }
  }

  private async handleChat(
    msg: Extract<ClientMessage, { type: 'CHAT' }>,
    conn: Connection
  ): Promise<void> {
    const sanitized = msg.payload.message
      .slice(0, 200)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    await this.broadcast({
      type: 'CHAT',
      payload: {
        sessionId: conn.sessionId,
        displayName: conn.displayName,
        message: sanitized,
      },
    });
  }

  private handleHeartbeat(
    msg: Extract<ClientMessage, { type: 'HEARTBEAT' }>,
    conn: Connection
  ): void {
    conn.lastHeartbeat = Date.now();
    this.sendTo(conn.sessionId, {
      type: 'HEARTBEAT_ACK',
      payload: {
        serverTime: Date.now(),
        clientTime: msg.payload.clientTime,
      },
    });
  }

  private async handleRematchRequest(
    _msg: Extract<ClientMessage, { type: 'REMATCH_REQUEST' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.room) return;

    if (!this.room.rematchRequests.includes(conn.sessionId)) {
      this.room.rematchRequests.push(conn.sessionId);
    }

    // Notify all players that a rematch was requested
    await this.broadcast({
      type: 'REMATCH_OFFERED',
      payload: { sessionId: conn.sessionId },
    });

    // If all players requested rematch, create new room
    if (
      this.room.rematchRequests.length > 0 &&
      this.room.rematchRequests.length >= this.room.players.filter(p => !p.sessionId.startsWith('spectator')).length
    ) {
      // TODO: implement rematch — create new room, copy players, reset state
    }
  }

  private async handleResign(
    _msg: Extract<ClientMessage, { type: 'RESIGN' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.result) return;

    // The other player wins by resignation
    const winner = this.state.players.find((p) => p !== conn.sessionId);
    if (!winner) return;

    this.state = {
      ...this.state,
      result: { winner, reason: 'RESIGNATION' },
      updatedAt: Date.now(),
    };

    await this.broadcast({
      type: 'GAME_END',
      payload: { result: this.state.result, state: this.state },
    });

    await saveGameState(this.roomCode, this.state);
    await this.handleGameEnd();
  }

  private async handleLeaveRoom(
    _msg: Extract<ClientMessage, { type: 'LEAVE_ROOM' }>,
    conn: Connection
  ): Promise<void> {
    await leaveRoom(this.roomCode, conn.sessionId);
    this.removeConnection(conn.sessionId);
    conn.ws.close();
  }

  // ----- Game flow -----

  private async checkAndStartGame(): Promise<void> {
    if (this.room?.status === 'in_progress') return;
    if (this.connections.size < 2) return; // Need at least 2 players

    const room = await getRoom(this.roomCode);
    if (!room) return;
    if (room.status !== 'waiting') return;
    if (room.players.length < room.maxPlayers) return;

    // Start the game!
    await updateRoomStatus(this.roomCode, 'in_progress');

    const engine = getEngine(room.gameType);
    this.state = engine.createInitialState(room.players.map((p) => p.sessionId));
    this.room = room;
    this.gameStartTime = Date.now();

    await saveGameState(this.roomCode, this.state);

    await this.broadcast({
      type: 'GAME_START',
      payload: { state: this.state },
    });

    await this.broadcastToPlayers({
      type: 'ROOM_JOINED',
      payload: {
        room,
        symbol: 'X', // TODO: pass actual symbol per player
        mySessionId: room.players[0]!.sessionId,
      },
    });

    // Start heartbeat monitoring
    this.startHeartbeat();
  }

  private async handleGameEnd(): Promise<void> {
    if (!this.state?.result) return;

    const durationMs = Date.now() - this.gameStartTime;

    // Record in leaderboard (fire and forget)
    try {
      const hashes = await Promise.all(
        this.state.players.map((s) => hashSessionId(s))
      );
      const winnerHash = this.state.result.winner
        ? await hashSessionId(this.state.result.winner)
        : null;

      await recordGameResult({
        gameType: this.state.gameType,
        sessionHashes: hashes,
        winnerHash,
        loserHashes: hashes.filter((h) => h !== winnerHash),
        finalState: this.state as unknown as Record<string, unknown>,
        movesCount: this.state.moveCount,
        durationMs,
      });
    } catch (err) {
      console.error('Failed to record game result:', err);
    }

    await updateRoomStatus(this.roomCode, 'completed');
  }

  // ----- Pub/Sub -----

  private async subscribeToRoomEvents(): Promise<void> {
    const channel = CHANNELS.roomEvents(this.roomCode);

    try {
      await this.redisSub.subscribe(channel);
    } catch (err) {
      console.error('Failed to subscribe to room events:', err);
      return;
    }

    this.unsub = () => {
      this.redisSub.unsubscribe(channel).catch(console.error);
    };

    this.redisSub.on('message', (ch, msg) => {
      if (ch !== channel) return;

      try {
        const event = JSON.parse(msg);
        if (event.type === 'PLAYER_JOINED') {
          // Refresh room data
          getRoom(this.roomCode).then((room) => {
            if (room) {
              this.room = room;
              this.checkAndStartGame().catch(console.error);
            }
          });
        } else if (event.type === 'PLAYER_LEFT') {
          this.broadcast({
            type: 'PLAYER_LEFT',
            payload: { sessionId: event.sessionId, reason: event.reason },
          });
        }
      } catch {
        // ignore parse errors
      }
    });
  }

  // ----- Broadcast helpers -----

  private async broadcast(msg: ServerMessage): Promise<void> {
    const data = JSON.stringify(msg);
    const promises: Promise<unknown>[] = [];
    for (const conn of this.connections.values()) {
      promises.push(
        new Promise<void>((resolve) => {
          try {
            conn.ws.send(data);
            resolve();
          } catch {
            resolve();
          }
        })
      );
    }
    await Promise.all(promises);
  }

  private async broadcastToPlayers(msg: ServerMessage): Promise<void> {
    const data = JSON.stringify(msg);
    for (const conn of this.connections.values()) {
      if (!conn.isSpectator) {
        try {
          conn.ws.send(data);
        } catch {
          // ignore
        }
      }
    }
  }

  private sendTo(sessionId: string, msg: ServerMessage): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  // ----- Heartbeat -----

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = config.HEARTBEAT_INTERVAL_MS * 3; // 3 missed beats = dead

      for (const [sessionId, conn] of this.connections) {
        if (now - conn.lastHeartbeat > timeout && !conn.isSpectator) {
          // Connection is dead — remove
          this.removeConnection(sessionId);
          this.broadcast({
            type: 'PLAYER_LEFT',
            payload: { sessionId, reason: 'disconnected' },
          });
        }
      }
    }, config.HEARTBEAT_INTERVAL_MS);
  }

  // ----- Cleanup -----

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }
}
