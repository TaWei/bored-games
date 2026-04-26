// ============================================================
// CHESS ENGINE — Full implementation
// ============================================================
//
// FEN parsing/serialization
// Legal move validation (including castling, en passant)
// Check/checkmate/stalemate detection
// No external chess library — pure TypeScript implementation
//
// FEN format: <position> <side> <castling> <en_passant> <halfmove> <fullmove>
// ============================================================

import type { GameEngine } from './types';
import type { ChessState, ChessMove, GameEnd } from '../types';

// ----- FEN constants -----

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ----- Types -----

type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Color = 'w' | 'b';

interface Piece {
  type: PieceType;
  color: Color;
}

type Board = (Piece | null)[][]; // board[row][col], row 0 = rank 8, col 0 = file a

interface ParsedPosition {
  board: Board;
  turn: Color;
  castling: { K: boolean; Q: boolean; k: boolean; q: boolean };
  enPassantSquare: string | null; // e.g. 'e3'
  halfmoveClock: number;
  fullmoveNumber: number;
}

// ----- FEN parsing -----

function parsePiece(ch: string): Piece | null {
  if (ch === '') return null;
  const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
  const type = ch.toLowerCase() as PieceType;
  return { type, color };
}

function parseRank(rankStr: string): (Piece | null)[] {
  const squares: (Piece | null)[] = [];
  for (const ch of rankStr) {
    if (ch >= '1' && ch <= '8') {
      for (let i = 0; i < parseInt(ch, 10); i++) squares.push(null);
    } else {
      squares.push(parsePiece(ch));
    }
  }
  return squares;
}

function parseFEN(fen: string): ParsedPosition {
  const parts = fen.trim().split(/\s+/);
  const [rankStr, turnStr, castlingStr, enPassantStr, halfmoveStr, fullmoveStr] = parts;

  // Parse board
  const ranks = rankStr.split('/');
  if (ranks.length !== 8) throw new Error(`Invalid FEN: expected 8 ranks, got ${ranks.length}`);
  const board: Board = ranks.map(parseRank);
  if (board.some((r) => r.length !== 8)) throw new Error('Invalid FEN: rank has != 8 squares');

  // Parse turn
  const turn: Color = turnStr === 'b' ? 'b' : 'w';

  // Parse castling
  const castling = {
    K: castlingStr.includes('K'),
    Q: castlingStr.includes('Q'),
    k: castlingStr.includes('k'),
    q: castlingStr.includes('q'),
  };

  // Parse en passant
  const enPassantSquare = enPassantStr === '-' ? null : enPassantStr;

  // Parse clocks
  const halfmoveClock = parseInt(halfmoveStr ?? '0', 10) || 0;
  const fullmoveNumber = parseInt(fullmoveStr ?? '1', 10) || 1;

  return { board, turn, castling, enPassantSquare, halfmoveClock, fullmoveNumber };
}

// ----- Board helpers -----

// algebraic notation: col 0 = 'a', row 0 = rank 8
function sqName(row: number, col: number): string {
  return String.fromCharCode(97 + col) + (8 - row);
}

