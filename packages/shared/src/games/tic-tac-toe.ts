// ============================================================
// TIC-TAC-TOE GAME ENGINE
// ============================================================

import type { GameEngine } from './types';
import type {
  GameState,
  Move,
  MoveResult,
  GameEnd,
  TicTacToeState,
  TicTacToeMove,
} from '../types';

// ----- Symbol constants -----
export const TTT_X = 'X';
export const TTT_O = 'O';
export const EMPTY = '';

export const BOARD_SIZE = 3;

// Flat index → [row, col]
const INDEX_TO_POS = Array.from({ length: 9 }, (_, i) => [
  Math.floor(i / BOARD_SIZE),
  i % BOARD_SIZE,
] as [number, number]);

// All winning lines as flat indices 0-8
const WINNING_LINES: readonly [number, number, number][] = [
  // Rows
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  // Columns
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  // Diagonals
  [0, 4, 8],
  [2, 4, 6],
];

// ----- Board helpers -----

function createEmptyBoard(): string[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => EMPTY)
  );
}

function checkWinner(board: string[][]): [string, number[]] | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    const [ra, ca] = INDEX_TO_POS[a];
    const [rb, cb] = INDEX_TO_POS[b];
    const [rc, cc] = INDEX_TO_POS[c];
    const valA = board[ra][ca];
    const valB = board[rb][cb];
    const valC = board[rc][cc];
    if (valA && valA === valB && valB === valC) {
      return [valA, [a, b, c]];
    }
  }
  return null;
}

function isBoardFull(board: string[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== EMPTY));
}

function getNextPlayer(players: string[], currentTurn: string): string {
  const idx = players.indexOf(currentTurn);
  return players[(idx + 1) % players.length];
}

// ----- Tic-Tac-Toe Engine -----

export const ticTacToeEngine: GameEngine<
  TicTacToeState,
  TicTacToeMove
> = {
  gameType: 'tic-tac-toe',
  minPlayers: 2,
  maxPlayers: 2,
  name: 'Tic-Tac-Toe',
  description: 'Classic 3x3 grid game — get three in a row to win.',
  slug: 'tic-tac-toe',
  icon: '🎯',

  createInitialState(players: string[]): TicTacToeState {
    return {
      gameType: 'tic-tac-toe',
      players,
      turn: players[0],
      moveCount: 0,
      board: createEmptyBoard(),
      updatedAt: Date.now(),
    };
  },

  applyMove(
    state: TicTacToeState,
    move: TicTacToeMove,
    playerId: string
  ): MoveResult<TicTacToeState> {
    // Already game over?
    if (state.result) {
      return {
        ok: false,
        error: { code: 'GAME_OVER', message: 'Game has already ended.' },
      };
    }

    // Player not in game?
    if (!state.players.includes(playerId)) {
      return {
        ok: false,
        error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' },
      };
    }

    // Not this player's turn?
    if (state.turn !== playerId) {
      return {
        ok: false,
        error: { code: 'NOT_YOUR_TURN', message: "It's not your turn." },
      };
    }

    const { cell } = move; // 0-8 flat index

    // Out of bounds?
    if (cell < 0 || cell > 8) {
      return {
        ok: false,
        error: { code: 'MOVE_OUT_OF_RANGE', message: 'Cell is out of bounds.' },
      };
    }

    const [row, col] = INDEX_TO_POS[cell];

    // Cell already occupied?
    if (state.board[row][col] !== EMPTY) {
      return {
        ok: false,
        error: { code: 'CELL_OCCUPIED', message: 'That cell is already taken.' },
      };
    }

    // Determine symbol for this player
    const symbol = state.players.indexOf(playerId) === 0 ? TTT_X : TTT_O;

    // Apply move
    const newBoard = state.board.map((r) => [...r]);
    newBoard[row][col] = symbol;

    // Check for winner
    const winnerResult = checkWinner(newBoard);
    let result: GameEnd | undefined;
    let winningIndices: number[] | undefined;

    if (winnerResult) {
      const winnerSymbol = winnerResult[0];
      winningIndices = winnerResult[1];
      const winnerIdx = winnerSymbol === TTT_X ? 0 : 1;
      const winnerId = state.players[winnerIdx];
      result = { winner: winnerId, reason: 'THREE_IN_A_ROW' };
    } else if (isBoardFull(newBoard)) {
      result = { winner: null, reason: 'BOARD_FULL' };
    }

    const newState: TicTacToeState = {
      ...state,
      board: newBoard,
      moveCount: state.moveCount + 1,
      turn: result ? state.turn : getNextPlayer(state.players, state.turn),
      result,
      winningLine: winningIndices
        ? winningIndices.map((i: number) => INDEX_TO_POS[i])
        : undefined,
      updatedAt: Date.now(),
    };

    return { ok: true, state: newState };
  },

  checkGameEnd(state: TicTacToeState): GameEnd | null {
    if (state.result) return state.result;
    if (isBoardFull(state.board)) {
      return { winner: null, reason: 'BOARD_FULL' };
    }
    const winnerResult = checkWinner(state.board);
    if (winnerResult) {
      const [winnerSymbol] = winnerResult;
      const winnerIdx = winnerSymbol === TTT_X ? 0 : 1;
      return { winner: state.players[winnerIdx], reason: 'THREE_IN_A_ROW' };
    }
    return null;
  },

  serialize(state: TicTacToeState): string {
    return JSON.stringify(state);
  },

  deserialize(data: string): TicTacToeState {
    return JSON.parse(data) as TicTacToeState;
  },

  isValidMove(state: TicTacToeState, move: TicTacToeMove, playerId: string): boolean {
    return ticTacToeEngine.applyMove(state, move, playerId).ok;
  },

  getValidMoves(state: TicTacToeState, playerId: string): TicTacToeMove[] {
    if (state.result) return [];
    if (state.turn !== playerId) return [];

    const moves: TicTacToeMove[] = [];
    for (let i = 0; i < 9; i++) {
      const [r, c] = INDEX_TO_POS[i];
      if (state.board[r][c] === EMPTY) {
        moves.push({ type: 'PLACE_MARK', cell: i });
      }
    }
    return moves;
  },
};
