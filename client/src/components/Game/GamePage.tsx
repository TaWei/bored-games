// ============================================================
// GAME PAGE — main game view, route: /room/:code
// ============================================================

import { useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../Layout/AppShell';
import { useSession } from '../../hooks/useSession';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { TicTacToeBoard } from './TicTacToeBoard';
import { PlayerBadge } from './PlayerBadge';
import { GameStatus } from './GameStatus';
import { Button } from '../Shared/Button';
import { useState } from 'react';

export function GamePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const { room, isLoading, error, disconnect } = useRoom();
  const { sendLeave, sendResign } = useGame();
  const [showShareToast, setShowShareToast] = useState(false);

  const shareLink = `${window.location.origin}/room/${code}`;

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      prompt('Copy this link to share:', shareLink);
    }
  };

  const handleLeave = () => {
    sendLeave();
    disconnect();
    navigate('/');
  };

  const handleResign = () => {
    sendResign();
  };

  // Loading state
  if (isLoading) {
    return (
      <AppShell>
        <div className="game-view">
          <div className="game-loading">
            <div className="loading-spinner" />
            <p>Connecting to room {code}…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Error state
  if (error || !room) {
    return (
      <AppShell>
        <div className="game-view">
          <div className="game-error">
            <h2>Room Not Found</h2>
            <p>{error ?? `Room "${code}" does not exist or has expired.`}</p>
            <Button onClick={() => navigate('/')}>Back to Lobby</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const isHost = room.hostSessionId === session?.id;
  const myPlayer = room.players.find((p) => p.sessionId === session?.id);
  const opponent = room.players.find((p) => p.sessionId !== session?.id);
  const isSpectating = !myPlayer && room.status !== 'waiting';

  return (
    <AppShell>
      <div className="game-view">
        {/* Room header */}
        <div className="room-header">
          <div className="room-code-display">
            <span className="room-code-label">Room</span>
            <span className="room-code-value">{code}</span>
          </div>
          <div className="room-actions">
            <Button variant="ghost" size="sm" onClick={handleShare}>
              📋 Share
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLeave}>
              ← Leave
            </Button>
          </div>
        </div>

        {showShareToast && (
          <div className="toast">Link copied to clipboard!</div>
        )}

        {/* Waiting room */}
        {room.status === 'waiting' && (
          <div className="waiting-room">
            <div className="waiting-room-card">
              <h2>Waiting for opponent…</h2>
              <p>Share the room link to invite someone:</p>
              <div className="share-link-box">
                <code>{shareLink}</code>
                <Button size="sm" variant="secondary" onClick={handleShare}>
                  Copy
                </Button>
              </div>

              <div className="waiting-players">
                <PlayerBadge
                  name={myPlayer?.displayName ?? 'You'}
                  isHost
                  isYou
                  isReady={false}
                />
                <span className="vs-separator">vs</span>
                <PlayerBadge name="???" isReady={false} />
              </div>

              <p className="waiting-hint">
                {room.players.length} / 2 players joined
              </p>
            </div>
          </div>
        )}

        {/* Game in progress or ended */}
        {(room.status === 'playing' || room.status === 'game_over') && (
          <div className="active-game">
            {/* Player bar */}
            <div className="player-bar">
              {room.players.map((player) => (
                <PlayerBadge
                  key={player.sessionId}
                  name={player.displayName}
                  isYou={player.sessionId === session?.id}
                  isHost={player.sessionId === room.hostSessionId}
                  turn={
                    room.game?.currentPlayerId ===
                    player.sessionId
                  }
                />
              ))}
              {isSpectating && (
                <span className="spectating-badge">👁️ Spectating</span>
              )}
            </div>

            {/* Game status */}
            <GameStatus />

            {/* Game board */}
            <div className="board-container">
              {room.game?.type === 'tic-tac-toe' && <TicTacToeBoard />}
            </div>

            {/* Game actions */}
            <div className="game-actions">
              {room.status === 'playing' && myPlayer && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleResign}
                >
                  Resign
                </Button>
              )}
              {room.status === 'game_over' && (
                <Button
                  variant="primary"
                  onClick={() => navigate('/')}
                >
                  Back to Lobby
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