function parseSquare(name: string): [number, number] {
  const col = name.charCodeAt(0) - 97;
  const row = 8 - parseInt(name[1], 10);
  return [row, col];
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function cloneBoard(board: Board): Board {
  return board.map((r) => r.map((p) => (p ? { ...p } : null)));
}

// ----- Move generation -----

interface RawMove {
  from: [number, number];
  to: [number, number];
  promotion?: PieceType;
}

function getPieceMoves(
  board: Board,
  row: number,
  col: number,
  castling: ParsedPosition['castling'],
  enPassantSquare: string | null,
  inCheck: boolean
): RawMove[] {
  const piece = board[row][col];
  if (!piece) return [];

  const moves: RawMove[] = [];
  const { type, color } = piece;
  const dir = color === 'w' ? -1 : 1;

  const addIfValid = (r: number, c: number, promotion?: PieceType): boolean => {
    if (!inBounds(r, c)) return false;
    const target = board[r][c];
    if (target && target.color === color) return false;
    moves.push({ from: [row, col], to: [r, c], promotion });
    return !target; // can continue sliding if empty
  };

  const slide = (dirs: [number, number][]): void => {
    for (const [dr, dc] of dirs) {
      for (let i = 1; i < 8; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (!addIfValid(r, c)) break;
        if (board[r]?.[c]) break; // blocked by any piece
      }
    }
  };

  switch (type) {
    case 'p': {
      // Forward one
      const f1 = row + dir;
      if (inBounds(f1, col) && !board[f1][col]) {
        const promotion: PieceType | undefined = f1 === 0 || f1 === 7 ? 'q' : undefined;
        moves.push({ from: [row, col], to: [f1, col], promotion });
        // Forward two from starting rank
        const startRank = color === 'w' ? 6 : 1;
        const f2 = row + dir * 2;
        if (row === startRank && !board[f2][col]) {
          moves.push({ from: [row, col], to: [f2, col] });
        }
      }
      // Captures (diagonal)
      for (const dc of [-1, 1]) {
        const r = row + dir;
        const c = col + dc;
        if (!inBounds(r, c)) continue;
        const target = board[r][c];
        if (target && target.color !== color) {
          const promotion: PieceType | undefined = r === 0 || r === 7 ? 'q' : undefined;
          moves.push({ from: [row, col], to: [r, c], promotion });
        }
        // En passant
        if (enPassantSquare) {
          const [epR, epC] = parseSquare(enPassantSquare);
          if (r === epR && c === epC) {
            moves.push({ from: [row, col], to: [r, c] });
          }
        }
      }
      break;
    }

    case 'n':
      for (const [dr, dc] of [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1],
      ]) {
        addIfValid(row + dr, col + dc);
      }
      break;

    case 'b':
      slide([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
      break;

    case 'r':
      slide([[-1, 0], [1, 0], [0, -1], [0, 1]]);
      break;

    case 'q':
      slide([
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1],
      ]);
      break;

    case 'k': {
      for (const [dr, dc] of [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],          [0, 1],
        [1, -1],  [1, 0],  [1, 1],
      ]) {
        addIfValid(row + dr, col + dc);
      }
      // Castling
      if (!inCheck) {
        const rank = color === 'w' ? 7 : 0;
        if (row !== rank || col !== 4) break;
        // Kingside
        if (castling[color === 'w' ? 'K' : 'k']) {
          if (!board[rank][5] && !board[rank][6]) {
            moves.push({ from: [row, col], to: [rank, 6] });
          }
        }
        // Queenside
        if (castling[color === 'w' ? 'Q' : 'q']) {
          if (!board[rank][3] && !board[rank][2] && !board[rank][1]) {
            moves.push({ from: [row, col], to: [rank, 2] });
          }
        }
      }
      break;
    }
  }

  return moves;
}

function findKing(board: Board, color: Color): [number, number] | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) return [r, c];
    }
  }
  return null;
}

function isSquareAttacked(board: Board, square: [number, number], byColor: Color): boolean {
  const [row, col] = square;
  // Pawn attacks
  const dir = byColor === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const r = row + dir;
    const c = col + dc;
    if (inBounds(r, c)) {
      const p = board[r][c];
      if (p && p.type === 'p' && p.color === byColor) return true;
    }
  }
  // Knight attacks
  for (const [dr, dc] of [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ]) {
    const r = row + dr;
    const cc = col + dc;
    if (inBounds(r, cc)) {
      const p = board[r][cc];
      if (p && p.type === 'n' && p.color === byColor) return true;
    }
  }
  // King attacks
  for (const [dr, dc] of [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],          [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ]) {
    const r = row + dr;
    const cc = col + dc;
    if (inBounds(r, cc)) {
      const p = board[r][cc];
      if (p && p.type === 'k' && p.color === byColor) return true;
    }
  }
  // Sliding pieces
  const dirs: [number, number][][] = [
    [[-1, 0], [1, 0], [0, -1], [0, 1]], // rook/queen
    [[-1, -1], [-1, 1], [1, -1], [1, 1]], // bishop/queen
  ];
  const limit = [8, 8];
  for (let dIdx = 0; dIdx < dirs.length; dIdx++) {
    for (const [dr, dc] of dirs[dIdx]) {
      for (let i = 1; i < 8; i++) {
        const r = row + dr * i;
        const cc = col + dc * i;
        if (!inBounds(r, cc)) break;
        const p = board[r][cc];
        if (p) {
          if (p.color === byColor) {
            const expected = dIdx === 0 ? (['r', 'q'] as PieceType[]) : (['b', 'q'] as PieceType[]);
            if (expected.includes(p.type)) return true;
          }
          break;
        }
      }
    }
  }
  return false;
}

function isInCheck(board: Board, color: Color): boolean {
  const kingPos = findKing(board, color);
  if (!kingPos) return false;
  return isSquareAttacked(board, kingPos, color === 'w' ? 'b' : 'w');
}

