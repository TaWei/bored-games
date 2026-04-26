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
  const { setRoom, updateRoom, addPlayer, removePlayer, addSpectator, removeSpectator, setError, setLoading } = useRoomStore();
  const { setState, setLastMove, setLatency, setConnected, clearGame } = useGameStore();
  const socketRef = useRef<GameSocket | null>(null);

  // --- Setup socket + handlers ---
  useEffect(() => {
    if (!enabled || !sessionId || !roomCode) return;

    // Show loading state while connecting
    setLoading(true);
    setError(null);

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
      setLoading(false);
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
      setLoading(false);
    });

    socket.on('ROOM_NOT_FOUND', () => {
      setError('Room not found. Check the code and try again.');
      setConnected(false);
      setLoading(false);
    });

    // ── Avalon-specific handlers ──

    socket.on('AVALON_ROLE_ASSIGNED', (msg) => {
      if (msg.type !== 'AVALON_ROLE_ASSIGNED') return;
      // Private role info — in a real app this would go to a private store
      // For now we log to console so testers can see role assignments
      console.info('[Avalon] Your role:', msg.payload.role, '| Evil:', msg.payload.isEvil);
    });

    socket.on('AVALON_PHASE_CHANGE', (msg) => {
      if (msg.type !== 'AVALON_PHASE_CHANGE') return;
      console.info('[Avalon] Phase changed to:', msg.payload.phase);
    });

    socket.on('AVALON_TEAM_PROPOSED', (msg) => {
      if (msg.type !== 'AVALON_TEAM_PROPOSED') return;
      console.info('[Avalon] Team proposed by', msg.payload.leader, ':', msg.payload.team);
    });

    socket.on('AVALON_TEAM_VOTE', (msg) => {
      if (msg.type !== 'AVALON_TEAM_VOTE') return;
      console.info('[Avalon] Vote results:', msg.payload.votesReceived, '/', Object.keys(msg.payload.votes).length);
    });

    socket.on('AVALON_QUEST_RESULT', (msg) => {
      if (msg.type !== 'AVALON_QUEST_RESULT') return;
      console.info('[Avalon] Quest result:', msg.payload.succeeded ? 'PASSED' : 'FAILED', '| Fail cards:', msg.payload.failCards);
    });

    socket.on('AVALON_MISSION_UPDATE', (msg) => {
      if (msg.type !== 'AVALON_MISSION_UPDATE') return;
      console.info('[Avalon] Mission update:', msg.payload.mission, msg.payload.results);
    });

    socket.on('AVALON_ASSASSINATION_PHASE', (msg) => {
      if (msg.type !== 'AVALON_ASSASSINATION_PHASE') return;
      console.info('[Avalon] Assassination phase — candidates:', msg.payload.candidates);
    });

    socket.on('AVALON_ASSASSINATION_VOTE', (msg) => {
      if (msg.type !== 'AVALON_ASSASSINATION_VOTE') return;
      console.info('[Avalon] Assassination vote:', msg.payload.votes);
    });

    socket.on('AVALON_ROLE_REVEAL', (msg) => {
      if (msg.type !== 'AVALON_ROLE_REVEAL') return;
      console.info('[Avalon] Role reveal —', msg.payload.target, 'is', msg.payload.role);
    });

    socket.on('AVALON_ABILITY_USED', (msg) => {
      if (msg.type !== 'AVALON_ABILITY_USED') return;
      console.info('[Avalon] Ability used:', msg.payload.ability, 'by', msg.payload.player, '→', msg.payload.target);
    });

    socket.on('AVALON_LANCELOT_FLIPPED', (msg) => {
      if (msg.type !== 'AVALON_LANCELOT_FLIPPED') return;
      console.info('[Avalon] Lancelot flipped!', msg.payload.player, '→', msg.payload.newAlignment);
    });

    // ── Codenames-specific handlers ──

    socket.on('CODENAMES_ROLE_ASSIGNED', (msg) => {
      if (msg.type !== 'CODENAMES_ROLE_ASSIGNED') return;
      console.info(
        '[Codenames] Your team:',
        msg.payload.team,
        '| Your role:',
        msg.payload.role
      );
    });

    socket.on('CODENAMES_CLUE_GIVEN', (msg) => {
      if (msg.type !== 'CODENAMES_CLUE_GIVEN') return;
      console.info(
        '[Codenames] Clue given:',
        msg.payload.word,
        msg.payload.number
      );
    });

    socket.on('CODENAMES_CARD_REVEALED', (msg) => {
      if (msg.type !== 'CODENAMES_CARD_REVEALED') return;
      console.info('[Codenames] Card revealed.', msg.payload);
    });

    socket.on('CODENAMES_TURN_ENDED', (msg) => {
      if (msg.type !== 'CODENAMES_TURN_ENDED') return;
      console.info('[Codenames] Turn ended.', msg.payload);
    });

    socket.on('CODENAMES_GAME_END', (msg) => {
      if (msg.type !== 'CODENAMES_GAME_END') return;
      console.info('[Codenames] Game over — winner:', msg.payload.winner);
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
