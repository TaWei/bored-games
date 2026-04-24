// ============================================================
// AVALON BOARD — The Resistance: Avalon social deduction UI
// ============================================================

import { useState, useCallback } from 'react';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { useSession } from '../../hooks/useSession';
import type {
  AvalonState,
  AvalonPhase,
  Player,
} from '@bored-games/shared';
import { Button } from '../Shared/Button';

// ── Phase display helpers ──────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  waiting: '⏳ Waiting for Players',
  role_assignment: '🎭 Assigning Roles',
  team_proposal: '🏰 Team Proposal',
  team_vote: '⚔️ Team Vote',
  quest: '🗡️ Quest',
  assassination: '🗡️ Assassination',
  game_end: '🏁 Game Over',
};

function getMissionLabel(mission: number): string {
  return `Mission ${mission}/5`;
}

// ── Sub-components ─────────────────────────────────────────

function PhaseHeader({ phase, mission, leaderName, currentPlayer }: {
  phase: string;
  mission: number;
  leaderName: string;
  currentPlayer: string;
}) {
  const phaseLabel = PHASE_LABELS[phase] ?? phase;
  const isMyTurn = currentPlayer === leaderName;
  return (
    <div className="avalon-phase-header">
      <div className="avalon-phase-badge">{phaseLabel}</div>
      <div className="avalon-mission-info">
        <span className="avalon-mission-label">{getMissionLabel(mission)}</span>
      </div>
      <div className="avalon-leader-info">
        👑 Leader: <strong>{leaderName}</strong>
        {isMyTurn && phase === 'team_proposal' && (
          <span className="avalon-leader-hint"> — Select your team</span>
        )}
      </div>
    </div>
  );
}

function PlayerCard({ player, isOnTeam, isCurrentPlayer, isLeader, sessionId, onSelectPlayer, selectedPlayers, selectable, voteStatus }: {
  player: Player;
  isOnTeam: boolean;
  isCurrentPlayer: boolean;
  isLeader: boolean;
  sessionId: string;
  onSelectPlayer: (id: string) => void;
  selectedPlayers: string[];
  selectable: boolean;
  voteStatus?: 'approve' | 'reject' | 'pending';
}) {
  const isSelected = selectedPlayers.includes(sessionId);

  let statusIcon = '';
  if (voteStatus === 'approve') statusIcon = '✅';
  else if (voteStatus === 'reject') statusIcon = '❌';
  else if (isOnTeam) statusIcon = '⚔️';
  if (isLeader) statusIcon = '👑';

  return (
    <div
      className={[
        'avalon-player-card',
        isOnTeam ? 'on-team' : '',
        isSelected ? 'selected' : '',
        selectable ? 'selectable' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => {
        if (selectable) onSelectPlayer(sessionId);
      }}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && selectable) {
          e.preventDefault();
          onSelectPlayer(sessionId);
        }
      }}
    >
      <span className="player-avatar">{player.displayName.charAt(0).toUpperCase()}</span>
      <span className="player-name">{player.displayName}</span>
      {isCurrentPlayer && <span className="you-badge">You</span>}
      {statusIcon && <span className="player-status">{statusIcon}</span>}
    </div>
  );
}

function VotePanel({ onVote, hasVoted }: { onVote: (approve: boolean) => void; hasVoted: boolean | null }) {
  if (hasVoted !== null) {
    return (
      <div className="avalon-vote-panel">
        <p className="vote-cast">Your vote: {hasVoted ? '✅ Approve' : '❌ Reject'}</p>
        <p className="vote-waiting">Waiting for others…</p>
      </div>
    );
  }
  return (
    <div className="avalon-vote-panel">
      <p className="vote-prompt">Approve or reject this team?</p>
      <div className="vote-buttons">
        <Button variant="primary" onClick={() => onVote(true)}>✅ Approve</Button>
        <Button variant="danger" onClick={() => onVote(false)}>❌ Reject</Button>
      </div>
    </div>
  );
}

function QuestPanel({ onSubmitCard, hasSubmitted }: { onSubmitCard: (card: 'pass' | 'fail') => void; hasSubmitted: boolean }) {
  if (hasSubmitted) {
    return (
      <div className="avalon-quest-panel">
        <p>Card submitted — waiting for other quest participants…</p>
      </div>
    );
  }
  return (
    <div className="avalon-quest-panel">
      <p className="quest-prompt">You are on the quest. Submit your loyalty card:</p>
      <div className="quest-card-buttons">
        <Button variant="primary" onClick={() => onSubmitCard('pass')}>
          ✋ Pass (Success)
        </Button>
        <Button variant="danger" onClick={() => onSubmitCard('fail')}>
          💀 Fail
        </Button>
      </div>
    </div>
  );
}

