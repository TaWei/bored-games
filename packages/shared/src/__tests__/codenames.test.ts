import { describe, test, expect } from 'bun:test';
import { codenamesEngine, generateGrid, assignCodenamesRoles } from '../games/codenames';
import type { CodenamesState } from '../types';

const SPY_RED = 'spy-red';
const OP_RED = 'op-red';
const SPY_BLUE = 'spy-blue';
const OP_BLUE = 'op-blue';
const players4 = [SPY_RED, OP_RED, SPY_BLUE, OP_BLUE];

function makeState(overrides: Partial<CodenamesState> = {}): CodenamesState {
  const grid = generateGrid();
  return {
    gameType: 'codenames',
    players: [...players4],
    turn: SPY_RED,
    moveCount: 0,
    phase: 'waiting',
    grid,
    activeTeam: 'red',
    currentClue: null,
    guessesRemaining: 0,
    lastRevealedIndex: null,
    startingTeam: 'red',
    playerStates: [
      { sessionId: SPY_RED, displayName: 'Red Spy', team: 'red', role: 'spymaster' },
      { sessionId: OP_RED, displayName: 'Red Op', team: 'red', role: 'operative' },
      { sessionId: SPY_BLUE, displayName: 'Blue Spy', team: 'blue', role: 'spymaster' },
      { sessionId: OP_BLUE, displayName: 'Blue Op', team: 'blue', role: 'operative' },
    ],
    winner: null,
    gameEndReason: undefined,
    updatedAt: Date.now(),
    ...overrides,
  } as CodenamesState;
}

describe('generateGrid', () => {
  test('generates exactly 25 cards', () => {
    const grid = generateGrid();
    expect(grid).toHaveLength(25);
  });

  test('all cards start unrevealed', () => {
    const grid = generateGrid();
    for (const card of grid) {
      expect(card.revealed).toBe(false);
    }
  });

  test('card type distribution: 9 red, 8 blue, 7 bystander, 1 assassin', () => {
    const grid = generateGrid();
    const counts = { red: 0, blue: 0, bystander: 0, assassin: 0 };
    for (const card of grid) {
      counts[card.type]++;
    }
    expect(counts.red).toBe(9);
    expect(counts.blue).toBe(8);
    expect(counts.bystander).toBe(7);
    expect(counts.assassin).toBe(1);
  });

  test('all words are unique within a grid', () => {
    const grid = generateGrid();
    const words = grid.map(c => c.word);
    const unique = new Set(words);
    expect(unique.size).toBe(25);
  });

  test('all words are uppercase', () => {
    const grid = generateGrid();
    for (const card of grid) {
      expect(card.word).toBe(card.word.toUpperCase());
    }
  });
});

describe('assignCodenamesRoles', () => {
  test('even player count: equal teams', () => {
    const players = ['p1', 'p2', 'p3', 'p4'];
    const result = assignCodenamesRoles(players, {}, []);
    const red = result.filter(p => p.team === 'red');
    const blue = result.filter(p => p.team === 'blue');
    expect(red).toHaveLength(2);
    expect(blue).toHaveLength(2);
  });

  test('odd player count: first team gets extra player', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const result = assignCodenamesRoles(players, {}, []);
    const red = result.filter(p => p.team === 'red');
    const blue = result.filter(p => p.team === 'blue');
    expect(red).toHaveLength(3);
    expect(blue).toHaveLength(2);
  });

  test('assigns exactly 2 spymasters', () => {
    const players = ['p1', 'p2', 'p3', 'p4'];
    const result = assignCodenamesRoles(players, {}, []);
    const spymasters = result.filter(p => p.role === 'spymaster');
    expect(spymasters).toHaveLength(2);
  });
});

