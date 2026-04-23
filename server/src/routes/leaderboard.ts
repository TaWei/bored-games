// ============================================================
// LEADERBOARD ROUTES
// ============================================================

import { Hono } from 'hono';
import * as Leaderboard from '../services/leaderboard';
import type { GameType } from '@bored-games/shared';

const leaderboard = new Hono();

// GET /api/leaderboard/:gameType — Get leaderboard for a game type
leaderboard.get('/:gameType', async (c) => {
  const gameType = c.req.param('gameType') as GameType;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 200);

  try {
    const entries = await Leaderboard.getLeaderboard(gameType, limit);
    return c.json({
      gameType,
      entries,
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return c.json({ error: 'Failed to fetch leaderboard' }, 500);
  }
});

export { leaderboard };
