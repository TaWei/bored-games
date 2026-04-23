// ============================================================
// ROUTES INDEX — merge all Hono route modules
// ============================================================

import { Hono } from 'hono';
import { rooms } from './rooms';
import { games } from './games';
import { leaderboard } from './leaderboard';

export const routes = new Hono()
  .route('/rooms', rooms)
  .route('/games', games)
  .route('/leaderboard', leaderboard);
