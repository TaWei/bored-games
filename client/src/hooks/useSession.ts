// ============================================================
// useSession — hook around session store
// ============================================================

import { useEffect } from 'react';
import { useSessionStore } from '../stores/session';

export function useSession() {
  const session = useSessionStore();

  // Hydrate on mount
  useEffect(() => {
    session.hydrate();
  }, []);

  return session;
}
