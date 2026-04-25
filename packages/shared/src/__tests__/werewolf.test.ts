import { describe, test, expect } from 'bun:test';
import { werewolfEngine, assignWerewolfRoles } from '../games/werewolf';
import type { WerewolfState, WerewolfMove } from '../types';

const players6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

function makeState(overrides: Partial<WerewolfState> = {}): WerewolfState {
  return {
    gameType: 'werewolf',
    players: [...players6],
    turn: 'p1',
    moveCount: 0,
    phase: 'waiting',
    nightNumber: 0,
    phaseStartedAt: Date.now(),
    playerStates: players6.map(id => ({
      sessionId: id,
      displayName: `Player ${id}`,
      isDead: false,
      isAlive: true,
      hasVoted: false,
    })),
    lastKill: null,
    lastProtect: null,
    lastPeek: null,
    seerPeekResults: {},
    hunterKillTarget: null,
    deadPlayers: [],
    winner: null,
    gameEndReason: undefined,
    votes: {},
    votesReceived: [],
    eliminatedToday: [],
    alivePlayers: [...players6],
    werewolfKillTarget: null,
    nightActionsReceived: [],
    consecutiveTies: 0,
    dayStarted: false,
    updatedAt: Date.now(),
    ...overrides,
  } as WerewolfState;
}

describe('assignWerewolfRoles', () => {
  test('assigns correct number of roles for 6 players', () => {
    const result = assignWerewolfRoles(players6, {});
    expect(result).toHaveLength(6);
  });

  test('all players have a role assigned', () => {
    const result = assignWerewolfRoles(players6, {});
    for (const player of result) {
      expect(player.role).toBeDefined();
    }
  });

  test('werewolf players have isWerewolf=true', () => {
    const result = assignWerewolfRoles(players6, {});
    const werewolves = result.filter(p => p.role === 'werewolf');
    for (const ww of werewolves) {
      expect(ww.isWerewolf).toBe(true);
    }
  });

  test('all players start alive', () => {
    const result = assignWerewolfRoles(players6, {});
    for (const player of result) {
      expect(player.isDead).toBe(false);
      expect(player.isAlive).toBe(true);
    }
  });

  test('playerNames are used when provided', () => {
    const result = assignWerewolfRoles(players6, { p1: 'Alice', p2: 'Bob' });
    const p1 = result.find(p => p.sessionId === 'p1')!;
    expect(p1.displayName).toBe('Alice');
  });

  test('defaults to "Player" when no name provided', () => {
    const result = assignWerewolfRoles(['x'], {});
    expect(result[0]!.displayName).toBe('Player');
  });
});

describe('werewolfEngine.createInitialState', () => {
  test('starts in waiting phase', () => {
    const state = werewolfEngine.createInitialState(players6);
    expect(state.phase).toBe('waiting');
  });

  test('nightNumber starts at 0', () => {
    const state = werewolfEngine.createInitialState(players6);
    expect(state.nightNumber).toBe(0);
  });

  test('all players start alive', () => {
    const state = werewolfEngine.createInitialState(players6);
    expect(state.alivePlayers).toEqual(players6);
    expect(state.deadPlayers).toHaveLength(0);
  });

  test('winner is null initially', () => {
    const state = werewolfEngine.createInitialState(players6);
    expect(state.winner).toBeNull();
  });

  test('all night tracking fields are null initially', () => {
    const state = werewolfEngine.createInitialState(players6);
    expect(state.lastKill).toBeNull();
    expect(state.lastProtect).toBeNull();
    expect(state.lastPeek).toBeNull();
    expect(state.hunterKillTarget).toBeNull();
    expect(state.werewolfKillTarget).toBeNull();
  });
});

describe('werewolfEngine.applyMove — phase rejections', () => {
  test('rejects move in waiting phase', () => {
    const state = makeState({ phase: 'waiting' });
    const move: WerewolfMove = { type: 'WEREWOLF_VOTE', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_MOVE');
  });

  test('rejects move in game_end phase', () => {
    const state = makeState({ phase: 'game_end' });
    const move: WerewolfMove = { type: 'WEREWOLF_VOTE', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('GAME_OVER');
  });

  test('rejects move in role_assignment phase', () => {
    const state = makeState({ phase: 'role_assignment' });
    const move: WerewolfMove = { type: 'WEREWOLF_VOTE', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
  });

  test('rejects move from player not in game', () => {
    const state = makeState({ phase: 'night' });
    const move: WerewolfMove = { type: 'WEREWOLF_VOTE', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'stranger');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('PLAYER_NOT_IN_GAME');
  });

  test('rejects move from dead player', () => {
    const state = makeState({
      phase: 'night',
      playerStates: players6.map(id => ({
        sessionId: id,
        displayName: `P${id}`,
        isDead: id === 'p1',
        isAlive: id !== 'p1',
        hasVoted: false,
      })),
    });
    const move: WerewolfMove = { type: 'WEREWOLF_VOTE', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_MOVE');
  });

  test('rejects move in night phase (not yet implemented)', () => {
    const state = makeState({ phase: 'night' });
    const move: WerewolfMove = { type: 'WEREWOLF_KILL', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.message).toContain('night');
  });

  test('rejects move in day phase', () => {
    const state = makeState({ phase: 'day' });
    const move: WerewolfMove = { type: 'WEREWOLF_KILL', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
  });

  test('rejects move in voting phase', () => {
    const state = makeState({ phase: 'voting' });
    const move: WerewolfMove = { type: 'WEREWOLF_VOTE', target: 'p2' };
    const result = werewolfEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
  });
});

describe('werewolfEngine.checkGameEnd', () => {
  test('returns null when game is ongoing', () => {
    const state = makeState({ phase: 'night' });
    expect(werewolfEngine.checkGameEnd(state)).toBeNull();
  });

  test('returns werewolves victory when winner is set', () => {
    const state = makeState({ phase: 'game_end', winner: 'werewolves' });
    const result = werewolfEngine.checkGameEnd(state);
    expect(result).toBeTruthy();
    expect(result!.winner).toBe('werewolves');
  });

  test('returns villagers victory when winner is set', () => {
    const state = makeState({ phase: 'game_end', winner: 'villagers' });
    const result = werewolfEngine.checkGameEnd(state);
    expect(result).toBeTruthy();
    expect(result!.winner).toBe('villagers');
  });
});

describe('werewolfEngine.serialize/deserialize', () => {
  test('roundtrips correctly', () => {
    const original = makeState({ phase: 'night' });
    const serialized = werewolfEngine.serialize(original);
    const deserialized = werewolfEngine.deserialize(serialized);
    expect(deserialized).toEqual(original);
  });
});
