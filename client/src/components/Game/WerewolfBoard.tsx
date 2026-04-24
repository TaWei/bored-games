// ============================================================
// WEREWOLF BOARD — Ultimate Werewolf social deduction UI
// ============================================================

import { useState, useCallback } from 'react';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { useSession } from '../../hooks/useSession';
import type {
  WerewolfState,
  WerewolfPhase,
  WerewolfRole,
  Player,
} from '@bored-games/shared';
import { Button } from '../Shared/Button';

// ── Phase display helpers ──────────────────────────────────

const PHASE_LABELS: Record<WerewolfPhase, string> = {
  waiting: '⏳ Waiting for Players',
  role_assignment: '🎭 Assigning Roles',
  night: '🌙 Night Phase',
  day: '☀️ Day Phase',
  voting: '🗳️ Voting Phase',
  game_end: '🏁 Game Over',
};

function getPhaseLabel(phase: WerewolfPhase): string {
  return PHASE_LABELS[phase] ?? phase;
}

// ── Sub-components ─────────────────────────────────────────

function PhaseHeader({ phase, nightNumber, deadCount }: {
  phase: WerewolfPhase;
  nightNumber: number;
  deadCount: number;
}) {
  const phaseLabel = getPhaseLabel(phase);
  return (
    <div className="werewolf-phase-header">
      <div className="werewolf-phase-badge">{phaseLabel}</div>
      {phase === 'night' && nightNumber > 0 && (
        <span className="werewolf-night-number">Night {nightNumber}</span>
      )}
      {deadCount > 0 && (
        <span className="werewolf-dead-count">💀 {deadCount} eliminated</span>
      )}
    </div>
  );
}

function PlayerCard({ player, isDead, isWerewolf, isSeer, selectable, onSelect, isSelected }: {
  player: Player;
  isDead: boolean;
  isWerewolf: boolean;
  isSeer: boolean;
  selectable: boolean;
  onSelect: (id: string) => void;
  isSelected: boolean;
}) {
  return (
    <div
      className={[
        'werewolf-player-card',
        isDead ? 'dead' : '',
        isSelected ? 'selected' : '',
        selectable ? 'selectable' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => {
        if (selectable && !isDead) onSelect(player.sessionId);
      }}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && selectable && !isDead) {
          e.preventDefault();
          onSelect(player.sessionId);
        }
      }}
    >
      <span className="player-avatar">{player.displayName.charAt(0).toUpperCase()}</span>
      <span className="player-name">{player.displayName}</span>
      {isDead && <span className="dead-badge">💀</span>}
      {isWerewolf && <span className="role-badge werewolf">🐺</span>}
      {isSeer && <span className="role-badge seer">🔮</span>}
    </div>
  );
}

function RoleNotice({ role }: { role: WerewolfRole }) {
  const roleEmoji: Record<WerewolfRole, string> = {
    werewolf: '🐺',
    seer: '🔮',
    hunter: '🏹',
    villager: '🏘️',
    default: '❓',
  };
  const roleDesc: Record<WerewolfRole, string> = {
    werewolf: 'Werewolf — Work with your pack to eliminate the villagers. You see other werewolves at night.',
    seer: 'Seer — Peer into the shadows to learn a player role each night.',
    hunter: 'Hunter — When you die, you may take one player with you.',
    villager: 'Villager — Work with the village to find and eliminate the werewolves.',
    default: 'Unknown Role',
  };
  return (
    <div className="werewolf-role-notice">
      <span className="role-icon">{roleEmoji[role]}</span>
      <span className="role-name">{role}</span>
      <p className="role-description">{roleDesc[role]}</p>
    </div>
  );
}

