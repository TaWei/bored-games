// ============================================================
// LEADERBOARD SERVICE — PostgreSQL-backed stats
// ============================================================

import { db, leaderboard, games } from '../lib/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { LeaderboardEntry, GameStats, GameEnd, GameType } from '@bored-games/shared';

// Server-side SHA256 using Node crypto
import { createHash } from 'crypto';

export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

// ----- Record a completed game -----

export interface GameResult {
  roomCode: string;
  gameType: GameType;
  sessionHashes: string[];   // All players' hashes in join order
  winnerHash: string | null; // null = draw
  loserHashes: string[];     // All non-winner hashes (draws excluded from losses)
  finalState: Record<string, unknown>;
  movesCount: number;
  durationMs: number;
}

export async function recordGameResult(result: GameResult): Promise<void> {
  // Upsert leaderboard entries for each player
  for (const hash of result.sessionHashes) {
    const isWinner = result.winnerHash === hash;
    const isDraw = result.winnerHash === null;

    await db
      .insert(leaderboard)
      .values({
        sessionHash: hash,
        displayName: 'Anonymous', // Will be updated if display name is known
        gameType: result.gameType,
        wins: isWinner ? 1 : 0,
        losses: !isWinner && !isDraw ? 1 : 0,
        draws: isDraw ? 1 : 0,
        lastPlayedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [leaderboard.sessionHash, leaderboard.gameType],
        set: {
          wins: sql`${leaderboard.wins} + ${isWinner ? 1 : 0}`,
          losses: sql`${leaderboard.losses} + ${!isWinner && !isDraw ? 1 : 0}`,
          draws: sql`${leaderboard.draws} + ${isDraw ? 1 : 0}`,
          lastPlayedAt: new Date(),
        },
      });

    // Also insert into games table for replay/history
    await db.insert(games).values({
      roomCode: result.roomCode,
      gameType: result.gameType,
      sessionHash: hash,
      playerHashes: JSON.stringify(result.sessionHashes),
      winnerHash: result.winnerHash,
      finalState: result.finalState,
      movesCount: result.movesCount,
      durationSecs: Math.floor(result.durationMs / 1000),
    });
  }
}

// ----- Get leaderboard -----

export async function getLeaderboard(
  gameType: GameType,
  limit = 50
): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select({
      sessionHash: leaderboard.sessionHash,
      displayName: leaderboard.displayName,
      wins: leaderboard.wins,
      losses: leaderboard.losses,
      draws: leaderboard.draws,
    })
    .from(leaderboard)
    .where(eq(leaderboard.gameType, gameType))
    .orderBy(desc(leaderboard.wins))
    .limit(limit);

  return rows.map((row, idx) => ({
    rank: idx + 1,
    sessionHash: row.sessionHash,
    displayName: row.displayName,
    stats: {
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
      gamesPlayed: Number(row.wins) + Number(row.losses) + Number(row.draws),
      winRate:
        Number(row.wins) + Number(row.losses) + Number(row.draws) > 0
          ? Math.round(
              (Number(row.wins) /
                (Number(row.wins) + Number(row.losses) + Number(row.draws))) *
                100
            )
          : 0,
    },
  }));
}
