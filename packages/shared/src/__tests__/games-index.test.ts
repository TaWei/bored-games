import { describe, test, expect } from 'bun:test';
import {
  gameEngines,
  getEngine,
  isGameAvailable,
  getGameInfoList,
  getGameInfo,
} from '../games/index';
import type { GameType } from '../types';

describe('gameEngines registry', () => {
  test('contains tic-tac-toe', () => {
    expect(gameEngines['tic-tac-toe']).toBeDefined();
  });

  test('contains avalon', () => {
    expect(gameEngines['avalon']).toBeDefined();
  });

  test('contains codenames', () => {
    expect(gameEngines['codenames']).toBeDefined();
  });

  test('contains werewolf', () => {
    expect(gameEngines['werewolf']).toBeDefined();
  });

  test('contains chess', () => {
    expect(gameEngines['chess']).toBeDefined();
  });
});

describe('getEngine', () => {
  test('returns engine for valid game type', () => {
    const engine = getEngine('tic-tac-toe');
    expect(engine.gameType).toBe('tic-tac-toe');
  });

  test('returns chess engine for chess', () => {
    const engine = getEngine('chess');
    expect(engine.gameType).toBe('chess');
  });

  test('throws for unknown game type', () => {
    expect(() => getEngine('monopoly' as GameType)).toThrow();
    expect(() => getEngine('connect-four' as GameType)).toThrow();
  });

  test('throws with helpful error message listing available games', () => {
    try {
      getEngine('connect-four' as GameType);
    } catch (e: any) {
      expect(e.message).toContain('tic-tac-toe');
      expect(e.message).toContain('avalon');
      expect(e.message).toContain('codenames');
      expect(e.message).toContain('werewolf');
      expect(e.message).toContain('chess');
    }
  });
});

describe('isGameAvailable', () => {
  test('returns true for tic-tac-toe', () => {
    expect(isGameAvailable('tic-tac-toe')).toBe(true);
  });

  test('returns true for avalon', () => {
    expect(isGameAvailable('avalon')).toBe(true);
  });

  test('returns true for codenames', () => {
    expect(isGameAvailable('codenames')).toBe(true);
  });

  test('returns true for werewolf', () => {
    expect(isGameAvailable('werewolf')).toBe(true);
  });

  test('returns true for chess', () => {
    expect(isGameAvailable('chess')).toBe(true);
  });

  test('returns false for unknown game types', () => {
    expect(isGameAvailable('monopoly' as GameType)).toBe(false);
    expect(isGameAvailable('connect-four' as GameType)).toBe(false);
  });
});

describe('getGameInfoList', () => {
  test('returns all available games', () => {
    const { games } = getGameInfoList();
    const types = games.map(g => g.gameType);
    expect(types).toContain('tic-tac-toe');
    expect(types).toContain('avalon');
    expect(types).toContain('codenames');
    expect(types).toContain('werewolf');
    expect(types).toContain('chess');
  });

  test('each game has required metadata fields', () => {
    const { games } = getGameInfoList();
    for (const game of games) {
      expect(game.gameType).toBeDefined();
      expect(game.name).toBeTruthy();
      expect(game.description).toBeTruthy();
      expect(game.minPlayers).toBeGreaterThan(0);
      expect(game.maxPlayers).toBeGreaterThanOrEqual(game.minPlayers);
      expect(game.slug).toBeDefined();
      expect(game.icon).toBeDefined();
    }
  });

  test('games match their engine properties', () => {
    const { games } = getGameInfoList();
    for (const game of games) {
      const engine = getEngine(game.gameType);
      expect(game.name).toBe(engine.name);
      expect(game.description).toBe(engine.description);
      expect(game.minPlayers).toBe(engine.minPlayers);
      expect(game.maxPlayers).toBe(engine.maxPlayers);
      expect(game.slug).toBe(engine.slug);
      expect(game.icon).toBe(engine.icon);
    }
  });
});

describe('getGameInfo', () => {
  test('returns game info for valid game type', () => {
    const game = getGameInfo('codenames');
    expect(game).toBeTruthy();
    expect(game!.name).toBe('Codenames');
    expect(game!.slug).toBe('codenames');
  });

  test('returns game info for chess', () => {
    const game = getGameInfo('chess');
    expect(game).toBeTruthy();
    expect(game!.name).toBe('Chess');
    expect(game!.slug).toBe('chess');
  });

  test('returns null for unknown game type', () => {
    expect(getGameInfo('monopoly' as GameType)).toBeNull();
    expect(getGameInfo('connect-four' as GameType)).toBeNull();
  });
});
