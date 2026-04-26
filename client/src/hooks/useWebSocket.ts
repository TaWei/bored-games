     1|     1|// ============================================================
     2|     2|// useWebSocket — manages GameSocket lifecycle, room join, messages
     3|     3|// ============================================================
     4|     4|
     5|     5|import { useEffect, useRef, useCallback, useState } from 'react';
     6|     6|import { useSessionStore } from '../stores/session';
     7|     7|import { useRoomStore } from '../stores/room';
     8|     8|import { useGameStore } from '../stores/game';
     9|     9|import { GameSocket } from '../lib/websocket';
    10|    10|import type { ServerMessage } from '@bored-games/shared';
    11|    11|
    12|    12|interface UseWebSocketOptions {
    13|    13|  roomCode: string;
    14|    14|  mode?: 'play' | 'spectate';
    15|    15|  enabled?: boolean;
    16|    16|}
    17|    17|
    18|    18|export function useWebSocket({ roomCode, mode = 'play', enabled = true }: UseWebSocketOptions) {
    19|    19|  const { sessionId, displayName } = useSessionStore();
    20|    20|  const { setRoom, updateRoom, addPlayer, removePlayer, addSpectator, removeSpectator, setError, setLoading } = useRoomStore();
    21|    21|  const { setState, setLastMove, setLatency, setConnected, clearGame } = useGameStore();
    22|    22|  const socketRef = useRef<GameSocket | null>(null);
    23|    23|  const intentionallyClosedRef = useRef(false);
    24|    24|  const [socket, setSocketState] = useState<GameSocket | null>(null);
    25|    25|
    26|    26|  // --- Setup socket + handlers ---
    27|    27|  useEffect(() => {
    28|    28|    console.log('[WS] Effect running — enabled:', enabled, 'sessionId:', sessionId, 'roomCode:', roomCode, 'mode:', mode);
    29|    29|    if (!enabled || !sessionId || !roomCode) {
    30|    30|      console.log('[WS] Early return — missing:', !enabled ? 'enabled' : !sessionId ? 'sessionId' : 'roomCode');
    31|    31|      return;
    32|    32|    }
    33|    33|
    34|    34|    console.log('[WS] Creating GameSocket with URL:', `/ws?sessionId=${encodeURIComponent(sessionId)}&room=${encodeURIComponent(roomCode)}&mode=${mode}`);
    35|    35|    // Show loading state while connecting
    36|    36|    setLoading(true);
    37|    37|    setError(null);
    38|    38|
    39|    39|    const socket = new GameSocket(sessionId, roomCode, mode);
    40|    40|    socketRef.current = socket;
    41|    41|    setSocketState(socket);
    42|    42|
    43|    43|    // Set up latency tracking
    44|    44|    socket.onLatencyChange(setLatency);
    45|    45|
    46|    46|    // ── Message handlers ──
    47|    47|
    48|    48|    socket.on('ROOM_JOINED', (msg) => {
    49|    49|      const { room, symbol, mySessionId } = msg.payload;
    50|    50|      setRoom(room, symbol, mode === 'spectate');
    51|    51|      setConnected(true);
    52|    52|      setLoading(false);
    53|    53|    });
    54|    54|
    55|    55|    socket.on('PLAYER_JOINED', (msg) => {
    56|    56|      addPlayer(msg.payload.player);
    57|    57|    });
    58|    58|
    59|    59|    socket.on('PLAYER_LEFT', (msg) => {
    60|    60|      removePlayer(msg.payload.sessionId);
    61|    61|    });
    62|    62|
    63|    63|    socket.on('SPECTATOR_JOINED', (msg) => {
    64|    64|      addSpectator(msg.payload.spectator);
    65|    65|    });
    66|    66|
    67|    67|    socket.on('SPECTATOR_LEFT', (msg) => {
    68|    68|      removeSpectator(msg.payload.sessionId);
    69|    69|    });
    70|    70|
    71|    71|    socket.on('GAME_START', (msg) => {
    72|    72|      console.log('[WS] GAME_START handler firing — sessionId in closure:', sessionId, 'msg.payload.players:', msg.payload.state?.players, 'msg.payload.turn:', msg.payload.state?.turn);
    73|    73|      setState(msg.payload.state, sessionId);
    74|    74|      console.log('[WS] After setState — calling updateRoom');
    75|    75|      updateRoom({ status: 'in_progress' });
    76|    76|      console.log('[WS] After updateRoom — handler done');
    77|    77|    });
    78|    78|
    79|    79|    socket.on('STATE_UPDATE', (msg) => {
    80|    80|      setState(msg.payload.state, sessionId);
    81|    81|      setLastMove(msg.payload.lastMove);
    82|    82|    });
    83|    83|
    84|    84|    socket.on('GAME_END', (msg) => {
    85|    85|      setState(msg.payload.state, sessionId);
    86|    86|      updateRoom({ status: 'completed' });
    87|    87|    });
    88|    88|
    89|    89|    socket.on('ERROR', (msg) => {
    90|    90|      setError(msg.payload.message);
    91|    91|      setLoading(false);
    92|    92|    });
    93|    93|
    94|    94|    socket.on('ROOM_NOT_FOUND', () => {
    95|    95|      setError('Room not found. Check the code and try again.');
    96|    96|      setConnected(false);
    97|    97|      setLoading(false);
    98|    98|    });
    99|    99|
   100|   100|    // ── Avalon-specific handlers ──
   101|   101|
   102|   102|    socket.on('AVALON_ROLE_ASSIGNED', (msg) => {
   104|   104|      // Private role info — in a real app this would go to a private store
   105|   105|      // For now we log to console so testers can see role assignments
   106|   106|      console.info('[Avalon] Your role:', msg.payload.role, '| Evil:', msg.payload.isEvil);
   107|   107|    });
   108|   108|
   109|   109|    socket.on('AVALON_PHASE_CHANGE', (msg) => {
   111|   111|      console.info('[Avalon] Phase changed to:', msg.payload.phase);
   112|   112|    });
   113|   113|
   114|   114|    socket.on('AVALON_TEAM_PROPOSED', (msg) => {
   116|   116|      console.info('[Avalon] Team proposed by', msg.payload.leader, ':', msg.payload.team);
   117|   117|    });
   118|   118|
   119|   119|    socket.on('AVALON_TEAM_VOTE', (msg) => {
   121|   121|      console.info('[Avalon] Vote results:', msg.payload.votesReceived, '/', Object.keys(msg.payload.votes).length);
   122|   122|    });
   123|   123|
   124|   124|    socket.on('AVALON_QUEST_RESULT', (msg) => {
   126|   126|      console.info('[Avalon] Quest result:', msg.payload.succeeded ? 'PASSED' : 'FAILED', '| Fail cards:', msg.payload.failCards);
   127|   127|    });
   128|   128|
   129|   129|    socket.on('AVALON_MISSION_UPDATE', (msg) => {
   131|   131|      console.info('[Avalon] Mission update:', msg.payload.mission, msg.payload.results);
   132|   132|    });
   133|   133|
   134|   134|    socket.on('AVALON_ASSASSINATION_PHASE', (msg) => {
   136|   136|      console.info('[Avalon] Assassination phase — candidates:', msg.payload.candidates);
   137|   137|    });
   138|   138|
   139|   139|    socket.on('AVALON_ASSASSINATION_VOTE', (msg) => {
   141|   141|      console.info('[Avalon] Assassination vote:', msg.payload.votes);
   142|   142|    });
   143|   143|
   144|   144|    socket.on('AVALON_ROLE_REVEAL', (msg) => {
   146|   146|      console.info('[Avalon] Role reveal —', msg.payload.target, 'is', msg.payload.role);
   147|   147|    });
   148|   148|
   149|   149|    socket.on('AVALON_ABILITY_USED', (msg) => {
   151|   151|      console.info('[Avalon] Ability used:', msg.payload.ability, 'by', msg.payload.player, '→', msg.payload.target);
   152|   152|    });
   153|   153|
   154|   154|    socket.on('AVALON_LANCELOT_FLIPPED', (msg) => {
   156|   156|      console.info('[Avalon] Lancelot flipped!', msg.payload.player, '→', msg.payload.newAlignment);
   157|   157|    });
   158|   158|
   159|   159|    // ── Codenames-specific handlers ──
   160|   160|
   161|   161|    socket.on('CODENAMES_ROLE_ASSIGNED', (msg) => {
   163|   163|      console.info(
   164|   164|        '[Codenames] Your team:',
   165|   165|        msg.payload.team,
   166|   166|        '| Your role:',
   167|   167|        msg.payload.role
   168|   168|      );
   169|   169|    });
   170|   170|
   171|   171|    socket.on('CODENAMES_CLUE_GIVEN', (msg) => {
   173|   173|      console.info(
   174|   174|        '[Codenames] Clue given:',
   175|   175|        msg.payload.word,
   176|   176|        msg.payload.number
   177|   177|      );
   178|   178|    });
   179|   179|
   180|   180|    socket.on('CODENAMES_CARD_REVEALED', (msg) => {
   182|   182|      console.info('[Codenames] Card revealed.', msg.payload);
   183|   183|    });
   184|   184|
   185|   185|    socket.on('CODENAMES_TURN_ENDED', (msg) => {
   187|   187|      console.info('[Codenames] Turn ended.', msg.payload);
   188|   188|    });
   189|   189|
   190|   190|    socket.on('CODENAMES_GAME_END', (msg) => {
   192|   192|      console.info('[Codenames] Game over — winner:', msg.payload.winner);
   193|   193|    });
   194|   194|
   195|   195|    // Connect
   196|   196|    socket.connect();
   197|   197|
   198|   198|    // Heartbeat every 10 seconds
   199|   199|    const heartbeatInterval = setInterval(() => {
   200|   200|      socket.send({ type: 'HEARTBEAT', payload: { clientTime: Date.now() } });
   201|   201|    }, 10_000);
   202|   202|
   203|   203|    return () => {
   204|   204|      intentionallyClosedRef.current = true;
   205|   205|      clearInterval(heartbeatInterval);
   206|   206|      socket.disconnect();
   207|   207|      socketRef.current = null;
   208|   208|      setSocketState(null);
   209|   209|      setConnected(false);
   210|   210|      clearGame();
   211|   211|    };
   212|   212|  }, [enabled, sessionId, roomCode, mode]);
   213|   213|
   214|   214|  // --- Send helpers ---
   215|   215|  const send = useCallback((msg: Parameters<GameSocket['send']>[0]) => {
   216|   216|    socketRef.current?.send(msg);
   217|   217|  }, []);
   218|   218|
   219|   219|  const sendMove = useCallback((move: Parameters<typeof send>[0] extends { payload: infer P } ? P : never) => {
   220|   220|    socketRef.current?.send({ type: 'MOVE', payload: { move } } as Parameters<typeof send>[0]);
   221|   221|  }, []);
   222|   222|
   223|   223|  const requestRematch = useCallback(() => {
   224|   224|    socketRef.current?.send({ type: 'REMATCH_REQUEST' });
   225|   225|  }, []);
   226|   226|
   227|   227|  const resign = useCallback(() => {
   228|   228|    socketRef.current?.send({ type: 'RESIGN' });
   229|   229|  }, []);
   230|   230|
   231|   231|  const leaveRoom = useCallback(() => {
   232|   232|    intentionallyClosedRef.current = true;
   233|   233|    socketRef.current?.disconnect();
   234|   234|    setConnected(false);
   235|   235|    clearGame();
   236|   236|  }, []);
   237|   237|
   238|   238|  const sendChat = useCallback((message: string) => {
   239|   239|    socketRef.current?.send({ type: 'CHAT', payload: { message } });
   240|   240|  }, []);
   241|   241|
   242|   242|  return {
   243|   243|    socket,
   244|   244|    send,
   245|   245|    sendMove,
   246|   246|    requestRematch,
   247|   247|    resign,
   248|   248|    leaveRoom,
   249|   249|    sendChat,
   250|   250|    isConnected: socket?.isConnected() ?? false,
   251|   251|  };
   252|   252|}
   253|   253|