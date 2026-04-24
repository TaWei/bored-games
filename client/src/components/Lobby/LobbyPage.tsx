// ============================================================
// LOBBY PAGE — main landing / home page
// ============================================================

import { useState } from 'react';
import { AppShell } from '../Layout/AppShell';
import { CreateRoom } from './CreateRoom';
import { JoinRoom } from './JoinRoom';
import { QuickPlay } from './QuickPlay';

type ActiveTab = 'create' | 'join' | 'quick';

const GAMES = [
  {
    name: 'Tic-Tac-Toe',
    icon: '🎯',
    description: 'Classic 3x3 — get three in a row',
    players: '2 players',
    available: true,
  },
  {
    name: 'Chess',
    icon: '♟️',
    description: 'Full chess rules — coming soon',
    players: '2 players',
    available: false,
  },
  {
    name: 'Avalon',
    icon: '🛡️',
    description: 'The Resistance — social deduction for 5–10 players',
    players: '5–10 players',
    available: true,
  },
];

export function LobbyPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('create');

  return (
    <AppShell>
      <div className="lobby">
        {/* Hero */}
        <section className="hero">
          <h1 className="hero-title">
            Play Board Games
            <br />
            <span className="hero-accent">Instantly. Anonymously.</span>
          </h1>
          <p className="hero-subtitle">
            No account. No email. No friction.
            Pick a game, share a link, play.
          </p>
        </section>

        {/* Game cards */}
        <section className="game-cards">
          {GAMES.map((game) => (
            <div
              key={game.name}
              className={`game-card ${game.available ? 'available' : 'coming-soon'}`}
            >
              <span className="game-card-icon">{game.icon}</span>
              <div className="game-card-info">
                <h3 className="game-card-name">{game.name}</h3>
                <p className="game-card-desc">{game.description}</p>
                <span className="game-card-players">{game.players}</span>
              </div>
              {!game.available && (
                <span className="coming-soon-badge">Soon</span>
              )}
            </div>
          ))}
        </section>

        {/* Action tabs */}
        <section className="action-panel">
          <div className="tab-row">
            <button
              className={`tab ${activeTab === 'create' ? 'active' : ''}`}
              onClick={() => setActiveTab('create')}
            >
              Create Room
            </button>
            <button
              className={`tab ${activeTab === 'join' ? 'active' : ''}`}
              onClick={() => setActiveTab('join')}
            >
              Join Room
            </button>
            <button
              className={`tab ${activeTab === 'quick' ? 'active' : ''}`}
              onClick={() => setActiveTab('quick')}
            >
              Quick Play
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'create' && <CreateRoom />}
            {activeTab === 'join' && <JoinRoom />}
            {activeTab === 'quick' && <QuickPlay />}
          </div>
        </section>

        {/* Features */}
        <section className="features">
          <div className="feature">
            <span className="feature-icon">🔒</span>
            <h4>Anonymous</h4>
            <p>No login. No data. Your session is stored only on this device.</p>
          </div>
          <div className="feature">
            <span className="feature-icon">⚡</span>
            <h4>Real-Time</h4>
            <p>WebSocket-powered. See your opponent's moves instantly.</p>
          </div>
          <div className="feature">
            <span className="feature-icon">🛡️</span>
            <h4>Anti-Cheat</h4>
            <p>Server-authoritative. All moves validated server-side.</p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
