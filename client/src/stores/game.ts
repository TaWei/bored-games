// ============================================================
// GAME STORE — current game state
// ============================================================

import { create } from 'zustand';
import type { GameState, Move, GameEnd } from '@bored-games/shared';

interface GameStore {
  /** The current game state from the server */
  state: GameState | null;
  /** Our session ID */
  mySessionId: string | null;
  /** The last move that was applied (for animation) */
  lastMove: Move | null;
  /** Is it our turn? */
  isMyTurn: boolean;
  /** Connection latency */
  latency: number;
  /** Is the socket connected? */
  isConnected: boolean;

  setState: (state: GameState, mySessionId: string) => void;
  setLastMove: (move: Move) => void;
  setLatency: (ms: number) => void;
  setConnected: (connected: boolean) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  mySessionId: null,
  lastMove: null,
  isMyTurn: false,
  latency: 0,
  isConnected: false,

  setState: (state, mySessionId) => {
    const isMyTurn = state.turn === mySessionId;
    set({ state, mySessionId, isMyTurn, lastMove: null });
  },

  setLastMove: (move) => set({ lastMove: move }),

  setLatency: (latency) => set({ latency }),

  setConnected: (isConnected) => set({ isConnected }),

  clearGame: () =>
    set({ state: null, mySessionId: null, isMyTurn: false, lastMove: null }),
}));
