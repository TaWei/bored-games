// ============================================================
// CREATE ROOM — game type selector + create button
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../Shared/Button';
import { createRoom } from '../../lib/api';
import { useSession } from '../../hooks/useSession';

export function CreateRoom() {
  const [selectedGame, setSelectedGame] = useState('tic-tac-toe');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { sessionId, displayName } = useSession();
  const navigate = useNavigate();

  const handleCreate = async () => {
    setLoading(true);
    setError(null);

    try {
      const { roomCode } = await createRoom(selectedGame);
      navigate(`/room/${roomCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
      setLoading(false);
    }
  };

  return (
    <div className="create-room">
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
          <button
            className={`game-option ${selectedGame === 'chess' ? 'selected' : ''} disabled`}
            onClick={() => {}}
            type="button"
            disabled
          >
            <span className="option-icon">♟️</span>
            <span className="option-name">Chess</span>
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <Button
        variant="primary"
        size="lg"
        loading={loading}
        onClick={handleCreate}
      >
        Create Room
      </Button>

      <p className="action-hint">
        You'll get a room code to share with your opponent
      </p>
    </div>
  );
}