function applyMove(
  board: Board,
  move: RawMove,
  castling: ParsedPosition['castling'],
  enPassantSquare: string | null
): { newBoard: Board; captured: Piece | null; newCastling: ParsedPosition['castling']; newEnPassant: string | null } {
  const [fromR, fromC] = move.from;
  const [toR, toC] = move.to;
  const piece = board[fromR][fromC]!;
  const captured = board[toR][toC];

  const newBoard = cloneBoard(board);
  newBoard[toR][toC] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
  newBoard[fromR][fromC] = null;

  // En passant capture
  if (piece.type === 'p' && enPassantSquare) {
    const [epR, epC] = parseSquare(enPassantSquare);
    if (toR === epR && toC === epC) {
      const capturedRow = piece.color === 'w' ? toR + 1 : toR - 1;
      newBoard[capturedRow][epC] = null;
    }
  }

  // Castling: move rook
  if (piece.type === 'k' && Math.abs(toC - fromC) === 2) {
    const rookFromC = toC > fromC ? 7 : 0;
    const rookToC = toC > fromC ? 5 : 3;
    newBoard[toR][rookToC] = newBoard[toR][rookFromC];
    newBoard[toR][rookFromC] = null;
  }

  // Update castling rights
  const newCastling = { ...castling };
  if (piece.type === 'k') {
    if (piece.color === 'w') { newCastling.K = false; newCastling.Q = false; }
    else { newCastling.k = false; newCastling.q = false; }
  }
  if (piece.type === 'r') {
    if (fromR === 7 && fromC === 7) newCastling.K = false;
    if (fromR === 7 && fromC === 0) newCastling.Q = false;
    if (fromR === 0 && fromC === 7) newCastling.k = false;
    if (fromR === 0 && fromC === 0) newCastling.q = false;
  }
  // If a rook is captured
  if (toR === 7 && toC === 7) newCastling.K = false;
  if (toR === 7 && toC === 0) newCastling.Q = false;
  if (toR === 0 && toC === 7) newCastling.k = false;
  if (toR === 0 && toC === 0) newCastling.q = false;

  // New en passant square
  let newEnPassant: string | null = null;
  if (piece.type === 'p' && Math.abs(toR - fromR) === 2) {
    newEnPassant = sqName((fromR + toR) / 2, fromC);
  }

  return { newBoard, captured: captured ?? null, newCastling, newEnPassant };
}

function isMoveLegal(
  board: Board,
  move: RawMove,
  castling: ParsedPosition['castling'],
  enPassantSquare: string | null,
  color: Color
): boolean {
  const { newBoard } = applyMove(board, move, castling, enPassantSquare);
  return !isInCheck(newBoard, color);
}

function getAllLegalMoves(
  board: Board,
  color: Color,
  castling: ParsedPosition['castling'],
  enPassantSquare: string | null
): RawMove[] {
  const inCheck = isInCheck(board, color);
  const allMoves: RawMove[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      const moves = getPieceMoves(board, r, c, castling, enPassantSquare, inCheck);
      for (const move of moves) {
        if (isMoveLegal(board, move, castling, enPassantSquare, color)) {
          allMoves.push(move);
        }
      }
    }
  }
  return allMoves;
}

function hasAnyLegalMove(
  board: Board,
  color: Color,
  castling: ParsedPosition['castling'],
  enPassantSquare: string | null
): boolean {
  const inCheck = isInCheck(board, color);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      const moves = getPieceMoves(board, r, c, castling, enPassantSquare, inCheck);
      for (const move of moves) {
        if (isMoveLegal(board, move, castling, enPassantSquare, color)) {
          return true;
        }
      }
    }
  }
  return false;
}

// ----- FEN serialization -----

function boardToFEN(
  board: Board,
  turn: Color,
  castling: ParsedPosition['castling'],
  enPassantSquare: string | null,
  halfmoveClock: number,
  fullmoveNumber: number
): string {
  const rankStrs: string[] = [];
  for (let r = 0; r < 8; r++) {
    let rankStr = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) {
        if (empty > 0) { rankStr += empty; empty = 0; }
        const ch = p.color === 'w' ? p.type.toUpperCase() : p.type;
        rankStr += ch;
      } else {
        empty++;
      }
    }
    if (empty > 0) rankStr += empty;
    rankStrs.push(rankStr);
  }

  let castlingStr = '';
  if (castling.K) castlingStr += 'K';
  if (castling.Q) castlingStr += 'Q';
  if (castling.k) castlingStr += 'k';
  if (castling.q) castlingStr += 'q';
  if (!castlingStr) castlingStr = '-';

  return [
    rankStrs.join('/'),
    turn,
    castlingStr,
    enPassantSquare ?? '-',
    halfmoveClock,
    fullmoveNumber,
  ].join(' ');
}

