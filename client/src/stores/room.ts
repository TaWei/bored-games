// ============================================================
// ROOM STORE — current room state
// ============================================================

import { create } from 'zustand';
import type { Room, Spectator } from '@bored-games/shared';

interface RoomState {
  /** The room we're currently in */
  room: Room | null;
  /** Our assigned symbol in this room (X/O/white/black) */
  mySymbol: string | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if last operation failed */
  error: string | null;
  /** Am I a spectator? */
  isSpectator: boolean;

  setRoom: (room: Room, symbol?: string, isSpectator?: boolean) => void;
  updateRoom: (patch: Partial<Room>) => void;
  addPlayer: (player: Room['players'][0]) => void;
  removePlayer: (sessionId: string) => void;
  addSpectator: (spectator: Spectator) => void;
  removeSpectator: (sessionId: string) => void;
  clearRoom: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  room: null,
  mySymbol: null,
  isLoading: false,
  error: null,
  isSpectator: false,

  setRoom: (room, symbol = null, isSpectator = false) =>
    set({ room, mySymbol: symbol, isSpectator, error: null }),

  updateRoom: (patch) =>
    set((state) => ({
      room: state.room ? { ...state.room, ...patch } : null,
    })),

  addPlayer: (player) =>
    set((state) => {
      if (!state.room) return {};
      const exists = state.room.players.some((p) => p.sessionId === player.sessionId);
      if (exists) return {};
      return {
        room: { ...state.room, players: [...state.room.players, player] },
      };
    }),

  removePlayer: (sessionId) =>
    set((state) => {
      if (!state.room) return {};
      return {
        room: {
          ...state.room,
          players: state.room.players.filter((p) => p.sessionId !== sessionId),
        },
      };
    }),

  addSpectator: (spectator) =>
    set((state) => {
      if (!state.room) return {};
      return {
        room: {
          ...state.room,
          spectators: [...state.room.spectators, spectator],
        },
      };
    }),

  removeSpectator: (sessionId) =>
    set((state) => {
      if (!state.room) return {};
      return {
        room: {
          ...state.room,
          spectators: state.room.spectators.filter((s) => s.sessionId !== sessionId),
        },
      };
    }),

  clearRoom: () =>
    set({ room: null, mySymbol: null, isSpectator: false, error: null }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),
}));
