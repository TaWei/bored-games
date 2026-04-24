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
  AvalonMove,
  AvalonPlayerState,
  CodenamesMove,
  CodenamesPlayerState,
  WerewolfMove,
  WerewolfPlayerState,
  WerewolfState,
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
  /** Tracks the secret playerStates for the current Avalon game (server-side only) */
  private avalonPlayerStates: import('@bored-games/shared').AvalonPlayerState[] | null = null;
  /** Tracks the secret playerStates for the current Codenames game (server-side only) */
  private codenamesPlayerStates: CodenamesPlayerState[] | null = null;
  /** Tracks the secret playerStates for the current Werewolf game (server-side only) */
  private werewolfPlayerStates: WerewolfPlayerState[] | null = null;

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
      // Avalon-specific
      ['AVALON_PROPOSE_TEAM', this.handleAvalonProposeTeam.bind(this)],
      ['AVALON_VOTE_TEAM', this.handleAvalonVoteTeam.bind(this)],
      ['AVALON_SUBMIT_QUEST_CARD', this.handleAvalonSubmitQuestCard.bind(this)],
      ['AVALON_ASSASSINATE', this.handleAvalonAssassinate.bind(this)],
      ['AVALON_USE_CLERIC', this.handleAvalonUseCleric.bind(this)],
      ['AVALON_USE_REVEALER', this.handleAvalonUseRevealer.bind(this)],
      ['AVALON_USE_TROUBLEMAKER', this.handleAvalonUseTroublemaker.bind(this)],
      ['AVALON_USE_TRICKSTER', this.handleAvalonUseTrickster.bind(this)],
      ['AVALON_USE_WITCH', this.handleAvalonUseWitch.bind(this)],
      ['AVALON_FLIP_LANCELOT', this.handleAvalonFlipLancelot.bind(this)],
      // Codenames-specific
      ['CODENAMES_GIVE_CLUE', this.handleCodenamesGiveClue.bind(this)],
      ['CODENAMES_GUESS', this.handleCodenamesGuess.bind(this)],
      ['CODENAMES_PASS', this.handleCodenamesPass.bind(this)],
      // Werewolf-specific
      ['WEREWOLF_KILL', this.handleWerewolfKill.bind(this)],
      ['WEREWOLF_PEEK', this.handleWerewolfPeek.bind(this)],
      ['WEREWOLF_HUNTER_SHOOT', this.handleWerewolfHunterShoot.bind(this)],
      ['WEREWOLF_VOTE', this.handleWerewolfVote.bind(this)],
      ['WEREWOLF_PASS', this.handleWerewolfPass.bind(this)],
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

    // If player disconnects mid-game, clean up Redis so they don't block new players
    if (this.room?.status === 'in_progress') {
      leaveRoom(this.roomCode, sessionId).catch(console.error);
    }

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

    // For Avalon, Codenames, and Werewolf, we route to dedicated handlers instead of generic engine
    if (this.state.gameType === 'avalon' || this.state.gameType === 'codenames' || this.state.gameType === 'werewolf') {
      return; // Avalon/Codenames/Werewolf moves are handled by dedicated handlers
    }

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

    // Broadcast state update (spectator-safe for Werewolf)
    if (this.state?.gameType === 'werewolf') {
      await this.broadcastWerewolfStateUpdate(
        msg.payload.move,
        this.state as WerewolfState
      );
    } else {
      await this.broadcast({
        type: 'STATE_UPDATE',
        payload: { state: this.state, lastMove: msg.payload.move },
      });
    }

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
    const minPlayers = this.room ? getEngine(this.room.gameType).minPlayers : 2;
    if (this.connections.size < minPlayers) return;

    const room = await getRoom(this.roomCode);
    if (!room) return;
    if (room.status !== 'waiting') return;
    if (room.players.length < room.maxPlayers) return;

    // Start the game!
    await updateRoomStatus(this.roomCode, 'in_progress');

    const engine = getEngine(room.gameType);
    const playerIds = room.players.map((p) => p.sessionId);
    this.state = engine.createInitialState(playerIds);
    this.room = room;
    this.gameStartTime = Date.now();
    this.room.rematchRequests = [];

    await saveGameState(this.roomCode, this.state);

    // ----- Avalon role assignment (server-side secret) -----
    if (room.gameType === 'avalon') {
      await this.assignAvalonRoles(room, playerIds);
    }

    // ----- Codenames grid generation (server-side secret) -----
    if (room.gameType === 'codenames') {
      await this.assignCodenamesRoles(room, playerIds);
    }

    // ----- Werewolf role assignment (server-side secret) -----
    if (room.gameType === 'werewolf') {
      await this.assignWerewolfRoles(room, playerIds);
    }

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

    // Codenames is team-based — skip leaderboard recording for now
    if (this.state.gameType === 'codenames') {
      await updateRoomStatus(this.roomCode, 'completed');
      return;
    }

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

    // Clear rematch requests to prevent accumulation across games
    if (this.room) {
      this.room.rematchRequests = [];
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

  private async broadcastToSpectators(msg: ServerMessage): Promise<void> {
    const data = JSON.stringify(msg);
    for (const conn of this.connections.values()) {
      if (conn.isSpectator) {
        try {
          conn.ws.send(data);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Sanitize WerewolfState for spectators by stripping private information.
   * Removes: seerPeekResults, werewolfKillTarget, and role info from playerStates.
   */
  private sanitizeWerewolfStateForSpectator(state: WerewolfState): WerewolfState {
    return {
      ...state,
      seerPeekResults: {},
      werewolfKillTarget: null,
      // Strip role info from player states - spectators only see alive/dead status
      playerStates: state.playerStates.map((ps) => ({
        sessionId: ps.sessionId,
        displayName: ps.displayName,
        isAlive: ps.isAlive,
        role: undefined,
      })),
    };
  }

  /**
   * Broadcast state update for Werewolf, sending full state to players
   * and sanitized state to spectators.
   */
  private async broadcastWerewolfStateUpdate(
    lastMove: Move,
    state: WerewolfState
  ): Promise<void> {
    const fullUpdate: ServerMessage = {
      type: 'STATE_UPDATE',
      payload: { state, lastMove },
    };
    const sanitizedUpdate: ServerMessage = {
      type: 'STATE_UPDATE',
      payload: { state: this.sanitizeWerewolfStateForSpectator(state), lastMove },
    };

    await Promise.all([
      this.broadcastToPlayers(fullUpdate),
      this.broadcastToSpectators(sanitizedUpdate),
    ]);
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

  // ----- Avalon Role Assignment -----

  /**
   * Assign secret roles to all Avalon players.
   * Each player receives their role privately via AVALON_ROLE_ASSIGNED.
   * Evil players also see their teammates.
   * Merlin sees all Minions of Mordred (except Mordred himself).
   * Percival sees Merlin and Morgana (disguised).
   */
  private async assignAvalonRoles(
    room: Room,
    playerIds: string[]
  ): Promise<void> {
    const { buildRoleDeck, shuffle } = await import('@bored-games/shared').catch(() => {
      // Fallback inline implementation to avoid circular deps
      const ADJECTIVES = ['Swift', 'Clever', 'Brave'];
      const ANIMALS = ['Fox', 'Bear', 'Wolf'];
      const generateDisplayName = () => {
        const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
        const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
        return `${adj} ${animal}`;
      };
      return { buildRoleDeck: null, shuffle: null };
    });

    // Build display name map
    const playerNames: Record<string, string> = {};
    for (const player of room.players) {
      playerNames[player.sessionId] = player.displayName;
    }

    // Assign roles using the engine's logic (imported inline to avoid circular deps)
    const { assignRoles, merlinSees, percivalSees } = await import('@bored-games/shared').then(m => {
      // Use exported helpers if available
      return {
        assignRoles: (players: string[], names: Record<string, string>) => {
          // Build role deck
          const templates: Record<number, { good: string[]; evil: string[] }> = {
            5: { good: ['merlin', 'percival', 'servant'], evil: ['minion', 'mordred'] },
            6: { good: ['merlin', 'percival', 'servant'], evil: ['minion', 'minion', 'mordred'] },
            7: { good: ['merlin', 'percival', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana'] },
            8: { good: ['merlin', 'percival', 'servant', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana', 'oberon'] },
            9: { good: ['merlin', 'percival', 'servant', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana', 'oberon'] },
            10: { good: ['merlin', 'percival', 'servant', 'servant', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana', 'oberon'] },
          };
          const playerCount = players.length;
          const template = templates[playerCount] ?? templates[5]!;
          while (template.good.length + template.evil.length < playerCount) {
            template.good.push('servant');
          }
          const deck = [...template.good, ...template.evil];
          // Fisher-Yates shuffle
          for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j]!, deck[i]!];
          }
          return players.map((sessionId, i) => ({
            sessionId,
            displayName: names[sessionId] ?? 'Player',
            role: deck[i] as import('@bored-games/shared').AvalonRole,
            isEvil: template.evil.includes(deck[i]!),
          }));
        },
        merlinSees: (playerStates: { role?: string; sessionId: string }[]) =>
          playerStates
            .filter((p) => ['minion', 'morgana', 'evil_lancelot', 'trickster', 'witch', 'brute', 'lunatic'].includes(p.role ?? ''))
            .map((p) => p.sessionId),
        percivalSees: (playerStates: { role?: string; sessionId: string }[]) =>
          [playerStates.find((p) => p.role === 'merlin'), playerStates.find((p) => p.role === 'morgana')]
            .filter(Boolean)
            .map((p) => p!.sessionId),
      };
    }).catch(() => ({
      assignRoles: (_p: string[], _n: Record<string, string>) => [],
      merlinSees: (_p: { sessionId: string }[]) => [] as string[],
      percivalSees: (_p: { sessionId: string }[]) => [] as string[],
    }));

    const playerStates = assignRoles(playerIds, playerNames);
    this.avalonPlayerStates = playerStates as AvalonPlayerState[];

    // Send private role info to each player
    for (const ps of playerStates) {
      const isEvil = (ps as { isEvil?: boolean }).isEvil ?? false;
      const teammates = isEvil
        ? playerStates.filter((p) => (p as { isEvil?: boolean }).isEvil && p.sessionId !== ps.sessionId).map((p) => p.sessionId)
        : undefined;

      const role = (ps as { role: string }).role as import('@bored-games/shared').AvalonRole;
      const merlinSeeList = role === 'merlin' ? merlinSees(playerStates as { role?: string; sessionId: string }[]) : undefined;
      const percivalSeeList = role === 'percival' ? percivalSees(playerStates as { role?: string; sessionId: string }[]) : undefined;

      this.sendTo(ps.sessionId, {
        type: 'AVALON_ROLE_ASSIGNED',
        payload: {
          role,
          isEvil,
          teammates,
          merlinSees: merlinSeeList,
          percivalSees: percivalSeeList,
        },
      } as ServerMessage);
    }

    // Broadcast phase change to all
    const missionSizes = this.getMissionSizes(playerIds.length);
    await this.broadcast({
      type: 'AVALON_PHASE_CHANGE',
      payload: {
        phase: 'team_proposal',
        leaderIndex: 0,
        missionSizes,
      },
    } as ServerMessage);

    // Update state with player names (roles stripped for serialization)
    if (this.state && this.state.gameType === 'avalon') {
      const avalonState = this.state as import('@bored-games/shared').AvalonState;
      this.state = {
        ...avalonState,
        phase: 'team_proposal',
        playerStates: playerStates as AvalonPlayerState[],
      } as GameState;
      await saveGameState(this.roomCode, this.state);
    }
  }

  private getMissionSizes(playerCount: number): number[] {
    const sizes: Record<number, [number, number, number, number, number]> = {
      5: [2, 3, 2, 3, 3],
      6: [2, 3, 4, 3, 4],
      7: [2, 3, 3, 4, 4],
      8: [3, 4, 4, 5, 5],
      9: [3, 4, 4, 5, 5],
      10: [3, 4, 4, 5, 5],
    };
    const arr = sizes[playerCount] ?? sizes[5]!;
    return [...arr];
  }

  // ----- Avalon Message Handlers -----

  private async handleAvalonProposeTeam(
    msg: Extract<ClientMessage, { type: 'AVALON_PROPOSE_TEAM' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'avalon') return;
    if (conn.isSpectator) return;

    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    const leader = avalonState.players[avalonState.leaderIndex]!;

    if (conn.sessionId !== leader) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'NOT_LEADER', message: 'Only the leader can propose a team.' },
      } as ServerMessage);
    }

    const engine = getEngine('avalon');
    const result = engine.applyMove(avalonState, { type: 'PROPOSE_TEAM', team: msg.payload.team }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid team.' },
      } as ServerMessage);
    }

    this.state = result.state;
    await this.broadcast({
      type: 'AVALON_TEAM_PROPOSED',
      payload: { leader: conn.sessionId, team: msg.payload.team },
    } as ServerMessage);
    await this.broadcast({
      type: 'AVALON_PHASE_CHANGE',
      payload: {
        phase: 'team_vote',
        leaderIndex: avalonState.leaderIndex,
        missionSizes: this.getMissionSizes(avalonState.players.length),
      },
    } as ServerMessage);
    await saveGameState(this.roomCode, this.state);
  }

  private async handleAvalonVoteTeam(
    msg: Extract<ClientMessage, { type: 'AVALON_VOTE_TEAM' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'avalon') return;
    if (conn.isSpectator) return;

    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    const engine = getEngine('avalon');
    const result = engine.applyMove(avalonState, { type: 'VOTE_TEAM', approve: msg.payload.approve }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid vote.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newAvalon = result.state as import('@bored-games/shared').AvalonState;

    await this.broadcast({
      type: 'AVALON_TEAM_VOTE',
      payload: { votes: newAvalon.votes, votesReceived: newAvalon.votesReceived },
    } as ServerMessage);

    if (newAvalon.phase === 'quest') {
      // Quest started — all cards submitted, resolve immediately
      await this.resolveQuest(newAvalon);
    } else if (newAvalon.phase === 'team_proposal') {
      // Proposal rejected — new leader
      await this.broadcast({
        type: 'AVALON_PHASE_CHANGE',
        payload: {
          phase: 'team_proposal',
          leaderIndex: newAvalon.leaderIndex,
          missionSizes: this.getMissionSizes(newAvalon.players.length),
        },
      } as ServerMessage);
    }

    await saveGameState(this.roomCode, this.state);
  }

  private async handleAvalonSubmitQuestCard(
    msg: Extract<ClientMessage, { type: 'AVALON_SUBMIT_QUEST_CARD' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'avalon') return;
    if (conn.isSpectator) return;

    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    const engine = getEngine('avalon');
    const result = engine.applyMove(avalonState, { type: 'SUBMIT_QUEST_CARD', card: msg.payload.card }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid quest card.' },
      } as ServerMessage);
    }

    this.state = result.state;

    // If all cards submitted, resolve the quest
    if (result.state.phase === 'team_proposal' || result.state.phase === 'assassination') {
      await this.resolveQuest(result.state as import('@bored-games/shared').AvalonState);
    }

    await saveGameState(this.roomCode, this.state);
  }

  private async resolveQuest(avalonState: import('@bored-games/shared').AvalonState): Promise<void> {
    const lastResult = avalonState.missionResults[avalonState.mission - 1];
    if (!lastResult) return;

    await this.broadcast({
      type: 'AVALON_QUEST_RESULT',
      payload: {
        succeeded: lastResult.succeeded,
        failCards: lastResult.failCards,
        revealedCards: avalonState.revealedQuestCards,
      },
    } as ServerMessage);

    await this.broadcast({
      type: 'AVALON_MISSION_UPDATE',
      payload: { mission: avalonState.mission, results: avalonState.missionResults },
    } as ServerMessage);

    // Check if game ended after quest resolution
    if (avalonState.phase === 'assassination') {
      const merlinId = this.avalonPlayerStates?.find((p) => p.role === 'merlin')?.sessionId;
      const candidates = this.avalonPlayerStates
        ?.filter((p) => p.isEvil)
        .map((p) => p.sessionId) ?? [];

      await this.broadcast({
        type: 'AVALON_ASSASSINATION_PHASE',
        payload: { candidates },
      } as ServerMessage);
    } else if (avalonState.phase === 'team_proposal') {
      // Advance mission and move to next leader
      const nextMission = avalonState.missionResults.filter(Boolean).length < 3
        ? Math.min(avalonState.mission + 1, 5)
        : avalonState.mission;
      const nextLeader = (avalonState.leaderIndex + 1) % avalonState.players.length;

      await this.broadcast({
        type: 'AVALON_PHASE_CHANGE',
        payload: {
          phase: 'team_proposal',
          leaderIndex: nextLeader,
          missionSizes: this.getMissionSizes(avalonState.players.length),
        },
      } as ServerMessage);
    } else if (avalonState.phase === 'game_end') {
      await this.handleGameEnd();
    }
  }

  private async handleAvalonAssassinate(
    msg: Extract<ClientMessage, { type: 'AVALON_ASSASSINATE' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'avalon') return;
    if (conn.isSpectator) return;

    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    const engine = getEngine('avalon');
    const result = engine.applyMove(avalonState, { type: 'ASSASSINATE', target: msg.payload.target }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid assassination.' },
      } as ServerMessage);
    }

    this.state = result.state;

    await this.broadcast({
      type: 'AVALON_ASSASSINATION_VOTE',
      payload: { votes: (result.state as import('@bored-games/shared').AvalonState).assassinationVotes },
    } as ServerMessage);

    await saveGameState(this.roomCode, this.state);
    await this.handleGameEnd();
  }

  private handleAvalonUseCleric(
    msg: Extract<ClientMessage, { type: 'AVALON_USE_CLERIC' }>,
    conn: Connection
  ): void {
    if (!this.state || this.state.gameType !== 'avalon') return;
    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    if (avalonState.abilitiesUsed.clericUsed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ABILITY_ALREADY_USED', message: 'Cleric ability already used.' },
      } as ServerMessage);
    }
    const targetRole = this.avalonPlayerStates?.find((p) => p.sessionId === msg.payload.target)?.role;
    if (!targetRole) return;
    avalonState.abilitiesUsed.clericUsed = true;
    this.broadcast({
      type: 'AVALON_ROLE_REVEAL',
      payload: { target: msg.payload.target, role: targetRole as import('@bored-games/shared').AvalonRole },
    } as ServerMessage);
    this.sendTo(conn.sessionId, {
      type: 'AVALON_ABILITY_USED',
      payload: { ability: 'cleric', player: conn.sessionId, target: msg.payload.target },
    } as ServerMessage);
  }

  private handleAvalonUseRevealer(
    msg: Extract<ClientMessage, { type: 'AVALON_USE_REVEALER' }>,
    conn: Connection
  ): void {
    if (!this.state || this.state.gameType !== 'avalon') return;
    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    if (avalonState.abilitiesUsed.revealerUsed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ABILITY_ALREADY_USED', message: 'Revealer ability already used.' },
      } as ServerMessage);
    }
    // Reveal the player's quest card
    const ps = this.avalonPlayerStates?.find((p) => p.sessionId === msg.payload.target);
    const lastCard = ps?.questCards?.at(-1);
    if (!lastCard) return;
    avalonState.abilitiesUsed.revealerUsed = true;
    avalonState.revealedCardPlayer = msg.payload.target;
    this.broadcast({
      type: 'AVALON_ABILITY_USED',
      payload: { ability: 'revealer', player: conn.sessionId, target: msg.payload.target },
    } as ServerMessage);
    // Send private card to the Revealer player
    this.sendTo(conn.sessionId, {
      type: 'AVALON_ROLE_REVEAL',
      payload: { target: msg.payload.target, role: lastCard as unknown as import('@bored-games/shared').AvalonRole },
    } as ServerMessage);
  }

  private handleAvalonUseTroublemaker(
    msg: Extract<ClientMessage, { type: 'AVALON_USE_TROUBLEMAKER' }>,
    conn: Connection
  ): void {
    if (!this.state || this.state.gameType !== 'avalon') return;
    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    if (avalonState.abilitiesUsed.troublemakerUsed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ABILITY_ALREADY_USED', message: 'Troublemaker ability already used.' },
      } as ServerMessage);
    }
    avalonState.abilitiesUsed.troublemakerUsed = true;
    avalonState.roleSwap = [msg.payload.targetA, msg.payload.targetB];
    this.broadcast({
      type: 'AVALON_ABILITY_USED',
      payload: { ability: 'troublemaker', player: conn.sessionId, target: `${msg.payload.targetA}-${msg.payload.targetB}` },
    } as ServerMessage);
  }

  private handleAvalonUseTrickster(
    msg: Extract<ClientMessage, { type: 'AVALON_USE_TRICKSTER' }>,
    conn: Connection
  ): void {
    if (!this.state || this.state.gameType !== 'avalon') return;
    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    if (avalonState.abilitiesUsed.tricksterUsed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ABILITY_ALREADY_USED', message: 'Trickster ability already used.' },
      } as ServerMessage);
    }
    avalonState.abilitiesUsed.tricksterUsed = true;
    this.broadcast({
      type: 'AVALON_ABILITY_USED',
      payload: { ability: 'trickster', player: conn.sessionId, target: msg.payload.fakeFailTarget },
    } as ServerMessage);
  }

  private handleAvalonUseWitch(
    msg: Extract<ClientMessage, { type: 'AVALON_USE_WITCH' }>,
    conn: Connection
  ): void {
    if (!this.state || this.state.gameType !== 'avalon') return;
    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    if (avalonState.abilitiesUsed.witchUsed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ABILITY_ALREADY_USED', message: 'Witch ability already used.' },
      } as ServerMessage);
    }
    avalonState.abilitiesUsed.witchUsed = true;
    avalonState.witchSwapTarget = msg.payload.target;
    this.broadcast({
      type: 'AVALON_ABILITY_USED',
      payload: { ability: 'witch', player: conn.sessionId, target: msg.payload.target },
    } as ServerMessage);
  }

  private handleAvalonFlipLancelot(
    _msg: Extract<ClientMessage, { type: 'AVALON_FLIP_LANCELOT' }>,
    conn: Connection
  ): void {
    if (!this.state || this.state.gameType !== 'avalon') return;
    const avalonState = this.state as import('@bored-games/shared').AvalonState;
    if (avalonState.abilitiesUsed.lancelotReversed) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ABILITY_ALREADY_USED', message: 'Lancelot already flipped.' },
      } as ServerMessage);
    }
    avalonState.abilitiesUsed.lancelotReversed = true;
    const ps = this.avalonPlayerStates?.find((p) => p.sessionId === conn.sessionId);
    if (!ps) return;
    // Toggle alignment
    const newAlignment = ps.isEvil ? 'good' : 'evil';
    (ps as { isEvil: boolean }).isEvil = !ps.isEvil;
    this.broadcast({
      type: 'AVALON_LANCELOT_FLIPPED',
      payload: { player: conn.sessionId, newAlignment },
    } as ServerMessage);
  }

  // ----- Codenames Role Assignment -----

  /**
   * Assign Codenames teams and roles, generate the grid, and send private
   * role info to each player. Grid is revealed to all via GAME_START.
   */
  private async assignCodenamesRoles(
    room: Room,
    playerIds: string[]
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'codenames') return;

    const codenamesState = this.state as import('@bored-games/shared').CodenamesState;

    // Generate the grid server-side
    const { generateGrid } = await import('@bored-games/shared/games/codenames').catch(() => {
      // Fallback: shouldn't happen if module is wired correctly
      return { generateGrid: () => [] };
    });

    const grid = generateGrid();

    // Build display name map
    const playerNames: Record<string, string> = {};
    for (const player of room.players) {
      playerNames[player.sessionId] = player.displayName;
    }

    // Assign teams and roles using the engine's logic
    const { assignCodenamesRoles } = await import('@bored-games/shared/games/codenames').catch(() => {
      return {
        assignCodenamesRoles: (_players: string[], _names: Record<string, string>, _roomPlayers: Room['players']) => {
          const midpoint = Math.ceil(_players.length / 2);
          return _players.map((sessionId, i) => {
            const isRed = i < midpoint;
            const teammates = _players.filter((_, j) => (j < midpoint) === isRed && j !== i);
            const isSpymaster = teammates.length === 0;
            return {
              sessionId,
              displayName: _names[sessionId] ?? 'Player',
              team: (isRed ? 'red' : 'blue') as import('@bored-games/shared').CodenamesTeam,
              role: (isSpymaster ? 'spymaster' : 'operative') as 'spymaster' | 'operative',
            };
          });
        },
      };
    });

    const playerStates = assignCodenamesRoles(playerIds, playerNames, room.players);
    this.codenamesPlayerStates = playerStates;

    // Inject grid into state
    this.state = {
      ...codenamesState,
      grid,
      playerStates,
      phase: 'clue',
      activeTeam: 'red',
      startingTeam: 'red',
      updatedAt: Date.now(),
    } as GameState;

    // Send private role info to each player
    for (const ps of playerStates) {
      this.sendTo(ps.sessionId, {
        type: 'CODENAMES_ROLE_ASSIGNED',
        payload: { team: ps.team, role: ps.role },
      } as ServerMessage);
    }

    await saveGameState(this.roomCode, this.state);
  }

  // ----- Codenames Message Handlers -----

  private async handleCodenamesGiveClue(
    msg: Extract<ClientMessage, { type: 'CODENAMES_GIVE_CLUE' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'codenames') return;
    if (conn.isSpectator) return;

    const codenamesState = this.state as import('@bored-games/shared').CodenamesState;
    const player = codenamesState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' },
      } as ServerMessage);
    }

    if (player.role !== 'spymaster') {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'Only the spymaster can give clues.' },
      } as ServerMessage);
    }
    if (player.team !== codenamesState.activeTeam) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: "It's not your team's turn." },
      } as ServerMessage);
    }

    const engine = getEngine('codenames');
    const result = engine.applyMove(
      codenamesState,
      { type: 'GIVE_CLUE', word: msg.payload.word, number: msg.payload.number },
      conn.sessionId
    );

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid clue.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newState = result.state as import('@bored-games/shared').CodenamesState;

    await this.broadcast({
      type: 'CODENAMES_CLUE_GIVEN',
      payload: { word: msg.payload.word, number: msg.payload.number, team: newState.activeTeam },
    } as ServerMessage);

    await this.broadcast({
      type: 'STATE_UPDATE',
      payload: { state: this.state, lastMove: { type: 'GIVE_CLUE', word: msg.payload.word, number: msg.payload.number } as Move },
    });

    await saveGameState(this.roomCode, this.state);

    if (newState.phase === 'game_end') {
      await this.handleGameEnd();
    }
  }

  private async handleCodenamesGuess(
    msg: Extract<ClientMessage, { type: 'CODENAMES_GUESS' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'codenames') return;
    if (conn.isSpectator) return;

    const codenamesState = this.state as import('@bored-games/shared').CodenamesState;
    const player = codenamesState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.role !== 'operative' || player.team !== codenamesState.activeTeam) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'Only an operative on the active team can guess.' },
      } as ServerMessage);
    }

    const engine = getEngine('codenames');
    const result = engine.applyMove(
      codenamesState,
      { type: 'GUESS', cardIndex: msg.payload.cardIndex },
      conn.sessionId
    );

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid guess.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newState = result.state as import('@bored-games/shared').CodenamesState;
    const revealedCard = newState.grid[msg.payload.cardIndex]!;

    await this.broadcast({
      type: 'CODENAMES_CARD_REVEALED',
      payload: { cardIndex: msg.payload.cardIndex, cardType: revealedCard.type, guesser: conn.sessionId },
    } as ServerMessage);

    await this.broadcast({
      type: 'STATE_UPDATE',
      payload: { state: this.state, lastMove: { type: 'GUESS', cardIndex: msg.payload.cardIndex } as Move },
    });

    await saveGameState(this.roomCode, this.state);

    if (newState.phase === 'game_end') {
      await this.handleGameEnd();
    } else if (newState.phase === 'clue_given' && newState.activeTeam !== codenamesState.activeTeam) {
      // Turn ended — notify
      await this.broadcast({
        type: 'CODENAMES_TURN_ENDED',
        payload: { nextTeam: newState.activeTeam, startingTeam: newState.startingTeam },
      } as ServerMessage);
    }
  }

  private async handleCodenamesPass(
    _msg: Extract<ClientMessage, { type: 'CODENAMES_PASS' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'codenames') return;
    if (conn.isSpectator) return;

    const codenamesState = this.state as import('@bored-games/shared').CodenamesState;
    const player = codenamesState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.role !== 'operative' || player.team !== codenamesState.activeTeam) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'Only an operative on the active team can pass.' },
      } as ServerMessage);
    }

    const engine = getEngine('codenames');
    const result = engine.applyMove(codenamesState, { type: 'PASS' }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Cannot pass.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newState = result.state as import('@bored-games/shared').CodenamesState;

    await this.broadcast({
      type: 'CODENAMES_TURN_ENDED',
      payload: { nextTeam: newState.activeTeam, startingTeam: newState.startingTeam },
    } as ServerMessage);

    await this.broadcast({
      type: 'STATE_UPDATE',
      payload: { state: this.state, lastMove: { type: 'PASS' } as Move },
    });

    await saveGameState(this.roomCode, this.state);

    if (newState.phase === 'game_end') {
      await this.handleGameEnd();
    }
  }

  // ----- Werewolf Role Assignment -----

  /**
   * Assign secret roles to all Werewolf players.
   * Each player receives their role privately via WEREWOLF_ROLE_ASSIGNED.
   * Werewolves also see their teammates.
   */
  private async assignWerewolfRoles(
    room: Room,
    playerIds: string[]
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'werewolf') return;

    const werewolfState = this.state as import('@bored-games/shared').WerewolfState;

    // Build display name map
    const playerNames: Record<string, string> = {};
    for (const player of room.players) {
      playerNames[player.sessionId] = player.displayName;
    }

    // Assign roles using the engine's exported helper
    const { assignWerewolfRoles } = await import('@bored-games/shared/games/ultimate-werewolf').catch(() => {
      return {
        assignWerewolfRoles: (_players: string[], _names: Record<string, string>) => {
          // Minimal fallback — unlikely to be needed since the engine is imported above
          return _players.map((sessionId) => ({
            sessionId,
            displayName: _names[sessionId] ?? 'Player',
            role: 'villager' as import('@bored-games/shared').WerewolfRole,
            isDead: false,
            hasVoted: false,
          }));
        },
      };
    });

    const playerStates = assignWerewolfRoles(playerIds, playerNames);
    this.werewolfPlayerStates = playerStates;

    // Inject playerStates into state
    this.state = {
      ...werewolfState,
      playerStates,
      phase: 'night',
      nightNumber: 1,
      phaseStartedAt: Date.now(),
      updatedAt: Date.now(),
    } as GameState;

    // Send private role info to each player
    for (const ps of playerStates) {
      const teammates = ps.role === 'werewolf'
        ? playerStates.filter((p) => p.role === 'werewolf' && p.sessionId !== ps.sessionId).map((p) => p.sessionId)
        : undefined;

      this.sendTo(ps.sessionId, {
        type: 'WEREWOLF_ROLE_ASSIGNED',
        payload: {
          role: ps.role!,
          teammates,
        },
      } as ServerMessage);
    }

    // Broadcast initial night phase
    await this.broadcast({
      type: 'WEREWOLF_PHASE_CHANGE',
      payload: {
        phase: 'night',
        nightNumber: 1,
        phaseStartedAt: Date.now(),
      },
    } as ServerMessage);

    await saveGameState(this.roomCode, this.state);
  }

  // ----- Werewolf Message Handlers -----

  private async handleWerewolfKill(
    msg: Extract<ClientMessage, { type: 'WEREWOLF_KILL' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'werewolf') return;
    if (conn.isSpectator) return;

    const werewolfState = this.state as import('@bored-games/shared').WerewolfState;
    const player = werewolfState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.role !== 'werewolf') {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'Only Werewolves can make a kill.' },
      } as ServerMessage);
    }
    if (player.isDead) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'You are dead.' },
      } as ServerMessage);
    }

    const engine = getEngine('werewolf');
    const result = engine.applyMove(werewolfState, { type: 'WEREWOLF_KILL', target: msg.payload.target }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid kill.' },
      } as ServerMessage);
    }

    this.state = result.state;

    // Notify that the werewolf acted (private confirmation only)
    this.sendTo(conn.sessionId, {
      type: 'WEREWOLF_NIGHT_ACTION',
      payload: { playerId: conn.sessionId, action: 'kill' },
    } as ServerMessage);

    // Check if all night actions are in — resolve night
    const newWW = result.state as import('@bored-games/shared').WerewolfState;
    const livingPlayers = newWW.playerStates.filter((p) => !p.isDead);
    const allNightActionsDone = livingPlayers.every(
      (p) => (p.role !== 'werewolf' && p.role !== 'seer') || newWW.nightActionsReceived.includes(p.sessionId)
    );

    if (allNightActionsDone) {
      await this.resolveWerewolfNight(newWW);
    }

    await saveGameState(this.roomCode, this.state);
  }

  private async handleWerewolfPeek(
    msg: Extract<ClientMessage, { type: 'WEREWOLF_PEEK' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'werewolf') return;
    if (conn.isSpectator) return;

    const werewolfState = this.state as import('@bored-games/shared').WerewolfState;
    const player = werewolfState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.role !== 'seer') {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'Only the Seer can peek.' },
      } as ServerMessage);
    }
    if (player.isDead) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'You are dead.' },
      } as ServerMessage);
    }

    const engine = getEngine('werewolf');
    const result = engine.applyMove(werewolfState, { type: 'SEER_PEEK', target: msg.payload.target }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid peek.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newWW = result.state as import('@bored-games/shared').WerewolfState;

    // Send private peek result only to the seer
    const peekedRole = newWW.seerPeekResults[msg.payload.target];
    this.sendTo(conn.sessionId, {
      type: 'WEREWOLF_SEER_RESULT',
      payload: { target: msg.payload.target, role: peekedRole! },
    } as ServerMessage);

    this.sendTo(conn.sessionId, {
      type: 'WEREWOLF_NIGHT_ACTION',
      payload: { playerId: conn.sessionId, action: 'peek' },
    } as ServerMessage);

    // Check if all night actions are done
    const livingPlayers = newWW.playerStates.filter((p) => !p.isDead);
    const allNightActionsDone = livingPlayers.every(
      (p) => (p.role !== 'werewolf' && p.role !== 'seer') || newWW.nightActionsReceived.includes(p.sessionId)
    );

    if (allNightActionsDone) {
      await this.resolveWerewolfNight(newWW);
    }

    await saveGameState(this.roomCode, this.state);
  }

  private async handleWerewolfHunterShoot(
    msg: Extract<ClientMessage, { type: 'WEREWOLF_HUNTER_SHOOT' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'werewolf') return;
    if (conn.isSpectator) return;

    const werewolfState = this.state as import('@bored-games/shared').WerewolfState;
    const player = werewolfState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.role !== 'hunter') {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'Only the Hunter can shoot.' },
      } as ServerMessage);
    }
    if (!player.isDead) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'You must be dead to use this ability.' },
      } as ServerMessage);
    }

    const engine = getEngine('werewolf');
    const result = engine.applyMove(werewolfState, { type: 'HUNTER_SHOOT', target: msg.payload.target }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid shoot.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newWW = result.state as import('@bored-games/shared').WerewolfState;

    // Apply the hunter's kill immediately
    const hunterTarget = newWW.hunterKillTarget;
    if (hunterTarget) {
      const updatedPlayerStates = newWW.playerStates.map((p) =>
        p.sessionId === hunterTarget ? { ...p, isDead: true } : p
      );
      const finalPlayerStates = updatedPlayerStates;
      const finalDeadPlayers = [...newWW.deadPlayers, hunterTarget];
      const finalAlivePlayers = finalPlayerStates.filter((p) => !p.isDead).map((p) => p.sessionId);

      this.state = {
        ...newWW,
        playerStates: finalPlayerStates,
        deadPlayers: finalDeadPlayers,
        alivePlayers: finalAlivePlayers,
        updatedAt: Date.now(),
      } as GameState;

      await this.broadcast({
        type: 'WEREWOLF_DEATH',
        payload: { sessionId: hunterTarget, byHunter: true },
      } as ServerMessage);
    }

    await this.broadcast({
      type: 'WEREWOLF_NIGHT_ACTION',
      payload: { playerId: conn.sessionId, action: 'shoot' },
    } as ServerMessage);

    await saveGameState(this.roomCode, this.state);

    // Check win after hunter shoot
    const winResult = this.checkWerewolfWin(this.werewolfPlayerStates ?? []);
    if (winResult) {
      this.state = {
        ...this.state,
        phase: 'game_end',
        winner: winResult.winner,
        gameEndReason: winResult.reason,
        updatedAt: Date.now(),
      } as GameState;
      await this.broadcast({
        type: 'WEREWOLF_GAME_END',
        payload: { winner: winResult.winner, reason: winResult.reason },
      } as ServerMessage);
      await this.handleGameEnd();
    }
  }

  private async handleWerewolfVote(
    msg: Extract<ClientMessage, { type: 'WEREWOLF_VOTE' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'werewolf') return;
    if (conn.isSpectator) return;
    if (this.state.result) return;

    const werewolfState = this.state as import('@bored-games/shared').WerewolfState;
    const player = werewolfState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.isDead) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'You are dead.' },
      } as ServerMessage);
    }
    if (player.hasVoted) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'ALREADY_VOTED', message: 'You have already voted.' },
      } as ServerMessage);
    }

    const engine = getEngine('werewolf');
    const result = engine.applyMove(werewolfState, { type: 'VOTE', target: msg.payload.target }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid vote.' },
      } as ServerMessage);
    }

    this.state = result.state;
    const newWW = result.state as import('@bored-games/shared').WerewolfState;

    // Broadcast vote update to all
    await this.broadcast({
      type: 'WEREWOLF_VOTE_UPDATE',
      payload: { votes: newWW.votes, votesReceived: newWW.votesReceived },
    } as ServerMessage);

    // Check if voting is complete
    const livingPlayers = newWW.playerStates.filter((p) => !p.isDead);
    if (newWW.votesReceived.length >= livingPlayers.length) {
      await this.resolveWerewolfVote(newWW);
    }

    await saveGameState(this.roomCode, this.state);
  }

  private async handleWerewolfPass(
    _msg: Extract<ClientMessage, { type: 'WEREWOLF_PASS' }>,
    conn: Connection
  ): Promise<void> {
    if (!this.state || this.state.gameType !== 'werewolf') return;
    if (conn.isSpectator) return;

    const werewolfState = this.state as import('@bored-games/shared').WerewolfState;
    const player = werewolfState.playerStates.find((p) => p.sessionId === conn.sessionId);
    if (!player || player.isDead) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: 'INVALID_MOVE', message: 'You are dead.' },
      } as ServerMessage);
    }

    const engine = getEngine('werewolf');
    const result = engine.applyMove(werewolfState, { type: 'PASS' }, conn.sessionId);

    if (!result.ok || !result.state) {
      return this.sendTo(conn.sessionId, {
        type: 'ERROR',
        payload: { code: result.error?.code ?? 'INVALID_MOVE', message: result.error?.message ?? 'Invalid pass.' },
      } as ServerMessage);
    }

    this.state = result.state;

    this.sendTo(conn.sessionId, {
      type: 'WEREWOLF_NIGHT_ACTION',
      payload: { playerId: conn.sessionId, action: 'pass' },
    } as ServerMessage);

    const newWW = result.state as import('@bored-games/shared').WerewolfState;
    const livingPlayers = newWW.playerStates.filter((p) => !p.isDead);
    const allNightActionsDone = livingPlayers.every(
      (p) => (p.role !== 'werewolf' && p.role !== 'seer') || newWW.nightActionsReceived.includes(p.sessionId)
    );

    if (allNightActionsDone) {
      await this.resolveWerewolfNight(newWW);
    }

    await saveGameState(this.roomCode, this.state);
  }

  // ----- Werewolf Phase Resolution -----

  /**
   * Check the Werewolf win condition given current player states.
   * Mirrors the engine's internal checkWin logic.
   */
  private checkWerewolfWin(playerStates: WerewolfPlayerState[]): { winner: 'villagers' | 'werewolves'; reason: string } | null {
    let villagers = 0;
    let werewolves = 0;
    for (const p of playerStates) {
      if (p.isDead) continue;
      if (p.role === 'werewolf') werewolves++;
      else villagers++;
    }
    if (werewolves === 0) {
      return { winner: 'villagers', reason: 'All Werewolves have been eliminated.' };
    }
    if (werewolves >= villagers) {
      return { winner: 'werewolves', reason: 'Werewolves outnumber the Villagers.' };
    }
    return null;
  }

  /**
   * Resolve the night phase: apply werewolf kill, check for hunter death,
   * then transition to day/voting or game_end.
   */
  private async resolveWerewolfNight(werewolfState: import('@bored-games/shared').WerewolfState): Promise<void> {
    const killTarget = werewolfState.werewolfKillTarget;
    let finalPlayerStates = werewolfState.playerStates;
    let finalDeadPlayers = werewolfState.deadPlayers;
    let finalAlivePlayers = werewolfState.alivePlayers;

    if (killTarget) {
      finalPlayerStates = finalPlayerStates.map((p) =>
        p.sessionId === killTarget ? { ...p, isDead: true } : p
      );
      finalDeadPlayers = [...finalDeadPlayers, killTarget];
      finalAlivePlayers = finalPlayerStates.filter((p) => !p.isDead).map((p) => p.sessionId);

      await this.broadcast({
        type: 'WEREWOLF_DEATH',
        payload: { sessionId: killTarget, byHunter: false },
      } as ServerMessage);

      await this.broadcast({
        type: 'WEREWOLF_KILL_RESULT',
        payload: { target: killTarget, died: true, byHunter: false },
      } as ServerMessage);
    }

    // Check win condition
    const winResult = this.checkWerewolfWin(finalPlayerStates);
    if (winResult) {
      const endState: WerewolfState = {
        ...werewolfState,
        playerStates: finalPlayerStates,
        deadPlayers: finalDeadPlayers,
        alivePlayers: finalAlivePlayers,
        phase: 'game_end',
        winner: winResult.winner,
        gameEndReason: winResult.reason,
        updatedAt: Date.now(),
      };
      this.state = endState;
      await this.broadcast({
        type: 'WEREWOLF_GAME_END',
        payload: { winner: winResult.winner, reason: winResult.reason },
      } as ServerMessage);
      await this.broadcast({
        type: 'WEREWOLF_PHASE_CHANGE',
        payload: { phase: 'game_end', phaseStartedAt: Date.now() },
      } as ServerMessage);
      await saveGameState(this.roomCode, this.state);
      await this.handleGameEnd();
      return;
    }

    // Check if eliminated player is hunter → they get to shoot
    const killedPlayer = finalPlayerStates.find((p) => p.sessionId === killTarget);
    if (killedPlayer?.role === 'hunter') {
      const hunterState: WerewolfState = {
        ...werewolfState,
        playerStates: finalPlayerStates,
        deadPlayers: finalDeadPlayers,
        alivePlayers: finalAlivePlayers,
        phase: 'voting', // stay in voting until hunter shoots
        votes: {},
        votesReceived: [],
        nightActionsReceived: [],
        werewolfKillTarget: null,
        seerPeekResults: {},
        phaseStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.state = hunterState;
      await this.broadcast({
        type: 'WEREWOLF_PHASE_CHANGE',
        payload: { phase: 'voting', phaseStartedAt: Date.now() },
      } as ServerMessage);
      await saveGameState(this.roomCode, this.state);
      return;
    }

    // Transition to day discussion
    const dayState: WerewolfState = {
      ...werewolfState,
      playerStates: finalPlayerStates,
      deadPlayers: finalDeadPlayers,
      alivePlayers: finalAlivePlayers,
      phase: 'day',
      votes: {},
      votesReceived: [],
      nightActionsReceived: [],
      werewolfKillTarget: null,
      seerPeekResults: {},
      dayStarted: true,
      phaseStartedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state = dayState;
    await this.broadcast({
      type: 'WEREWOLF_PHASE_CHANGE',
      payload: { phase: 'day', nightNumber: werewolfState.nightNumber, phaseStartedAt: Date.now() },
    } as ServerMessage);
    await saveGameState(this.roomCode, this.state);
  }

  /**
   * Resolve the voting phase: tally votes, eliminate player,
   * then transition to night or game_end.
   */
  private async resolveWerewolfVote(werewolfState: import('@bored-games/shared').WerewolfState): Promise<void> {
    const voteTally: Record<string, number> = {};
    for (const targetId of Object.values(werewolfState.votes)) {
      voteTally[targetId] = (voteTally[targetId] ?? 0) + 1;
    }

    const livingPlayers = werewolfState.playerStates.filter((p) => !p.isDead);
    const maxVotes = Math.max(...Object.values(voteTally));
    const topVoted = Object.keys(voteTally).filter((k) => voteTally[k] === maxVotes);

    if (topVoted.length > 1) {
      // Tie — revote
      const tieState: WerewolfState = {
        ...werewolfState,
        phase: 'voting',
        votes: {},
        votesReceived: [],
        consecutiveTies: werewolfState.consecutiveTies + 1,
        phaseStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.state = tieState;
      await this.broadcast({
        type: 'WEREWOLF_VOTE_RESULT',
        payload: { eliminated: null, tied: true },
      } as ServerMessage);
      await saveGameState(this.roomCode, this.state);
      return;
    }

    const eliminated = topVoted[0]!;
    const eliminatedPlayer = werewolfState.playerStates.find((p) => p.sessionId === eliminated);
    const eliminatedRole = eliminatedPlayer?.role;

    const finalPlayerStates = werewolfState.playerStates.map((p) =>
      p.sessionId === eliminated ? { ...p, isDead: true } : p
    );
    const finalDeadPlayers = [...werewolfState.deadPlayers, eliminated];
    const finalAlivePlayers = finalPlayerStates.filter((p) => !p.isDead).map((p) => p.sessionId);

    await this.broadcast({
      type: 'WEREWOLF_DEATH',
      payload: { sessionId: eliminated, byHunter: false },
    } as ServerMessage);

    await this.broadcast({
      type: 'WEREWOLF_VOTE_RESULT',
      payload: { eliminated, tied: false },
    } as ServerMessage);

    // Check win condition
    const winResult = this.checkWerewolfWin(finalPlayerStates);
    if (winResult) {
      const endState: WerewolfState = {
        ...werewolfState,
        playerStates: finalPlayerStates,
        deadPlayers: finalDeadPlayers,
        alivePlayers: finalAlivePlayers,
        phase: 'game_end',
        winner: winResult.winner,
        gameEndReason: winResult.reason,
        phaseStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.state = endState;
      await this.broadcast({
        type: 'WEREWOLF_GAME_END',
        payload: { winner: winResult.winner, reason: winResult.reason },
      } as ServerMessage);
      await saveGameState(this.roomCode, this.state);
      await this.handleGameEnd();
      return;
    }

    // If eliminated is hunter → they get a shoot action before next night
    if (eliminatedRole === 'hunter') {
      const hunterState: WerewolfState = {
        ...werewolfState,
        playerStates: finalPlayerStates,
        deadPlayers: finalDeadPlayers,
        alivePlayers: finalAlivePlayers,
        phase: 'voting', // stay in voting until hunter shoots
        consecutiveTies: 0,
        phaseStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.state = hunterState;
      await this.broadcast({
        type: 'WEREWOLF_PHASE_CHANGE',
        payload: { phase: 'voting', phaseStartedAt: Date.now() },
      } as ServerMessage);
      await saveGameState(this.roomCode, this.state);
      return;
    }

    // Transition to next night
    const nextNightState: WerewolfState = {
      ...werewolfState,
      playerStates: finalPlayerStates,
      deadPlayers: finalDeadPlayers,
      alivePlayers: finalAlivePlayers,
      phase: 'night',
      votes: {},
      votesReceived: [],
      nightActionsReceived: [],
      werewolfKillTarget: null,
      seerPeekResults: {},
      hunterKillTarget: null,
      consecutiveTies: 0,
      nightNumber: (werewolfState.nightNumber ?? 0) + 1,
      phaseStartedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state = nextNightState;
    await this.broadcast({
      type: 'WEREWOLF_PHASE_CHANGE',
      payload: { phase: 'night', nightNumber: nextNightState.nightNumber, phaseStartedAt: Date.now() },
    } as ServerMessage);
    await saveGameState(this.roomCode, this.state);
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
