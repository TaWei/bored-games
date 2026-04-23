-- ============================================================
-- INITIAL SCHEMA — Bored Games
-- Run: bun run db:migrate
-- ============================================================

CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code CHAR(6) NOT NULL,
    game_type VARCHAR(32) NOT NULL,
    session_hash VARCHAR(64) NOT NULL,
    player_hashes VARCHAR(512) NOT NULL,  -- JSON array of hashes
    winner_hash VARCHAR(64),
    final_state JSONB NOT NULL,
    moves_count INTEGER NOT NULL,
    duration_secs INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_game_type ON games(game_type);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_room_code ON games(room_code);

CREATE TABLE IF NOT EXISTS leaderboard (
    session_hash VARCHAR(64) NOT NULL,
    display_name VARCHAR(32) NOT NULL DEFAULT 'Anonymous',
    game_type VARCHAR(32) NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    last_played_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (session_hash, game_type)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_game_wins
    ON leaderboard(game_type, wins DESC)
    WHERE wins > 0;

COMMENT ON TABLE games IS 'Completed game records — append-only';
COMMENT ON TABLE leaderboard IS 'Anonymous player statistics by session hash';
COMMENT ON COLUMN games.session_hash IS 'SHA256 of sessionId — anonymous identifier';
COMMENT ON COLUMN leaderboard.session_hash IS 'SHA256 of sessionId — anonymous identifier';
