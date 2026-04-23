// ============================================================
// useWebSocket — manages GameSocket lifecycle, room join, messages
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '../stores/session';
import { useRoomStore } from '../stores/room';
import { useGameStore } from '../stores/game';
import { GameSocket } from '../lib/websocket';
import type { ServerMessage } from '@bored-games/shared';

interface UseWebSocketOptions {
  roomCode: string;
  mode?: 'play' | 'spectate';
  enabled?: boolean;
}

export function useWebSocket({ roomCode, mode = 'play', enabled = true }: UseWebSocketOptions) {
  const { sessionId, displayName } = useSessionStore();
  const { setRoom, updateRoom, addPlayer, removePlayer, addSpectator, removeSpectator, setError } = useRoomStore();
  const { setState, setLastMove, setLatency, setConnected, clearGame } = useGameStore();
  const socketRef = useRef<GameSocket | null>(null);

  // --- Setup socket + handlers ---
  useEffect(() => {
    if (!enabled || !sessionId || !roomCode) return;

    const socket = new GameSocket(sessionId, roomCode, mode);
    socketRef.current = socket;

    // Set up latency tracking
    socket.onLatencyChange(setLatency);

    // ── Message handlers ──

    socket.on('ROOM_JOINED', (msg) => {
      if (msg.type !== 'ROOM_JOINED') return;
      const { room, symbol, mySessionId } = msg.payload;
      setRoom(room, symbol, mode === 'spectate');
      setConnected(true);
    });

    socket.on('PLAYER_JOINED', (msg) => {
      if (msg.type !== 'PLAYER_JOINED') return;
      addPlayer(msg.payload.player);
    });

    socket.on('PLAYER_LEFT', (msg) => {
      if (msg.type !== 'PLAYER_LEFT') return;
      removePlayer(msg.payload.sessionId);
    });

    socket.on('SPECTATOR_JOINED', (msg) => {
      if (msg.type !== 'SPECTATOR_JOINED') return;
      addSpectator(msg.payload.spectator);
    });

    socket.on('SPECTATOR_LEFT', (msg) => {
      if (msg.type !== 'SPECTATOR_LEFT') return;
      removeSpectator(msg.payload.sessionId);
    });

    socket.on('GAME_START', (msg) => {
      if (msg.type !== 'GAME_START') return;
      setState(msg.payload.state, sessionId);
      updateRoom({ status: 'in_progress' });
    });

    socket.on('STATE_UPDATE', (msg) => {
      if (msg.type !== 'STATE_UPDATE') return;
      setState(msg.payload.state, sessionId);
      setLastMove(msg.payload.lastMove);
    });

    socket.on('GAME_END', (msg) => {
      if (msg.type !== 'GAME_END') return;
      setState(msg.payload.state, sessionId);
      updateRoom({ status: 'completed' });
    });

    socket.on('ERROR', (msg) => {
      if (msg.type !== 'ERROR') return;
      setError(msg.payload.message);
    });

    socket.on('ROOM_NOT_FOUND', () => {
      setError('Room not found. Check the code and try again.');
      setConnected(false);
    });

    // Connect
    socket.connect();

    // Heartbeat every 10 seconds
    const heartbeatInterval = setInterval(() => {
      socket.send({ type: 'HEARTBEAT', payload: { clientTime: Date.now() } });
    }, 10_000);

    return () => {
      clearInterval(heartbeatInterval);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      clearGame();
    };
  }, [enabled, sessionId, roomCode, mode]);

  // --- Send helpers ---
  const send = useCallback((msg: Parameters<GameSocket['send']>[0]) => {
    socketRef.current?.send(msg);
  }, []);

  const sendMove = useCallback((move: Parameters<typeof send>[0] extends { payload: infer P } ? P : never) => {
    socketRef.current?.send({ type: 'MOVE', payload: { move } } as Parameters<typeof send>[0]);
  }, []);

  const requestRematch = useCallback(() => {
    socketRef.current?.send({ type: 'REMATCH_REQUEST' });
  }, []);

  const resign = useCallback(() => {
    socketRef.current?.send({ type: 'RESIGN' });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.send({ type: 'LEAVE_ROOM' });
    socketRef.current?.disconnect();
  }, []);

  const sendChat = useCallback((message: string) => {
    socketRef.current?.send({ type: 'CHAT', payload: { message } });
  }, []);

  return {
    socket: socketRef.current,
    send,
    sendMove,
    requestRematch,
    resign,
    leaveRoom,
    sendChat,
    isConnected: socketRef.current?.isConnected() ?? false,
  };
}