function NightActionPanel({ myRole, onWerewolfKill, onSeerPeek, onPass, killTarget, hasActed }: {
  myRole?: WerewolfRole;
  onWerewolfKill: (target: string) => void;
  onSeerPeek: (target: string) => void;
  onPass: () => void;
  killTarget: string | null;
  hasActed: boolean;
}) {
  if (hasActed) {
    return (
      <div className="werewolf-night-panel">
        <p className="night-acted">Your action has been submitted — waiting for others…</p>
      </div>
    );
  }

  if (myRole === 'werewolf') {
    return (
      <div className="werewolf-night-panel werewolf-role">
        <p className="night-prompt">🐺 You are a Werewolf! Choose who to eliminate:</p>
        {killTarget && <p className="kill-target-selected">Selected target</p>}
        <Button variant="danger" onClick={onPass}>
          Pass (Skip Kill)
        </Button>
      </div>
    );
  }

  if (myRole === 'seer') {
    return (
      <div className="werewolf-night-panel seer-role">
        <p className="night-prompt">🔮 You are the Seer! Choose a player to peek:</p>
        <Button variant="secondary" onClick={onPass}>
          Pass (Skip Peek)
        </Button>
      </div>
    );
  }

  return (
    <div className="werewolf-night-panel">
      <p className="night-waiting">🌙 The night is silent… Werewolves are lurking.</p>
      <p className="night-hint">Wait for werewolves and seer to act.</p>
    </div>
  );
}

function SeerResultPanel({ seerPeekResults }: { seerPeekResults: Record<string, WerewolfRole> }) {
  const entries = Object.entries(seerPeekResults);
  if (entries.length === 0) return null;

  return (
    <div className="werewolf-seer-results">
      <h4 className="seer-results-title">🔮 Your Seer Peeks:</h4>
      {entries.map(([targetId, role]) => (
        <div key={targetId} className="seer-result-item">
          Player {targetId.slice(0, 6)}… → {role}
        </div>
      ))}
    </div>
  );
}

function VotingPanel({ onVote, hasVoted, voteTarget }: {
  onVote: (target: string) => void;
  hasVoted: boolean;
  voteTarget: string | undefined;
}) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  if (hasVoted) {
    return (
      <div className="werewolf-vote-panel">
        <p className="vote-cast">Your vote: {voteTarget ? `Eliminate ${voteTarget.slice(0, 6)}…` : 'Skipped'}</p>
        <p className="vote-waiting">Waiting for others to vote…</p>
      </div>
    );
  }

  return (
    <div className="werewolf-vote-panel">
      <p className="vote-prompt">Vote to eliminate a player:</p>
      <div className="vote-buttons">
        <Button
          variant="danger"
          disabled={!selectedTarget}
          onClick={() => {
            if (selectedTarget) onVote(selectedTarget);
          }}
        >
          Eliminate Selected
        </Button>
        <Button variant="ghost" onClick={() => onVote('')}>
          Skip Vote
        </Button>
      </div>
    </div>
  );
}

function HunterShootPanel({ onHunterShoot }: { onHunterShoot: (target: string) => void }) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  return (
    <div className="werewolf-hunter-panel">
      <p className="hunter-prompt">🏹 You are the Hunter! Take someone with you — choose who to eliminate:</p>
      <div className="hunter-buttons">
        <Button
          variant="danger"
          disabled={!selectedTarget}
          onClick={() => {
            if (selectedTarget) onHunterShoot(selectedTarget);
          }}
        >
          Shoot Selected
        </Button>
        <Button variant="ghost" onClick={() => onHunterShoot('')}>
          Pass
        </Button>
      </div>
    </div>
  );
}

function VoteResults({ votes, players }: {
  votes: Record<string, string>;
  players: Player[];
}) {
  const voteEntries = Object.entries(votes);
  if (voteEntries.length === 0) return null;

  // Tally votes
  const tally: Record<string, number> = {};
  for (const [, target] of voteEntries) {
    tally[target] = (tally[target] ?? 0) + 1;
  }

  return (
    <div className="werewolf-vote-results">
      <h4 className="vote-results-title">🗳️ Vote Tally:</h4>
      {Object.entries(tally)
        .sort(([, a], [, b]) => b - a)
        .map(([targetId, count]) => {
          const player = players.find((p) => p.sessionId === targetId);
          return (
            <div key={targetId} className="vote-tally-item">
              {player?.displayName ?? targetId}: {count} vote{count !== 1 ? 's' : ''}
            </div>
          );
        })}
      <p className="votes-cast">{voteEntries.length} / {players.length} votes cast</p>
    </div>
  );
}