function MissionResultBanner({ succeeded, failCards }: { succeeded: boolean; failCards: number }) {
  return (
    <div className={`mission-result-banner ${succeeded ? 'success' : 'failure'}`}>
      {succeeded
        ? `✅ Mission PASSED — ${failCards} fail card(s)`
        : `❌ Mission FAILED — ${failCards} fail card(s)`}
    </div>
  );
}

function GameEndBanner({ goodWon }: { goodWon: boolean }) {
  return (
    <div className={`game-end-banner ${goodWon ? 'good-wins' : 'evil-wins'}`}>
      <p className="game-end-winner">
        {goodWon ? '🛡️ Good Wins!' : '😈 Evil Wins!'}
      </p>
    </div>
  );
}

function TeamProposalPanel({ selectedPlayers, requiredSize, onSubmitTeam, onClear }: {
  selectedPlayers: string[];
  requiredSize: number;
  onSubmitTeam: () => void;
  onClear: () => void;
}) {
  return (
    <div className="avalon-proposal-panel">
      <p className="proposal-hint">
        Select {requiredSize} players for the quest team
        {selectedPlayers.length > 0 && ` (${selectedPlayers.length}/${requiredSize})`}
      </p>
      <div className="proposal-actions">
        <Button
          variant="primary"
          disabled={selectedPlayers.length !== requiredSize}
          onClick={onSubmitTeam}
        >
          Submit Team
        </Button>
        {selectedPlayers.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main AvalonBoard ────────────────────────────────────────

export function AvalonBoard() {
  const { room } = useRoom();
  const { send } = useGame();
  const { state } = useGame();
  const { session } = useSession();

  // Local UI state
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [localVote, setLocalVote] = useState<boolean | null>(null);
  const [localQuestSubmit, setLocalQuestSubmit] = useState<boolean | null>(null);

  const mySessionId = session.id;
  const avalonState = state?.gameType === 'avalon' ? state as AvalonState : null;

  if (!avalonState) {
    return (
      <div className="avalon-board-wrapper">
        <p className="avalon-loading">Loading Avalon game…</p>
      </div>
    );
  }

  const players: Player[] = room?.players ?? [];
  const myPlayerIndex = avalonState.players.indexOf(mySessionId);
  const isMyTurn = myPlayerIndex === avalonState.leaderIndex;
  const currentPhase = avalonState.phase;
  const mission = avalonState.mission;
  const proposedTeam = avalonState.proposedTeam ?? [];
  const votesReceived = avalonState.votesReceived ?? [];
  const missionResults = avalonState.missionResults ?? [];
  const leaderIndex = avalonState.leaderIndex;
  const leaderName = players[leaderIndex]?.displayName ?? 'Unknown';

  // Determine required team size for current mission
  const MISSION_SIZES: Record<number, number[]> = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };
  const sizes = MISSION_SIZES[players.length] ?? MISSION_SIZES[5]!;
  const requiredTeamSize = sizes[mission - 1] ?? 2;

  // Current player's vote
  const myVoteValue = avalonState.votes[mySessionId];
  const hasVoted = myVoteValue !== null && myVoteValue !== undefined;

  // Quest participation
  const isOnQuestTeam = proposedTeam.includes(mySessionId);
  const hasSubmittedQuestCard = localQuestSubmit !== null;

  // Get vote status per player
  const getVoteStatus = (playerId: string): 'approve' | 'reject' | 'pending' => {
    const vote = avalonState.votes[playerId];
    if (vote === true) return 'approve';
    if (vote === false) return 'reject';
    return 'pending';
  };

  // Mission result
  const lastResult = missionResults[mission - 1];

  const handleSelectPlayer = useCallback((sessionId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(sessionId)) {
        return prev.filter((id) => id !== sessionId);
      }
      if (prev.length >= requiredTeamSize) return prev;
      return [...prev, sessionId];
    });
  }, [requiredTeamSize]);

  const handleSubmitTeam = useCallback(() => {
    if (selectedPlayers.length !== requiredTeamSize) return;
    (send as (msg: unknown) => void)({
      type: 'AVALON_PROPOSE_TEAM',
      payload: { team: selectedPlayers },
    });
    setSelectedPlayers([]);
  }, [selectedPlayers, requiredTeamSize, send]);

  const handleClearTeam = useCallback(() => {
    setSelectedPlayers([]);
  }, []);

  const handleVote = useCallback((approve: boolean) => {
    if (hasVoted) return;
    setLocalVote(approve);
    (send as (msg: unknown) => void)({
      type: 'AVALON_VOTE_TEAM',
      payload: { approve },
    });
  }, [hasVoted, send]);

  const handleSubmitQuestCard = useCallback((card: 'pass' | 'fail') => {
    if (hasSubmittedQuestCard) return;
    setLocalQuestSubmit(true);
    (send as (msg: unknown) => void)({
      type: 'AVALON_SUBMIT_QUEST_CARD',
      payload: { card },
    });
  }, [hasSubmittedQuestCard, send]);

  return (
    <div className="avalon-board-wrapper">
      {/* Phase header */}
      <PhaseHeader
        phase={currentPhase}
        mission={mission}
        leaderName={leaderName}
        currentPlayer={mySessionId}
      />

      {/* Mission results track */}
      <div className="avalon-mission-track">
        {[1, 2, 3, 4, 5].map((m) => {
          const result = missionResults[m - 1];
          return (
            <div
              key={m}
              className={`mission-dot ${result ? (result.succeeded ? 'passed' : 'failed') : 'pending'} ${m === mission ? 'current' : ''}`}
              title={`Mission ${m}${result ? (result.succeeded ? ' ✅' : ' ❌') : ''}`}
            >
              {m}
            </div>
          );
        })}
      </div>

      {/* Proposed team display */}
      {proposedTeam.length > 0 && (
        <div className="avalon-proposed-team">
          <p className="proposed-team-label">Proposed Team:</p>
          <div className="proposed-team-members">
            {proposedTeam.map((id) => {
              const player = players.find((p: Player) => p.sessionId === id);
              return (
                <span key={id} className="team-member-badge">
                  {player?.displayName ?? id}
                  {id === mySessionId ? ' (You)' : ''}
                </span>
              );
            })}
          </div>
          {votesReceived.length > 0 && (
            <p className="votes-received-label">
              {votesReceived.length}/{players.length} votes cast
            </p>
          )}
        </div>
      )}

      {/* Player grid */}
      <div className="avalon-player-grid">
        {players.map((player: Player) => {
          const isOnTeam = proposedTeam.includes(player.sessionId);
          const voteStatus = getVoteStatus(player.sessionId);
          return (
            <PlayerCard
              key={player.sessionId}
              player={player}
              isOnTeam={isOnTeam}
              isCurrentPlayer={player.sessionId === mySessionId}
              isLeader={players.indexOf(player) === leaderIndex}
              sessionId={player.sessionId}
              onSelectPlayer={handleSelectPlayer}
              selectedPlayers={selectedPlayers}
              selectable={currentPhase === 'team_proposal' && isMyTurn}
              voteStatus={voteStatus}
            />
          );
        })}
      </div>

      {/* Mission result banner */}
      {lastResult && (
        <MissionResultBanner
          succeeded={lastResult.succeeded}
          failCards={lastResult.failCards}
        />
      )}

      {/* Team proposal panel (leader only) */}
      {currentPhase === 'team_proposal' && isMyTurn && (
        <TeamProposalPanel
          selectedPlayers={selectedPlayers}
          requiredSize={requiredTeamSize}
          onSubmitTeam={handleSubmitTeam}
          onClear={handleClearTeam}
        />
      )}

      {/* Voting panel */}
      {currentPhase === 'team_vote' && (
        <VotePanel onVote={handleVote} hasVoted={hasVoted ? (myVoteValue ?? null) : null} />
      )}

      {/* Quest panel */}
      {currentPhase === 'quest' && isOnQuestTeam && (
        <QuestPanel
          onSubmitCard={handleSubmitQuestCard}
          hasSubmitted={hasSubmittedQuestCard}
        />
      )}

      {/* Game end banner */}
      {currentPhase === 'game_end' && (
        <GameEndBanner goodWon={avalonState.winner === 'good'} />
      )}
    </div>
  );
}