describe('codenamesEngine.createInitialState', () => {
  test('phase starts as waiting', () => {
    const state = codenamesEngine.createInitialState(players4);
    expect(state.phase).toBe('waiting');
  });

  test('grid is empty (server must call generateGrid separately)', () => {
    const state = codenamesEngine.createInitialState(players4);
    expect(state.grid).toHaveLength(0);
  });

  test('activeTeam starts as red', () => {
    const state = codenamesEngine.createInitialState(players4);
    expect(state.activeTeam).toBe('red');
  });

  test('assigns 2 spymasters and 2 operatives', () => {
    const state = codenamesEngine.createInitialState(players4);
    const spymasters = state.playerStates.filter(p => p.role === 'spymaster');
    const operatives = state.playerStates.filter(p => p.role === 'operative');
    expect(spymasters).toHaveLength(2);
    expect(operatives).toHaveLength(2);
  });
});

describe('codenamesEngine.applyMove — GIVE_CLUE', () => {
  test('spymaster can give a clue in clue phase', () => {
    const state = makeState({ phase: 'clue' });
    const result = codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 2 }, SPY_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.currentClue).toEqual({ word: 'ANIMAL', number: 2 });
    expect(result.state!.phase).toBe('guessing');
    expect(result.state!.guessesRemaining).toBe(3);
  });

  test('operative cannot give a clue', () => {
    const state = makeState({ phase: 'clue' });
    const result = codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 2 }, OP_RED);
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_MOVE');
  });

  test('opposing team spy cannot give clue', () => {
    const state = makeState({ phase: 'clue' });
    const result = codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 2 }, SPY_BLUE);
    expect(result.ok).toBe(false);
  });

  test('clue word cannot be on the board', () => {
    const grid = generateGrid();
    const wordOnBoard = grid[0]!.word;
    const state = makeState({ phase: 'clue', grid });
    const result = codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: wordOnBoard.toLowerCase(), number: 1 }, SPY_RED);
    expect(result.ok).toBe(false);
    expect(result.error!.message).toContain('board');
  });

  test('clue number must be 0-9', () => {
    const state = makeState({ phase: 'clue' });
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: -1 }, SPY_RED).ok).toBe(false);
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 10 }, SPY_RED).ok).toBe(false);
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 0 }, SPY_RED).ok).toBe(true);
  });

  test('clue word cannot be empty', () => {
    const state = makeState({ phase: 'clue' });
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: '', number: 1 }, SPY_RED).ok).toBe(false);
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: '   ', number: 1 }, SPY_RED).ok).toBe(false);
  });
});