function GameEndBanner({ winner }: { winner: 'villagers' | 'werewolves' | null }) {
  if (!winner) return null;
  return (
    <div className={`werewolf-game-end-banner ${winner === 'villagers' ? 'villagers-win' : 'werewolves-win'}`}>
      {winner === 'villagers' ? (
        <span>🏘️ Villagers Win! All Werewolves have been eliminated!</span>
      ) : (
        <span>🐺 Werewolves Win! They have taken over the village!</span>
      )}
    </div>
  );
}

// ── Main WerewolfBoard ──────────────────────────────────────

export function WerewolfBoard() {
  const { room } = useRoom();
  const { send } = useGame();
  const { state } = useGame();
  const { session } = useSession();

  const mySessionId = session.id;
  const werewolfState = state?.gameType === 'werewolf' ? (state as WerewolfState) : null;

  if (!werewolfState) {
    return (
      <div className="werewolf-board-wrapper">
        <p className="werewolf-loading">Loading Werewolf game…</p>
      </div>
    );
  }

  const players: Player[] = room?.players ?? [];
  const currentPhase = werewolfState.phase;
  const nightNumber = werewolfState.nightNumber ?? 0;
  const deadPlayers = werewolfState.deadPlayers ?? [];
  const alivePlayers = werewolfState.alivePlayers ?? [];
  const werewolfKillTarget = werewolfState.werewolfKillTarget;
  const seerPeekResults = werewolfState.seerPeekResults ?? {};
  const votes = werewolfState.votes ?? {};
  const votesReceived = werewolfState.votesReceived ?? [];
  const hunterKillTarget = werewolfState.hunterKillTarget;

  // Find my role from playerStates
  const myPlayerState = werewolfState.playerStates.find((ps) => ps.sessionId === mySessionId);
  const myRole = myPlayerState?.role;
  const amIDead = deadPlayers.includes(mySessionId);

  // Check if I have acted this night
  const hasActedNight = werewolfState.nightActionsReceived.includes(mySessionId);

  // Werewolf teammates (only visible to werewolves)
  const werewolfTeammates = myRole === 'werewolf'
    ? werewolfState.playerStates
        .filter((ps) => ps.role === 'werewolf' && ps.sessionId !== mySessionId && !ps.isDead)
        .map((ps) => ps.sessionId)
    : [];

  // Voting state
  const myVote = votes[mySessionId];
  const hasVoted = votesReceived.includes(mySessionId);

  // Seer results visible only to seer
  const visibleSeerResults: Record<string, WerewolfRole> = {};
  if (myRole === 'seer') {
    for (const [targetId, role] of Object.entries(seerPeekResults)) {
      visibleSeerResults[targetId] = role;
    }
  }

  // Is it my turn to act in night?
  const canActAtNight = !amIDead && (myRole === 'werewolf' || myRole === 'seer') && !hasActedNight;

  // ── Event handlers ────────────────────────────────────────

  const handleWerewolfKill = useCallback((target: string) => {
    (send as (msg: unknown) => void)({
      type: 'WEREWOLF_KILL',
      payload: { target },
    });
  }, [send]);

  const handleSeerPeek = useCallback((target: string) => {
    (send as (msg: unknown) => void)({
      type: 'SEER_PEEK',
      payload: { target },
    });
  }, [send]);

  const handleNightPass = useCallback(() => {
    (send as (msg: unknown) => void)({ type: 'PASS' });
  }, [send]);

  const handleVote = useCallback((target: string) => {
    if (votesReceived.includes(mySessionId)) return;
    (send as (msg: unknown) => void)({
      type: 'VOTE',
      payload: { target },
    });
  }, [votesReceived, mySessionId, send]);

  const handleHunterShoot = useCallback((target: string) => {
    (send as (msg: unknown) => void)({
      type: 'HUNTER_SHOOT',
      payload: { target },
    });
  }, [send]);

  return (
    <div className="werewolf-board-wrapper">
      {/* Phase header */}
      <PhaseHeader
        phase={currentPhase}
        nightNumber={nightNumber}
        deadCount={deadPlayers.length}
      />

      {/* Role notice (private) */}
      {myRole && currentPhase !== 'waiting' && currentPhase !== 'role_assignment' && (
        <RoleNotice role={myRole} />
      )}

      {/* Werewolf teammates indicator */}
      {myRole === 'werewolf' && werewolfTeammates.length > 0 && (
        <div className="werewolf-teammates">
          <span className="teammates-label">🐺 Your pack:</span>
          {werewolfTeammates.map((id) => {
            const teammate = players.find((p) => p.sessionId === id);
            return (
              <span key={id} className="teammate-badge">
                {teammate?.displayName ?? id}
              </span>
            );
          })}
        </div>
      )}

      {/* Dead players list */}
      {deadPlayers.length > 0 && (
        <div className="werewolf-dead-list">
          <span className="dead-label">💀 Eliminated:</span>
          {deadPlayers.map((id) => {
            const player = players.find((p) => p.sessionId === id);
            return (
              <span key={id} className="dead-player-badge">
                {player?.displayName ?? id}
              </span>
            );
          })}
        </div>
      )}

      {/* Night action panel */}
      {currentPhase === 'night' && (
        <NightActionPanel
          myRole={myRole}
          onWerewolfKill={handleWerewolfKill}
          onSeerPeek={handleSeerPeek}
          onPass={handleNightPass}
          killTarget={werewolfKillTarget}
          hasActed={hasActedNight}
        />
      )}

      {/* Seer results */}
      {myRole === 'seer' && Object.keys(visibleSeerResults).length > 0 && (
        <SeerResultPanel seerPeekResults={visibleSeerResults} />
      )}

      {/* Vote results display */}
      {currentPhase === 'voting' && votesReceived.length > 0 && (
        <VoteResults votes={votes} players={players} />
      )}

      {/* Voting panel */}
      {currentPhase === 'voting' && !amIDead && (
        <VotingPanel
          onVote={handleVote}
          hasVoted={hasVoted}
          voteTarget={myVote}
        />
      )}

      {/* Hunter shoot panel */}
      {hunterKillTarget === null && myRole === 'hunter' && amIDead && (
        <HunterShootPanel onHunterShoot={handleHunterShoot} />
      )}

      {/* Player grid */}
      <div className="werewolf-player-grid">
        {players.map((player: Player) => {
          const playerState = werewolfState.playerStates.find((ps) => ps.sessionId === player.sessionId);
          const isDead = deadPlayers.includes(player.sessionId);
          const isWerewolf = playerState?.role === 'werewolf';
          const isSeer = playerState?.role === 'seer';

          const selectable =
            (currentPhase === 'night' && canActAtNight) ||
            (currentPhase === 'voting' && !amIDead && !hasVoted);

          return (
            <PlayerCard
              key={player.sessionId}
              player={player}
              isDead={isDead}
              isWerewolf={isWerewolf}
              isSeer={isSeer}
              selectable={selectable}
              onSelect={(id) => {
                if (currentPhase === 'night') {
                  if (myRole === 'werewolf') handleWerewolfKill(id);
                  else if (myRole === 'seer') handleSeerPeek(id);
                } else if (currentPhase === 'voting') {
                  handleVote(id);
                }
              }}
              isSelected={
                currentPhase === 'night'
                  ? werewolfKillTarget === player.sessionId
                  : myVote === player.sessionId
              }
            />
          );
        })}
      </div>

      {/* Game end banner */}
      {currentPhase === 'game_end' && (
        <GameEndBanner winner={werewolfState.winner} />
      )}

      {/* Werewolf kill target announcement */}
      {currentPhase === 'day' && werewolfKillTarget && (
        <div className="werewolf-kill-reveal">
          <p>🌙 Last night, a player was eliminated…</p>
        </div>
      )}
    </div>
  );
}