// ----- Engine -----

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
      turn: players[0],
      moveCount: 0,
      fen: STARTING_FEN,
      updatedAt: Date.now(),
    };
  },

  applyMove(state: ChessState, move: ChessMove, playerId: string) {
    // Game over?
    if (state.result) {
      return { ok: false, error: { code: 'GAME_OVER', message: 'Game has already ended.' } };
    }

    // Player not in game?
    if (!state.players.includes(playerId)) {
      return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
    }

    // Not this player's turn?
    const color: Color = state.players.indexOf(playerId) === 0 ? 'w' : 'b';
    if (color !== (state.fen.split(' ')[1] as Color)) {
      return { ok: false, error: { code: 'NOT_YOUR_TURN', message: "It's not your turn." } };
    }

    // Parse FEN
    let parsed: ParsedPosition;
    try {
      parsed = parseFEN(state.fen);
    } catch {
      return { ok: false, error: { code: 'INVALID_FEN', message: 'Invalid board state.' } };
    }

    const { board, castling, enPassantSquare, halfmoveClock, fullmoveNumber } = parsed;

    // Parse the requested move
    let fromSq: [number, number], toSq: [number, number];
    try {
      fromSq = parseSquare(move.from);
      toSq = parseSquare(move.to);
    } catch {
      return { ok: false, error: { code: 'INVALID_MOVE', message: 'Invalid algebraic notation.' } };
    }

    const piece = board[fromSq[0]][fromSq[1]];
    if (!piece || piece.color !== color) {
      return { ok: false, error: { code: 'INVALID_MOVE', message: 'No your piece on that square.' } };
    }

    // Check if move matches any legal move
    const legalMoves = getAllLegalMoves(board, color, castling, enPassantSquare);
    const matchingMove = legalMoves.find(
      (m) =>
        m.from[0] === fromSq[0] &&
        m.from[1] === fromSq[1] &&
        m.to[0] === toSq[0] &&
        m.to[1] === toSq[1] &&
        (move.promotion ? m.promotion === move.promotion : true)
    );

    if (!matchingMove) {
      return { ok: false, error: { code: 'INVALID_MOVE', message: 'Illegal move.' } };
    }

    // Apply the move
    const { newBoard, captured, newCastling, newEnPassant } = applyMove(
      board,
      matchingMove,
      castling,
      enPassantSquare
    );

    // Update clocks
    const isCapture = captured !== null || piece.type === 'p';
    const newHalfmove = isCapture ? 0 : halfmoveClock + 1;
    const newFullmove = color === 'b' ? fullmoveNumber + 1 : fullmoveNumber;

    const newFen = boardToFEN(newBoard, color === 'w' ? 'b' : 'w', newCastling, newEnPassant, newHalfmove, newFullmove);

    // Check game end
    const nextColor: Color = color === 'w' ? 'b' : 'w';
    const nextInCheck = isInCheck(newBoard, nextColor);
    const nextHasLegalMove = hasAnyLegalMove(newBoard, nextColor, newCastling, newEnPassant);

    let result: GameEnd | undefined;
    if (!nextHasLegalMove) {
      if (nextInCheck) {
        // Checkmate — the player who just moved wins
        result = { winner: playerId, reason: 'CHECKMATE' };
      } else {
        // Stalemate — draw
        result = { winner: null, reason: 'STALEMATE' };
      }
    } else if (newHalfmove >= 100) {
      // 50-move draw
      result = { winner: null, reason: 'FIFTY_MOVE_RULE' };
    }

    const newState: ChessState = {
      ...state,
      fen: newFen,
      moveCount: state.moveCount + 1,
      turn: nextHasLegalMove && !result ? (color === 'w' ? state.players[1] : state.players[0]) : state.turn,
      result,
      updatedAt: Date.now(),
    };

    return { ok: true, state: newState };
  },

  checkGameEnd(state: ChessState): GameEnd | null {
    return state.result ?? null;
  },

  serialize(state: ChessState): string {
    return JSON.stringify(state);
  },

  deserialize(data: string): ChessState {
    return JSON.parse(data) as ChessState;
  },

  isValidMove(state: ChessState, move: ChessMove, playerId: string): boolean {
    return chessEngine.applyMove(state, move, playerId).ok;
  },

  getValidMoves(state: ChessState, playerId: string): ChessMove[] {
    if (state.result) return [];
    const color: Color = state.players.indexOf(playerId) === 0 ? 'w' : 'b';
    if (color !== (state.fen.split(' ')[1] as Color)) return [];

    let parsed: ParsedPosition;
    try {
      parsed = parseFEN(state.fen);
    } catch {
      return [];
    }

    const { board, castling, enPassantSquare } = parsed;
    const rawMoves = getAllLegalMoves(board, color, castling, enPassantSquare);

    return rawMoves.map((m) => ({
      type: 'MOVE_PIECE' as const,
      from: sqName(m.from[0], m.from[1]),
      to: sqName(m.to[0], m.to[1]),
      ...(m.promotion ? { promotion: m.promotion as 'n' | 'b' | 'r' | 'q' } : {}),
    }));
  },
};