describe('codenamesEngine.applyMove — GUESS', () => {
  function makeGuessingState(): CodenamesState {
    return makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 3,
    });
  }

  test('operative can guess a card', () => {
    const state = makeGuessingState();
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.grid[0]!.revealed).toBe(true);
    expect(result.state!.moveCount).toBe(1);
  });

  test('spymaster cannot guess', () => {
    const state = makeGuessingState();
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, SPY_RED);
    expect(result.ok).toBe(false);
  });

  test('wrong team operative cannot guess', () => {
    const state = makeGuessingState();
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_BLUE);
    expect(result.ok).toBe(false);
  });

  test('rejects out-of-range card index', () => {
    const state = makeGuessingState();
    expect(codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: -1 }, OP_RED).ok).toBe(false);
    expect(codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 25 }, OP_RED).ok).toBe(false);
  });

  test('rejects already revealed card (uses returned state)', () => {
    const state = makeGuessingState();
    const afterFirst = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(afterFirst.ok).toBe(true);
    const result = codenamesEngine.applyMove(afterFirst.state!, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_MOVE');
  });

  test('revealing bystander ends turn and switches to blue', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 3,
      grid: [
        { word: 'CAT', type: 'bystander', revealed: false },
        ...Array.from({ length: 24 }, (_, i) => ({ word: 'WORD' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('clue');
    expect(result.state!.activeTeam).toBe('blue');
  });

  test('finding friendly agent continues game when more agents remain', () => {
    // Grid has 9 red cards total; revealing 1 leaves 8, game continues
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 3,
      grid: [
        { word: 'CAT', type: 'red', revealed: false },
        { word: 'DOG', type: 'red', revealed: false },
        { word: 'BIRD', type: 'red', revealed: false },
        { word: 'FISH', type: 'red', revealed: false },
        { word: 'BEAR', type: 'red', revealed: false },
        { word: 'WOLF', type: 'red', revealed: false },
        { word: 'DEER', type: 'red', revealed: false },
        { word: 'MOOSE', type: 'red', revealed: false },
        { word: 'SEAL', type: 'red', revealed: false },
        { word: 'BLUE1', type: 'blue', revealed: false },
        { word: 'BLUE2', type: 'blue', revealed: false },
        ...Array.from({ length: 14 }, (_, i) => ({ word: 'WORD' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    // Game continues - 8 red cards remain
    expect(result.state!.phase).toBe('guessing');
    expect(result.state!.grid[0]!.revealed).toBe(true);
    expect(result.state!.guessesRemaining).toBe(2);
  });

  test('finding friendly agent when it is the last ends game with that team winning', () => {
    // Grid has 1 red card remaining; revealing it ends the game
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 3,
      grid: [
        { word: 'CAT', type: 'red', revealed: false },
        { word: 'DOG', type: 'red', revealed: true },
        ...Array.from({ length: 23 }, (_, i) => ({ word: 'WORD' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('game_end');
    expect(result.state!.winner).toBe('red');
    expect(result.state!.gameEndReason).toContain('found all their agents');
  });

  test('guesses exhausted after finding friendly agent ends turn (not game)', () => {
    // After finding a friendly agent, if guesses run out, turn ends (not game)
    // Only 1 guess remaining, grid has 9 red cards
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 1 },
      guessesRemaining: 1,
      grid: [
        { word: 'CAT', type: 'red', revealed: false },
        { word: 'DOG', type: 'red', revealed: false },
        { word: 'BIRD', type: 'red', revealed: false },
        { word: 'FISH', type: 'red', revealed: false },
        { word: 'BEAR', type: 'red', revealed: false },
        { word: 'WOLF', type: 'red', revealed: false },
        { word: 'DEER', type: 'red', revealed: false },
        { word: 'MOOSE', type: 'red', revealed: false },
        { word: 'SEAL', type: 'red', revealed: false },
        ...Array.from({ length: 16 }, (_, i) => ({ word: 'WORD' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    // Turn ends, clue phase, other team goes
    expect(result.state!.phase).toBe('clue');
    expect(result.state!.activeTeam).toBe('blue');
    // But game continues - 8 red agents remain
  });

  test('finding last red agent card ends game with red as winner', () => {
    const grid = [
      { word: 'CAT', type: 'red' as const, revealed: false },
      { word: 'DOG', type: 'red' as const, revealed: true },
      ...Array.from({ length: 23 }, (_, i) => ({ word: 'WORD' + i, type: 'bystander' as const, revealed: false })),
    ];
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 2,
      grid,
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('game_end');
    expect(result.state!.winner).toBe('red');
  });
});

describe('codenamesEngine.applyMove — PASS', () => {
  test('operative can pass to end turn', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 3,
    });
    const result = codenamesEngine.applyMove(state, { type: 'PASS' }, OP_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('clue');
    expect(result.state!.activeTeam).toBe('blue');
  });
});

describe('codenamesEngine.applyMove — assassin', () => {
  test('revealing assassin causes that team to lose', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 5 },
      guessesRemaining: 5,
      grid: [
        { word: 'DEATH', type: 'assassin', revealed: false },
        ...Array.from({ length: 24 }, (_, i) => ({ word: 'WORD' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('game_end');
    expect(result.state!.winner).toBe('blue');
    expect(result.state!.gameEndReason).toContain('Assassin');
  });
});

describe('codenamesEngine.applyMove — game over states', () => {
  test('rejects moves in waiting phase', () => {
    const state = makeState({ phase: 'waiting' });
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'test', number: 1 }, SPY_RED).ok).toBe(false);
  });

  test('rejects moves after game ends', () => {
    const state = makeState({ phase: 'game_end', winner: 'red' });
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'test', number: 1 }, SPY_RED).ok).toBe(false);
  });

  test('rejects move from player not in game', () => {
    const state = makeState({ phase: 'clue' });
    expect(codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'test', number: 1 }, 'stranger').ok).toBe(false);
  });
});

describe('codenamesEngine.getValidMoves', () => {
  test('returns GIVE_CLUE placeholder for spymaster in clue phase', () => {
    const state = makeState({ phase: 'clue' });
    const moves = codenamesEngine.getValidMoves(state, SPY_RED);
    expect(moves).toContainEqual({ type: 'GIVE_CLUE', word: '', number: 0 });
  });

  test('returns empty for operative in clue phase', () => {
    const state = makeState({ phase: 'clue' });
    expect(codenamesEngine.getValidMoves(state, OP_RED)).toHaveLength(0);
  });

  test('returns GUESS moves for operative in guessing phase', () => {
    const state = makeState({ phase: 'guessing', activeTeam: 'red' });
    const moves = codenamesEngine.getValidMoves(state, OP_RED);
    expect(moves).toHaveLength(26);
    expect(moves).toContainEqual({ type: 'PASS' });
  });

  test('returns empty in game_end phase', () => {
    const state = makeState({ phase: 'game_end', winner: 'red' });
    expect(codenamesEngine.getValidMoves(state, SPY_RED)).toHaveLength(0);
  });
});

describe('codenamesEngine.checkGameEnd', () => {
  test('returns null when no winner', () => {
    const state = makeState();
    expect(codenamesEngine.checkGameEnd(state)).toBeNull();
  });

  test('returns game end when winner is set', () => {
    const state = makeState({ phase: 'game_end', winner: 'red', gameEndReason: 'FOUND_ALL_AGENTS' });
    const result = codenamesEngine.checkGameEnd(state);
    expect(result).toBeTruthy();
    expect(result!.winner).toBe('red');
  });
});

describe('codenamesEngine.isValidMove', () => {
  test('returns true for a valid clue move', () => {
    const state = makeState({ phase: 'clue' });
    expect(codenamesEngine.isValidMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 2 }, SPY_RED)).toBe(true);
  });

  test('returns false for an invalid clue move (wrong phase)', () => {
    const state = makeState({ phase: 'guessing' });
    expect(codenamesEngine.isValidMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 2 }, SPY_RED)).toBe(false);
  });

  test('returns true for a valid guess move', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 2,
    });
    expect(codenamesEngine.isValidMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED)).toBe(true);
  });

  test('returns false for a guess move on wrong team', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 2,
    });
    expect(codenamesEngine.isValidMove(state, { type: 'GUESS', cardIndex: 0 }, OP_BLUE)).toBe(false);
  });

  test('returns false after game ends', () => {
    const state = makeState({ phase: 'game_end', winner: 'red' });
    expect(codenamesEngine.isValidMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED)).toBe(false);
  });
});

