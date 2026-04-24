// ============================================================
// GAME REGISTRY — central lookup for all game engines
// ============================================================

import { ticTacToeEngine } from './tic-tac-toe';
import { chessEngine } from './chess';
import { avalonEngine } from './avalon';
import { codenamesEngine } from './codenames';
import type { GameEngine } from './types';
import type { GameType, GameInfo, GameInfoListResponse } from '../types';

// Registry keyed by game type
export const gameEngines: Record<string, GameEngine> = {
	[ticTacToeEngine.gameType]: ticTacToeEngine,
	[avalonEngine.gameType]: avalonEngine,
	[codenamesEngine.gameType]: codenamesEngine,
	// [chessEngine.gameType]: chessEngine, // TODO: uncomment when chess is implemented
};

/**
 * Get the engine for a given game type.
 * Throws if the game type is not registered.
 */
export function getEngine(type: GameType): GameEngine {
  const engine = gameEngines[type];
  if (!engine) {
    throw new Error(`Unknown game type: "${type}". Available: ${Object.keys(gameEngines).join(', ')}`);
  }
  return engine;
}

/**
 * Check if a game type is available/registered.
 */
export function isGameAvailable(type: GameType): boolean {
  return type in gameEngines;
}

/**
 * Get metadata for all available games.
 */
export function getGameInfoList(): GameInfoListResponse {
  const games: GameInfo[] = Object.values(gameEngines).map((engine) => ({
    gameType: engine.gameType,
    name: engine.name,
    description: engine.description,
    minPlayers: engine.minPlayers,
    maxPlayers: engine.maxPlayers,
    slug: engine.slug,
    icon: engine.icon,
  }));
  return { games };
}

/**
 * Get metadata for a single game.
 */
export function getGameInfo(type: GameType): GameInfo | null {
  const engine = gameEngines[type];
  if (!engine) return null;
  return {
    gameType: engine.gameType,
    name: engine.name,
    description: engine.description,
    minPlayers: engine.minPlayers,
    maxPlayers: engine.maxPlayers,
    slug: engine.slug,
    icon: engine.icon,
  };
}

export { ticTacToeEngine } from './tic-tac-toe';
export { chessEngine } from './chess';
export { avalonEngine } from './avalon';
export { codenamesEngine } from './codenames';
