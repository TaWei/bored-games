// ============================================================
// useGame — game-specific operations built on useWebSocket
// ============================================================

import { useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { useRoomStore } from '../stores/room';
import { useGameStore } from '../stores/game';
import type { TicTacToeMove, Move } from '@bored-games/shared';

interface UseGameOptions {
  roomCode: string;
  mode?: 'play' | 'spectate';
  enabled?: boolean;
}

export function useGame(opts: UseGameOptions) {
  const ws = useWebSocket(opts);
  const { room } = useRoomStore();
  const { state, isMyTurn, lastMove, mySessionId } = useGameStore();

  const sendMove = useCallback(
    (move: TicTacToeMove) => {
      if (!isMyTurn || room?.status !== 'in_progress') return;
      ws.sendMove({ type: 'MOVE', payload: { move } } as never);
    },
    [isMyTurn, room?.status, ws]
  );

  return {
    ...ws,
    sendMove,
    requestRematch: ws.requestRematch,
    resign: ws.resign,
    leaveRoom: ws.leaveRoom,
    sendChat: ws.sendChat,
    state,
    isMyTurn,
    lastMove,
    mySessionId,
    room,
  };
}