describe('codenamesEngine.getValidMoves', () => {
  test('spymaster in clue phase gets GIVE_CLUE placeholder', () => {
    const state = makeState({ phase: 'clue', activeTeam: 'red' });
    const moves = codenamesEngine.getValidMoves(state, SPY_RED);
    expect(moves).toEqual([{ type: 'GIVE_CLUE', word: '', number: 0 }]);
  });

  test('operative in clue phase gets empty array', () => {
    const state = makeState({ phase: 'clue', activeTeam: 'red' });
    const moves = codenamesEngine.getValidMoves(state, OP_RED);
    expect(moves).toHaveLength(0);
  });

  test('operative in guessing phase gets all unrevealed card guesses + PASS', () => {
    // makeState generates a fresh 25-card grid
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      guessesRemaining: 3,
    });

    const moves = codenamesEngine.getValidMoves(state, OP_RED);
    // 25 unrevealed cards + PASS = 26 moves
    expect(moves).toHaveLength(26);
    expect(moves).toContainEqual({ type: 'PASS' });
    // All 25 card indices should be present
    for (let i = 0; i < 25; i++) {
      expect(moves).toContainEqual({ type: 'GUESS', cardIndex: i });
    }
  });

  test('spymaster in guessing phase gets empty array', () => {
    const state = makeState({ phase: 'guessing', activeTeam: 'red' });
    const moves = codenamesEngine.getValidMoves(state, SPY_RED);
    expect(moves).toHaveLength(0);
  });

  test('returns empty in waiting phase', () => {
    const state = makeState({ phase: 'waiting' });
    expect(codenamesEngine.getValidMoves(state, SPY_RED)).toHaveLength(0);
  });

  test('returns empty for unknown player', () => {
    const state = makeState({ phase: 'clue' });
    expect(codenamesEngine.getValidMoves(state, 'unknown')).toHaveLength(0);
  });
});

