// ============================================================
// GAME PAGE — main game view, route: /room/:code
// ============================================================

import { useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../Layout/AppShell';
import { useSession } from '../../hooks/useSession';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { TicTacToeBoard } from './TicTacToeBoard';
import { AvalonBoard } from './AvalonBoard';
import { CodenamesBoard } from './CodenamesBoard';
import { PlayerBadge } from './PlayerBadge';
import { GameStatus } from './GameStatus';
import { Button } from '../Shared/Button';
import { useState } from 'react';
import type { Player } from '@bored-games/shared';

export function GamePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const { room, isLoading, error } = useRoom();
  const { leaveRoom, resign } = useGame();
  const [showShareToast, setShowShareToast] = useState(false);

  const shareLink = `${window.location.origin}/room/${code}`;

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 2000);
    } catch {
      prompt('Copy this link to share:', shareLink);
    }
  };

  const handleLeave = () => {
    leaveRoom();
    navigate('/');
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

  const { state } = useGame();
  const myPlayer = room.players.find((p: Player) => p.sessionId === session.id);
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
                  isHost={myPlayer?.sessionId === room.hostSessionId}
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
        {(room.status === 'in_progress' || room.status === 'completed') && (
          <div className="active-game">
            {/* Player bar */}
            <div className="player-bar">
              {room.players.map((player: Player) => (
                <PlayerBadge
                  key={player.sessionId}
                  name={player.displayName}
                  isYou={player.sessionId === session.id}
                  isHost={player.sessionId === room.hostSessionId}
                  turn={state?.turn === player.sessionId}
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
              {state?.gameType === 'tic-tac-toe' && <TicTacToeBoard />}
              {state?.gameType === 'avalon' && <AvalonBoard />}
              {state?.gameType === 'codenames' && <CodenamesBoard />}
            </div>

            {/* Game actions */}
            <div className="game-actions">
              {room.status === 'in_progress' && myPlayer && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={resign}
                >
                  Resign
                </Button>
              )}
              {room.status === 'completed' && (
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
