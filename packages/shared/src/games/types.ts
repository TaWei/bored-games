// ============================================================
// GAME ENGINE INTERFACE — implemented by each game module
// ============================================================

import type { GameType, Move, MoveResult, GameEnd, GameState } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface GameEngine<S extends GameState = any, M extends Move = any> {
  readonly gameType: GameType;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly name: string;
  readonly description: string;
  readonly slug: string;
  readonly icon: string;

  /** Create the initial state for a new game */
  createInitialState(players: string[]): S;

  /**
   * Validate and apply a move.
   * Returns updated state if valid, or an error if invalid.
   */
  applyMove(state: S, move: M, playerId: string): MoveResult<S>;

  /**
   * Check if the game has ended (win, draw, etc.)
   */
  checkGameEnd(state: S): GameEnd | null;

  /**
   * Serialize state to a string for Redis storage
   */
  serialize(state: S): string;

  /**
   * Deserialize state from Redis
   */
  deserialize(data: string): S;

  /**
   * Optional: get all valid moves for a player (for hints)
   */
  getValidMoves?(state: S, playerId: string): M[];

  /**
   * Optional: validate a move without applying it
   */
  isValidMove?(state: S, move: M, playerId: string): boolean;

  // ── Avalon-specific extended methods ──
  // These are defined on the avalonEngine but are NOT part of the base
  // GameEngine contract — they are internal implementation details called
  // from within applyMove() via non-null assertions (!) below.
  // do NOT add these to GameEngine — they would break other game engines.
}
