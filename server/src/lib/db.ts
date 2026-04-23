// ============================================================
// DATABASE — Drizzle ORM + PostgreSQL schema
// ============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, uuid, varchar, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { DATABASE_URL } from './config';

// Connection (for migrations and queries)
export const queryClient = postgres(DATABASE_URL);
export const db = drizzle(queryClient);

// ----- Schema -----

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomCode: varchar('room_code', { length: 6 }).notNull(),
  gameType: varchar('game_type', { length: 32 }).notNull(),
  sessionHash: varchar('session_hash', { length: 64 }).notNull(),
  playerHashes: varchar('player_hashes', { length: 512 }).notNull(), // JSON array
  winnerHash: varchar('winner_hash', { length: 64 }),
  finalState: jsonb('final_state').notNull(),
  movesCount: integer('moves_count').notNull(),
  durationSecs: integer('duration_secs').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  gameTypeIdx: index('idx_games_game_type').on(table.gameType),
  createdAtIdx: index('idx_games_created_at').on(table.createdAt),
}));

export const leaderboard = pgTable('leaderboard', {
  sessionHash: varchar('session_hash', { length: 64 }).notNull(),
  displayName: varchar('display_name', { length: 32 }).notNull().default('Anonymous'),
  gameType: varchar('game_type', { length: 32 }).notNull(),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  draws: integer('draws').notNull().default(0),
  lastPlayedAt: timestamp('last_played_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  pk: index('pk_leaderboard').on(table.sessionHash, table.gameType),
  gameWinsIdx: index('idx_leaderboard_game_wins').on(table.gameType, table.wins),
}));

// Type exports
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type LeaderboardRow = typeof leaderboard.$inferSelect;
export type NewLeaderboardRow = typeof leaderboard.$inferInsert;
