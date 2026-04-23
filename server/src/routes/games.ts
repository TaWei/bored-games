// ============================================================
// GAME ROUTES — list available games and metadata
// ============================================================

import { Hono } from 'hono';
import { getEngine, getGameInfo, getGameInfoList, isGameAvailable } from '@bored-games/shared/games';
import type { GameType } from '@bored-games/shared';

const games = new Hono();

// GET /api/games — List all available games
games.get('/', (c) => {
  const list = getGameInfoList();
  return c.json(list);
});

// GET /api/games/:type — Get metadata for a specific game
games.get('/:type', (c) => {
  const type = c.req.param('type') as GameType;

  if (!isGameAvailable(type)) {
    return c.json({ error: `Game "${type}" is not available yet.` }, 404);
  }

  const info = getGameInfo(type);
  return c.json({ game: info });
});

export { games };
