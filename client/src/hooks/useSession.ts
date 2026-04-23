// ============================================================
// useSession — hook around session store
// ============================================================

import { useEffect } from 'react';
import { useSessionStore } from '../stores/session';

export function useSession() {
  const store = useSessionStore();

  // Hydrate on mount
  useEffect(() => {
    store.hydrate();
  }, []);

  // Return a session wrapper object for ergonomic access
  return {
    session: {
      id: store.sessionId,
      name: store.displayName,
    },
    sessionId: store.sessionId,
    displayName: store.displayName,
    isLoaded: store.isLoaded,
    setDisplayName: store.setDisplayName,
    resetSession: store.resetSession,
  };
}
