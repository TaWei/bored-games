// ============================================================
// TIC-TAC-TOE GAME ENGINE
// ============================================================

import type {
  GameEngine,
  GameState,
  Move,
  MoveResult,
  GameEnd,
} from '../types';
import type {
  TicTacToeState,
  TicTacToeMove,
  TicTacToeMove,
} from '../types';

// ----- Symbol constants -----
export const TTT_X = 'X';
export const TTT_O = 'O';
export const EMPTY = '';

export const BOARD_SIZE = 3;
export const WIN_LENGTH = 3;

// All 8 winning lines: [row, col] pairs
const WINNING_LINES: readonly [number, number][][] = [
  // Rows
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  // Columns
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  // Diagonals
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
] as const;

// ----- Board helpers -----

function createEmptyBoard(): string[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => EMPTY)
  );
}

function checkWinner(board: string[][]): [string, [number, number][]] | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    const valA = board[a[0]][a[1]];
    const valB = board[b[0]][b[1]];
    const valC = board[c[0]][c[1]];
    if (valA && valA === valB && valB === valC) {
      return [valA, [a, b, c]];
    }
  }
  return null;
}

function isBoardFull(board: string[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== EMPTY));
}

function getNextPlayer(
  players: string[],
  currentTurn: string
): string {
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

    const { cell } = move;
    const [row, col] = cell;

    // Out of bounds?
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return {
        ok: false,
        error: { code: 'MOVE_OUT_OF_RANGE', message: 'Cell is out of bounds.' },
      };
    }

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

    if (winnerResult) {
      const [winnerSymbol] = winnerResult;
      // Find the winner's sessionId
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
      winningLine: winnerResult ? (winnerResult[1] as [number, number][]) : undefined,
      updatedAt: Date.now(),
    };

    return { ok: true, state: newState };
  },

  checkGameEnd(state: TicTacToeState): GameEnd | null {
    if (state.result) return state.result;
    if (isBoardFull(state.board)) {
      return { winner: null, reason: 'BOARD_FULL' };
    }
    if (checkWinner(state.board)) {
      // Should have been caught in applyMove, but belt-and-suspenders
      const winnerSymbol = checkWinner(state.board)![0];
      const winnerIdx = winnerSymbol === TTT_X ? 0 : 1;
      return { winner: state.players[winnerIdx], reason: 'THREE_IN_A_ROW' };
    }
    return null;
  },

  serialize(state: TicTacToeState): string {
    return JSON.stringify(state);
  },

  deserialize(data: string): TicTacToeState {
    const parsed = JSON.parse(data);
    return parsed as TicTacToeState;
  },

  isValidMove(state: TicTacToeState, move: TicTacToeMove, playerId: string): boolean {
    return ticTacToeEngine.applyMove(state, move, playerId).ok;
  },

  getValidMoves(state: TicTacToeState, playerId: string): TicTacToeMove[] {
    if (state.result) return [];
    if (state.turn !== playerId) return [];

    const moves: TicTacToeMove[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (state.board[r][c] === EMPTY) {
          moves.push({ type: 'PLACE_MARK', cell: [r, c] });
        }
      }
    }
    return moves;
  },
};
