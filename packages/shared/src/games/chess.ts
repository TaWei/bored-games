// ============================================================
// CHESS ENGINE — Placeholder stub
// ============================================================
// TODO: Full implementation with chess.js integration
// - FEN parsing/serialization
// - Legal move validation (including castling, en passant)
// - Check/checkmate/stalemate detection
// - Clock/time controls
// - Promotion handling

import type { GameEngine } from './types';
import type { ChessState, ChessMove } from '../types';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const chessEngine: GameEngine<ChessState, ChessMove> = {
  gameType: 'chess',
  minPlayers: 2,
  maxPlayers: 2,
  name: 'Chess',
  description: 'Classic strategy game — checkmate the opponent\'s king.',
  slug: 'chess',
  icon: '♟️',

  createInitialState(players: string[]): ChessState {
    return {
      gameType: 'chess',
      players,
      turn: players[0], // White moves first
      moveCount: 0,
      fen: STARTING_FEN,
      updatedAt: Date.now(),
    };
  },

  applyMove(state: ChessState, _move: ChessMove, _playerId: string) {
    // TODO: integrate chess.js for move validation
    return {
      ok: false,
      error: {
        code: 'INVALID_MOVE',
        message: 'Chess is not yet implemented. Try Tic-Tac-Toe!',
      },
    };
  },

  checkGameEnd(_state: ChessState) {
    // TODO: implement check/checkmate/stalemate detection
    return null;
  },

  serialize(state: ChessState): string {
    return JSON.stringify(state);
  },

  deserialize(data: string): ChessState {
    return JSON.parse(data) as ChessState;
  },
};
