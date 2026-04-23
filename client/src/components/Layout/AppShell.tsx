// ============================================================
// APP SHELL — main layout wrapper
// ============================================================

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { displayName, resetSession } = useSession();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="logo">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="#1e293b"/>
            <circle cx="10" cy="10" r="2" fill="#22d3ee"/>
            <circle cx="22" cy="10" r="2" fill="#22d3ee"/>
            <circle cx="16" cy="16" r="2" fill="#22d3ee"/>
            <circle cx="10" cy="22" r="2" fill="#22d3ee"/>
            <circle cx="22" cy="22" r="2" fill="#22d3ee"/>
          </svg>
          <span className="logo-text">Bored Games</span>
        </Link>

        <div className="header-right">
          <span className="identity-badge">
            <span className="identity-dot" />
            {displayName}
          </span>
          <button
            className="reset-btn"
            onClick={resetSession}
            title="New Identity — clears your stats"
          >
            New Identity
          </button>
        </div>
      </header>

      <main className="app-main">
        {children}
      </main>

      <footer className="app-footer">
        <span>No account needed — anonymous play</span>
        <span className="separator">·</span>
        <span>Server-authoritative — no cheating</span>
      </footer>
    </div>
  );
}
