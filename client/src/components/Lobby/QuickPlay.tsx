// ============================================================
// QUICK PLAY — anonymous matchmaking queue
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../Shared/Button';
import { addToQueue, removeFromQueue } from '../../lib/api';
import { useSession } from '../../hooks/useSession';

// TODO: wire up WebSocket notifications for queue match
// For now, this is a simplified version that polls

export function QuickPlay() {
  const [selectedGame, setSelectedGame] = useState('tic-tac-toe');
  const [status, setStatus] = useState<'idle' | 'queued' | 'matched'>('idle');
  const [position, setPosition] = useState<number | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const { sessionId } = useSession();
  const navigate = useNavigate();
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFindMatch = async () => {
    try {
      await addToQueue(selectedGame, sessionId);
      setStatus('queued');

      // Poll for match (simple approach — server will match and redirect)
      // In production, use WebSocket notification
      pollIntervalRef.current = setInterval(async () => {
        // TODO: poll /api/matchmaking/status endpoint
        // For now, just show waiting UI
      }, 2000);
    } catch (err) {
      console.error('Failed to join queue:', err);
    }
  };

  const handleCancel = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    try {
      await removeFromQueue(selectedGame, sessionId);
    } catch {
      // ignore
    }
    setStatus('idle');
    setPosition(null);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  if (roomCode) {
    navigate(`/room/${roomCode}`);
    return null;
  }

  return (
    <div className="quick-play">
      {status === 'idle' ? (
        <>
          <div className="game-selector">
            <label className="selector-label">Choose a game</label>
            <div className="game-options">
              <button
                className={`game-option ${selectedGame === 'tic-tac-toe' ? 'selected' : ''}`}
                onClick={() => setSelectedGame('tic-tac-toe')}
                type="button"
              >
                <span className="option-icon">🎯</span>
                <span className="option-name">Tic-Tac-Toe</span>
              </button>
            </div>
          </div>

          <Button variant="primary" size="lg" onClick={handleFindMatch}>
            Find Match
          </Button>

          <p className="action-hint">
            Matched with a random opponent and play instantly
          </p>
        </>
      ) : (
        <div className="queue-status">
          <div className="queue-animation">
            <div className="pulse-ring" />
            <div className="pulse-ring delay-1" />
            <div className="pulse-ring delay-2" />
            <span className="queue-icon">🎮</span>
          </div>

          <p className="queue-message">
            Looking for an opponent<span className="dots">...</span>
          </p>

          {position !== null && (
            <p className="queue-position">Queue position: {position}</p>
          )}

          <Button variant="secondary" size="md" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
