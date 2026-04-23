// ============================================================
// JOIN ROOM — enter room code to join
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../Shared/Button';
import { Input } from '../Shared/Input';
import { joinRoom } from '../../lib/api';
import { normalizeRoomCode, isValidRoomCode } from '@bored-games/shared';

export function JoinRoom() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Auto-uppercase and restrict to alphanumeric
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(value);
    if (error) setError(null);
  };

  const handleJoin = async () => {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setError('Enter a valid 6-character room code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { room } = await joinRoom(normalized);
      navigate(`/room/${normalized}`);
    } catch (err) {
      if (err instanceof Error) {
        if ('code' in err) {
          const code = (err as { code?: string }).code;
          if (code === 'ROOM_NOT_FOUND') {
            setError('Room not found. Check the code and try again.');
          } else if (code === 'ROOM_FULL') {
            setError('Room is full — try another room!');
          } else if (code === 'GAME_IN_PROGRESS') {
            setError('Game already in progress — watch or wait for the next one.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to join room. Try again.');
      }
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleJoin();
  };

  return (
    <div className="join-room">
      <Input
        label="Room Code"
        placeholder="ABC123"
        value={code}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={6}
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />

      {error && <p className="form-error">{error}</p>}

      <Button
        variant="primary"
        size="lg"
        loading={loading}
        disabled={code.length < 6}
        onClick={handleJoin}
      >
        Join Room
      </Button>

      <p className="action-hint">
        Get the code from the room host
      </p>
    </div>
  );
}