describe('codenamesEngine — team starting assignment', () => {
  test('startingTeam is set to red on createInitialState', () => {
    const state = codenamesEngine.createInitialState(players4);
    expect(state.startingTeam).toBe('red');
  });

  test('startingTeam remains red when red goes first', () => {
    const state = makeState({ phase: 'clue', activeTeam: 'red', startingTeam: 'red' });
    // Red spymaster gives clue
    const r1 = codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 1 }, SPY_RED);
    // Red operative guesses correctly but blue team will go next
    // Actually, red operative keeps guessing until done, then turn ends
    expect(r1.state!.startingTeam).toBe('red');
  });

  test('activeTeam alternates correctly after red turn ends', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 1 },
      guessesRemaining: 1,
      grid: [
        { word: 'CAT', type: 'bystander', revealed: false },
        ...Array.from({ length: 24 }, (_, i) => ({ word: 'W' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    // Red operative hits bystander → turn ends
    const r1 = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(r1.state!.activeTeam).toBe('blue');
    expect(r1.state!.phase).toBe('clue');
  });

  test('activeTeam alternates correctly after blue turn ends', () => {
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'blue',
      currentClue: { word: 'ANIMAL', number: 1 },
      guessesRemaining: 1,
      grid: [
        { word: 'CAT', type: 'bystander', revealed: false },
        ...Array.from({ length: 24 }, (_, i) => ({ word: 'W' + i, type: 'bystander' as const, revealed: false })),
      ],
    });
    const r1 = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_BLUE);
    expect(r1.state!.activeTeam).toBe('red');
    expect(r1.state!.phase).toBe('clue');
  });
});

