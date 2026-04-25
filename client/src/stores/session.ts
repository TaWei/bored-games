// ============================================================
// SESSION STORE — anonymous identity management
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateDisplayName, isValidDisplayName, sanitizeDisplayName } from '@bored-games/shared';

// Get or create sessionId from localStorage
function getOrCreateSessionId(): string {
  const key = 'bored-games-session';
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

interface SessionState {
  sessionId: string;
  displayName: string;
  isLoaded: boolean;

  /** Update the display name */
  setDisplayName: (name: string) => void;

  /** Reset to a completely new identity (new UUID, new name) */
  resetSession: () => void;

  /** Initialize from persisted storage */
  hydrate: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, _get) => ({
      sessionId: getOrCreateSessionId(),
      displayName: generateDisplayName(),
      isLoaded: false,

      setDisplayName: (name: string) => {
        if (!isValidDisplayName(name)) return;
        set({ displayName: sanitizeDisplayName(name) });
      },

      resetSession: () => {
        const newId = crypto.randomUUID();
        localStorage.setItem('bored-games-session', newId);
        set({
          sessionId: newId,
          displayName: generateDisplayName(),
        });
      },

      hydrate: () => {
        set({ isLoaded: true });
      },
    }),
    {
      name: 'bored-games-session-meta',
      // Only persist displayName — sessionId is managed separately via getOrCreateSessionId()
      partialize: (state) => ({ displayName: state.displayName }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Ensure sessionId is always valid (re-read from localStorage)
          state.sessionId = getOrCreateSessionId();
          state.isLoaded = true;
        }
      },
    }
  )
);
