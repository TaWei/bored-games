import { describe, test, expect } from 'bun:test';
import { ticTacToeEngine } from '../games/tic-tac-toe';
import type { TicTacToeState } from '../types';

const P0 = 'player-0';
const P1 = 'player-1';

describe('ticTacToeEngine', () => {
  describe('createInitialState', () => {
    test('creates empty 3x3 board', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(state.board).toEqual([
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ]);
    });

    test('sets first player as current turn', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(state.turn).toBe(P0);
    });

    test('sets moveCount to 0', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(state.moveCount).toBe(0);
    });

    test('sets gameType correctly', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(state.gameType).toBe('tic-tac-toe');
    });

    test('has no result initially', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(state.result).toBeUndefined();
    });
  });

  describe('applyMove — basic turn flow', () => {
    test('player 0 places X at cell 0', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0);
      expect(result.ok).toBe(true);
      expect(result.state!.board[0][0]).toBe('X');
      expect(result.state!.turn).toBe(P1); // turn switches
      expect(result.state!.moveCount).toBe(1);
    });

    test('player 1 places O at cell 1 (uses returned state from previous move)', () => {
      const state0 = ticTacToeEngine.createInitialState([P0, P1]);
      const state1 = ticTacToeEngine.applyMove(state0, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      const result = ticTacToeEngine.applyMove(state1, { type: 'PLACE_MARK', cell: 1 }, P1);
      expect(result.ok).toBe(true);
      expect(result.state!.board[0][1]).toBe('O');
      expect(result.state!.turn).toBe(P0); // turn switches back
    });

    test('alternating turns work correctly across full game', () => {
      const moves = [0, 1, 2, 3, 4, 5, 6];
      const players = [P0, P1, P0, P1, P0, P1, P0];
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      for (let i = 0; i < moves.length; i++) {
        const r = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: moves[i] }, players[i]!);
        expect(r.ok).toBe(true);
        state = r.state!;
      }
      // X wins via anti-diagonal (cells 2, 4, 6) on move 6
      expect(state.result).not.toBeNull();
      expect(state.result!.winner).toBe(P0);
    });
  });

  describe('applyMove — win detection', () => {
    test('detects top-row win (0,1,2)', () => {
      // P0: 0, P1: 3, P0: 1, P1: 4, P0: 2 → P0 wins top row
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!;
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0);
      expect(result.ok).toBe(true);
      expect(result.state!.result).toEqual({ winner: P0, reason: 'THREE_IN_A_ROW' });
      expect(result.state!.winningLine).toEqual([[0, 0], [0, 1], [0, 2]]);
    });

    test('detects left-column win (0,3,6)', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P1).state!;
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 6 }, P0);
      expect(result.state!.result).toEqual({ winner: P0, reason: 'THREE_IN_A_ROW' });
    });

    test('detects main diagonal win (0,4,8)', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P1).state!;
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 8 }, P0);
      expect(result.state!.result).toEqual({ winner: P0, reason: 'THREE_IN_A_ROW' });
    });

    test('detects anti-diagonal win (2,4,6)', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P1).state!;
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 6 }, P0);
      expect(result.state!.result).toEqual({ winner: P0, reason: 'THREE_IN_A_ROW' });
    });

    test('player 1 (O) can win', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 7 }, P0).state!;
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 5 }, P1);
      expect(result.state!.result).toEqual({ winner: P1, reason: 'THREE_IN_A_ROW' });
    });
  });

  describe('applyMove — draw detection', () => {
    test('detects board full draw (no winner)', () => {
      // X O X
      // X X O
      // O X O
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!; // X
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P1).state!; // O
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0).state!; // X
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!; // O
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P0).state!; // X
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 5 }, P1).state!; // O
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 7 }, P0).state!; // X
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 6 }, P1).state!; // O
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 8 }, P0);
      expect(result.ok).toBe(true);
      expect(result.state!.result).toEqual({ winner: null, reason: 'BOARD_FULL' });
    });
  });

  describe('applyMove — error cases', () => {
    test('rejects cell out of range (< 0)', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: -1 }, P0);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MOVE_OUT_OF_RANGE');
    });

    test('rejects cell out of range (> 8)', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 9 }, P0);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MOVE_OUT_OF_RANGE');
    });

    test('rejects placing on occupied cell (uses returned state)', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P1);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('CELL_OCCUPIED');
    });

    test('rejects move from player not in game', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, 'stranger');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('PLAYER_NOT_IN_GAME');
    });

    test('rejects move when not your turn', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      // P0's turn, P1 tries to play
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P1);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('NOT_YOUR_TURN');
    });

    test('rejects move after game is over (uses returned state)', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0).state!; // P0 wins
      const result = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 8 }, P1);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('GAME_OVER');
    });
  });

  describe('checkGameEnd', () => {
    test('returns null when game is ongoing', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(ticTacToeEngine.checkGameEnd(state)).toBeNull();
    });

    test('returns win result when there is a winner', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0).state!;
      expect(ticTacToeEngine.checkGameEnd(state)).toEqual({ winner: P0, reason: 'THREE_IN_A_ROW' });
    });

    test('returns draw when board is full', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 5 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 7 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 6 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 8 }, P0).state!;
      expect(ticTacToeEngine.checkGameEnd(state)).toEqual({ winner: null, reason: 'BOARD_FULL' });
    });
  });

  describe('serialize / deserialize', () => {
    test('roundtrips state correctly', () => {
      const original = ticTacToeEngine.createInitialState([P0, P1]);
      let state = ticTacToeEngine.applyMove(original, { type: 'PLACE_MARK', cell: 4 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P1).state!;
      const serialized = ticTacToeEngine.serialize(state);
      const deserialized = ticTacToeEngine.deserialize(serialized);
      expect(deserialized).toEqual(state);
    });
  });

  describe('isValidMove', () => {
    test('returns true for a valid move', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(ticTacToeEngine.isValidMove!(state, { type: 'PLACE_MARK', cell: 4 }, P0)).toBe(true);
    });

    test('returns false for an invalid move (wrong turn)', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      expect(ticTacToeEngine.isValidMove!(state, { type: 'PLACE_MARK', cell: 0 }, P1)).toBe(false);
    });
  });

  describe('getValidMoves', () => {
    test('returns all 9 cells on empty board for current player', () => {
      const state = ticTacToeEngine.createInitialState([P0, P1]);
      const moves = ticTacToeEngine.getValidMoves(state, P0);
      expect(moves).toHaveLength(9);
    });

    test('returns empty array after game ends', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 0 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 3 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 1 }, P0).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P1).state!;
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 2 }, P0).state!;
      expect(ticTacToeEngine.getValidMoves(state, P1)).toHaveLength(0);
    });

    test('returns only empty cells (uses returned state)', () => {
      let state = ticTacToeEngine.createInitialState([P0, P1]);
      state = ticTacToeEngine.applyMove(state, { type: 'PLACE_MARK', cell: 4 }, P0).state!; // center taken
      const moves = ticTacToeEngine.getValidMoves(state, P1);
      expect(moves.some(m => m.cell === 4)).toBe(false);
      expect(moves).toHaveLength(8);
    });
  });
});
