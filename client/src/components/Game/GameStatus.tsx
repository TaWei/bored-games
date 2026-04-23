// ============================================================
// GAME STATUS — banner showing current game state
// ============================================================

import { useRoom } from '../../stores/room';
import { useSession } from '../../hooks/useSession';

export function GameStatus() {
  const { room } = useRoom();
  const { session } = useSession();

  if (!room) return null;

  const myPlayer = room.players.find((p) => p.sessionId === session?.id);
  const isMyTurn = room.game?.currentPlayerId === session?.id;
  const gameType = room.game?.type ?? 'unknown';
  const status = room.status;

  let message = '';
  let subtext = '';
  let variant: 'info' | 'turn' | 'win' | 'lose' | 'draw' = 'info';

  if (status === 'waiting') {
    message = 'Waiting for opponent…';
    subtext = 'Share the room link to invite a friend';
    variant = 'info';
  } else if (status === 'playing') {
    if (isMyTurn) {
      message = 'Your turn';
      subtext = `Playing ${gameType}`;
      variant = 'turn';
    } else {
      const opponent = room.players.find((p) => p.sessionId !== session?.id);
      message = `${opponent?.displayName ?? 'Opponent'}'s turn`;
      subtext = `Playing ${gameType}`;
      variant = 'info';
    }
  } else if (status === 'game_over') {
    const winnerId = (room.game as any)?.winnerId;
    if (!winnerId) {
      message = "It's a draw!";
      subtext = 'Well played by both sides';
      variant = 'draw';
    } else if (winnerId === session?.id) {
      message = 'You win! 🎉';
      subtext = 'Congratulations on your victory';
      variant = 'win';
    } else {
      const winner = room.players.find((p) => p.sessionId === winnerId);
      message = `${winner?.displayName ?? 'Opponent'} wins!`;
      subtext = 'Better luck next time';
      variant = 'lose';
    }
  }

  return (
    <div className={`game-status game-status-${variant}`}>
      <span className="game-status-message">{message}</span>
      {subtext && <span className="game-status-subtext">{subtext}</span>}
    </div>
  );
}