describe('codenamesEngine — multi-round flow', () => {
  test('red then blue each give one clue and return to red', () => {
    let state = makeState({ phase: 'clue', activeTeam: 'red', startingTeam: 'red' });

    // Red gives clue
    const r1 = codenamesEngine.applyMove(state, { type: 'GIVE_CLUE', word: 'animal', number: 2 }, SPY_RED);
    expect(r1.state!.phase).toBe('guessing');
    expect(r1.state!.activeTeam).toBe('red');

    // Red operative guesses correctly, ending turn
    const r2 = codenamesEngine.applyMove(r1.state!, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    // (depending on what card it hits, turn may or may not end)

    // Simpler: red operative passes → team switches to blue, startingTeam also switches
    let s = makeState({ phase: 'guessing', activeTeam: 'red', currentClue: { word: 'ANIMAL', number: 2 }, guessesRemaining: 2, startingTeam: 'red' });
    s = codenamesEngine.applyMove(s, { type: 'PASS' }, OP_RED).state!;
    expect(s.phase).toBe('clue');
    expect(s.activeTeam).toBe('blue');
    // PASS switches startingTeam to the next team (blue), so next round starts with blue
    expect(s.startingTeam).toBe('blue');

    // Blue gives clue
    const b1 = codenamesEngine.applyMove(s, { type: 'GIVE_CLUE', word: 'color', number: 1 }, SPY_BLUE);
    expect(b1.state!.phase).toBe('guessing');
    expect(b1.state!.activeTeam).toBe('blue');

    // Blue operative passes
    let s2 = codenamesEngine.applyMove(b1.state!, { type: 'PASS' }, OP_BLUE).state!;
    expect(s2.phase).toBe('clue');
    expect(s2.activeTeam).toBe('red');
    // startingTeam stays with the original starting team
    expect(s2.startingTeam).toBe('red');
  });
});

describe('codenamesEngine — blue team winning path', () => {
  test('blue team wins by finding all their agents', () => {
    // 8 blue agents total — blue finds the last one
    const grid = [
      { word: 'AGENT1', type: 'blue' as const, revealed: true },
      { word: 'AGENT2', type: 'blue' as const, revealed: true },
      { word: 'AGENT3', type: 'blue' as const, revealed: true },
      { word: 'AGENT4', type: 'blue' as const, revealed: true },
      { word: 'AGENT5', type: 'blue' as const, revealed: true },
      { word: 'AGENT6', type: 'blue' as const, revealed: true },
      { word: 'AGENT7', type: 'blue' as const, revealed: true },
      { word: 'LASTBLUE', type: 'blue' as const, revealed: false },
      { word: 'RED1', type: 'red' as const, revealed: false },
      ...Array.from({ length: 16 }, (_, i) => ({ word: 'W' + i, type: 'bystander' as const, revealed: false })),
    ];
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'blue',
      currentClue: { word: 'BLUE', number: 1 },
      guessesRemaining: 5,
      grid,
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 7 }, OP_BLUE);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('game_end');
    expect(result.state!.winner).toBe('blue');
  });

  test('blue team loses by hitting assassin', () => {
    const grid = [
      { word: 'DEATH', type: 'assassin' as const, revealed: false },
      ...Array.from({ length: 24 }, (_, i) => ({ word: 'W' + i, type: 'bystander' as const, revealed: false })),
    ];
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'blue',
      currentClue: { word: 'DANGER', number: 5 },
      guessesRemaining: 5,
      grid,
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_BLUE);
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('game_end');
    expect(result.state!.winner).toBe('red');
    expect(result.state!.gameEndReason).toContain('Assassin');
  });
});

describe('codenamesEngine — card reveal persists (applyMove bug regression)', () => {
  test('guessing a card updates grid state (not just the result state)', () => {
    // This is a regression test for a bug where applyMove computed
    // newGrid but never assigned it to state.grid
    const grid = [
      { word: 'CAT', type: 'red' as const, revealed: false },
      { word: 'DOG', type: 'blue' as const, revealed: false },
      ...Array.from({ length: 23 }, (_, i) => ({ word: 'W' + i, type: 'bystander' as const, revealed: false })),
    ];
    const state = makeState({
      phase: 'guessing',
      activeTeam: 'red',
      currentClue: { word: 'ANIMAL', number: 2 },
      guessesRemaining: 3,
      grid,
    });
    const result = codenamesEngine.applyMove(state, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(result.ok).toBe(true);
    // The card must actually be revealed in the returned state
    expect(result.state!.grid[0]!.revealed).toBe(true);
    // And subsequent calls should see it as revealed
    const second = codenamesEngine.applyMove(result.state!, { type: 'GUESS', cardIndex: 0 }, OP_RED);
    expect(second.ok).toBe(false);
  });
});

describe('codenamesEngine.serialize/deserialize', () => {
  test('roundtrips correctly', () => {
    const original = makeState();
    const serialized = codenamesEngine.serialize(original);
    const deserialized = codenamesEngine.deserialize(serialized);
    expect(deserialized).toEqual(original);
  });
});
