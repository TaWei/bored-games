// ============================================================
// PLAYER BADGE — shows player name, role, and turn state
// ============================================================

interface PlayerBadgeProps {
  name: string;
  isYou?: boolean;
  isHost?: boolean;
  turn?: boolean;
  isReady?: boolean;
}

export function PlayerBadge({
  name,
  isYou = false,
  isHost = false,
  turn = false,
  isReady = true,
}: PlayerBadgeProps) {
  return (
    <div className={`player-badge ${turn ? 'player-badge-active' : ''}`}>
      <div className="player-badge-avatar">
        {isYou ? '😊' : '🤖'}
      </div>
      <div className="player-badge-info">
        <span className="player-badge-name">
          {name}
          {isYou && <span className="you-tag">(you)</span>}
        </span>
        <span className="player-badge-role">
          {isHost ? '👑 Host' : isReady ? '🟢 Ready' : '⏳ Waiting…'}
        </span>
      </div>
      {turn && <div className="player-badge-turn-indicator" aria-label="Your turn" />}
    </div>
  );
}
