// ============================================================
// CODENAMES BOARD — Word Spy Game UI
// ============================================================

import { useState, useCallback } from 'react';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { useSession } from '../../hooks/useSession';
import type {
	CodenamesState,
	CodenamesPhase,
	CodenamesCard,
	Player,
} from '@bored-games/shared';
import { Button } from '../Shared/Button';

// ── Phase display helpers ──────────────────────────────────

const PHASE_LABELS: Record<CodenamesPhase, string> = {
	waiting: '⏳ Waiting for Players',
	role_assignment: '🎭 Assigning Roles',
	clue: '🗣️ Clue Phase',
	guessing: '🎯 Guessing Phase',
	game_end: '🏁 Game Over',
};

function getPhaseLabel(phase: CodenamesPhase): string {
	return PHASE_LABELS[phase] ?? phase;
}

// ── Card component ─────────────────────────────────────────

function WordCard({
	card,
	onClick,
	disabled,
	myRole,
}: {
	card: CodenamesCard;
	onClick: () => void;
	disabled: boolean;
	myRole: 'spymaster' | 'operative' | null;
}) {
	// Determine background color based on card state
	let bgClass = 'codenames-card';
	if (card.revealed) {
		if (card.type === 'red') bgClass += ' card-red-revealed';
		else if (card.type === 'blue') bgClass += ' card-blue-revealed';
		else if (card.type === 'assassin') bgClass += ' card-assassin-revealed';
		else bgClass += ' card-bystander-revealed';
	} else {
		// Unrevealed cards are neutral until role reveals
		bgClass += ' card-unrevealed';
	}

	const handleClick = () => {
		if (!disabled || myRole === 'spymaster') {
			onClick();
		}
	};

	return (
		<button
			className={bgClass}
			onClick={handleClick}
			disabled={disabled && myRole !== 'spymaster'}
			type="button"
		>
			<span className="card-word">{card.word}</span>
			{card.revealed && (
				<span className="card-type-indicator">
					{card.type === 'red' && '🔴'}
					{card.type === 'blue' && '🔵'}
					{card.type === 'bystander' && '👤'}
					{card.type === 'assassin' && '💀'}
				</span>
			)}
		</button>
	);
}

// ── Clue panel (spymasters only) ───────────────────────────

function CluePanel({
	currentClue,
	guessesRemaining,
	onGiveClue,
	onPass,
	disabled,
}: {
	currentClue: { word: string; number: number } | null;
	guessesRemaining: number;
	onGiveClue: (word: string, number: number) => void;
	onPass: () => void;
	disabled: boolean;
}) {
	const [word, setWord] = useState('');
	const [number, setNumber] = useState(1);

	if (currentClue) {
		return (
			<div className="codenames-clue-panel">
				<div className="clue-active-banner">
					<span className="clue-label">Active Clue:</span>
					<span className="clue-word">"{currentClue.word}"</span>
					<span className="clue-number">{currentClue.number}</span>
					<span className="clue-remaining">
						{guessesRemaining} guess{guessesRemaining !== 1 ? 'es' : ''} remaining
					</span>
				</div>
			</div>
		);
	}

	return (
		<div className="codenames-clue-panel">
			<p className="clue-prompt">Give your team a clue:</p>
			<div className="clue-form">
				<input
					className="clue-input"
					type="text"
					placeholder="One word clue…"
					value={word}
					onChange={(e) => setWord(e.target.value.toUpperCase())}
					maxLength={30}
					disabled={disabled}
				/>
				<input
					className="clue-number-input"
					type="number"
					min={1}
					max={9}
					value={number}
					onChange={(e) => setNumber(Math.max(1, Math.min(9, parseInt(e.target.value) || 1)))}
					disabled={disabled}
				/>
				<Button
					variant="primary"
					disabled={disabled || word.trim().length === 0}
					onClick={() => {
						onGiveClue(word.trim(), number);
						setWord('');
						setNumber(1);
					}}
				>
					Give Clue
				</Button>
			</div>
		</div>
	);
}

// ── Guessing panel (operatives only) ───────────────────────

function GuessingPanel({
	guessesRemaining,
	onGuess,
	onPass,
	disabled,
	hasGuessedThisRound,
}: {
	guessesRemaining: number;
	onGuess: (cardIndex: number) => void;
	onPass: () => void;
	disabled: boolean;
	hasGuessedThisRound: boolean;
}) {
	return (
		<div className="codenames-guessing-panel">
			<div className="guessing-status">
				<span className="guesses-remaining">
					{guessesRemaining} guess{guessesRemaining !== 1 ? 'es' : ''} remaining
				</span>
				{hasGuessedThisRound && (
					<span className="guessed-this-round">You have guessed this round</span>
				)}
			</div>
			<Button
				variant="secondary"
				size="sm"
				disabled={disabled}
				onClick={onPass}
			>
				Pass
			</Button>
		</div>
	);
}

// ── Turn indicator ─────────────────────────────────────────

function TurnIndicator({
	currentTeam,
	myTeam,
	currentPhase,
	isMyTurn,
	activeClue,
}: {
	currentTeam: 'red' | 'blue';
	myTeam: 'red' | 'blue' | null;
	currentPhase: CodenamesPhase;
	isMyTurn: boolean;
	activeClue: { word: string; number: number } | null;
}) {
	const isMyTeamTurn = currentTeam === myTeam;
	const turnLabel = currentTeam === 'red' ? '🔴 Red Team' : '🔵 Blue Team';
	const myRoleLabel = isMyTeamTurn ? (isMyTurn ? ' (Your turn)' : " (Waiting for team's guess)") : ' (Opponent\'s turn)';

	return (
		<div className={`codenames-turn-indicator team-${currentTeam}`}>
			<span className="turn-label">{turnLabel}</span>
			{activeClue && (
				<span className="active-clue-display">
					Clue: "{activeClue.word}" {activeClue.number}
				</span>
			)}
			{myTeam && <span className="my-team-hint">{myRoleLabel}</span>}
		</div>
	);
}

// ── Score track ─────────────────────────────────────────────

function ScoreTrack({
	redCardsLeft,
	blueCardsLeft,
	currentTeam,
}: {
	redCardsLeft: number;
	blueCardsLeft: number;
	currentTeam: 'red' | 'blue';
}) {
	return (
		<div className="codenames-score-track">
			<div className="score-red">
				<span className="score-color">🔴</span>
				<span className="score-count">{redCardsLeft}</span>
			</div>
			<div className="score-track-divider">vs</div>
			<div className="score-blue">
				<span className="score-color">🔵</span>
				<span className="score-count">{blueCardsLeft}</span>
			</div>
		</div>
	);
}

// ── Game end banner ─────────────────────────────────────────

function GameEndBanner({ winner }: { winner: 'red' | 'blue' | 'draw' | null }) {
	if (!winner) return null;
	return (
		<div className={`codenames-game-end-banner ${winner === 'draw' ? 'draw' : `team-${winner}-wins`}`}>
			{winner === 'draw' ? (
				<span>🤝 It's a Draw!</span>
			) : (
				<span>
					{winner === 'red' ? '🔴' : '🔵'}{' '}
					{winner === 'red' ? 'Red' : 'Blue'} Team Wins!
				</span>
			)}
		</div>
	);
}

// ── Role notice (shown privately) ──────────────────────────

function RoleNotice({
	myTeam,
	myRole,
}: {
	myTeam: 'red' | 'blue' | null;
	myRole: 'spymaster' | 'operative' | null;
}) {
	if (!myTeam || !myRole) return null;
	return (
		<div className={`codenames-role-notice team-${myTeam}`}>
			You are a <strong>{myRole}</strong> on the{' '}
			<strong>{myTeam === 'red' ? '🔴 Red' : '🔵 Blue'}</strong> team
		</div>
	);
}

// ── Main CodenamesBoard ─────────────────────────────────────

export function CodenamesBoard() {
	const { room } = useRoom();
	const { send } = useGame();
	const { state } = useGame();
	const { session } = useSession();

	const mySessionId = session.id;
	const codenamesState = state?.gameType === 'codenames' ? (state as CodenamesState) : null;

	// Local UI state
	const [clueWord, setClueWord] = useState('');
	const [clueNumber, setClueNumber] = useState(1);
	const [hasGuessedThisRound, setHasGuessedThisRound] = useState(false);

	if (!codenamesState) {
		return (
			<div className="codenames-board-wrapper">
				<p className="codenames-loading">Loading Codenames game…</p>
			</div>
		);
	}

	const players: Player[] = room?.players ?? [];
	const phase = codenamesState.phase;
	const activeTeam = codenamesState.activeTeam;
	const currentClue = codenamesState.currentClue ?? null;
	const winner = codenamesState.winner ?? null;
	const cards = codenamesState.grid;

	// Determine my role and team from private player state
	const myPlayerState = codenamesState.playerStates.find((ps) => ps.sessionId === mySessionId);
	const myTeam = myPlayerState?.team ?? null;
	const myRole = myPlayerState?.role ?? null;

	// Spymaster IDs per team
	const redSpymasterIdx = codenamesState.playerStates.findIndex(
		(ps) => ps.team === 'red' && ps.role === 'spymaster'
	);
	const blueSpymasterIdx = codenamesState.playerStates.findIndex(
		(ps) => ps.team === 'blue' && ps.role === 'spymaster'
	);
	const redSpymasterId =
		redSpymasterIdx >= 0 ? codenamesState.playerStates[redSpymasterIdx]!.sessionId : null;
	const blueSpymasterId =
		blueSpymasterIdx >= 0 ? codenamesState.playerStates[blueSpymasterIdx]!.sessionId : null;

	// Turn check: my team's turn and my role matches the phase
	const isMyTurn =
		(myRole === 'spymaster' && myTeam === activeTeam && phase === 'clue') ||
		(myRole === 'operative' && myTeam === activeTeam && phase === 'guessing');

	const redCardsLeft = cards.filter((c) => c.type === 'red' && !c.revealed).length;
	const blueCardsLeft = cards.filter((c) => c.type === 'blue' && !c.revealed).length;

	// ── Event handlers ────────────────────────────────────────

	const handleGiveClue = useCallback(
		(word: string, number: number) => {
			(send as (msg: unknown) => void)({
				type: 'CODENAMES_GIVE_CLUE',
				payload: { word: word.toUpperCase(), number },
			});
			setClueWord('');
			setClueNumber(1);
		},
		[send]
	);

	const handleGuess = useCallback(
		(cardIndex: number) => {
			if (phase !== 'guessing' || myRole !== 'operative' || !isMyTurn) return;
			(send as (msg: unknown) => void)({
				type: 'CODENAMES_GUESS',
				payload: { cardIndex },
			});
			setHasGuessedThisRound(true);
		},
		[phase, myRole, isMyTurn, send]
	);

	const handlePass = useCallback(() => {
		(send as (msg: unknown) => void)({ type: 'CODENAMES_PASS' });
		setHasGuessedThisRound(false);
	}, [send]);

	// Reset hasGuessedThisRound when phase changes
	const prevPhaseRef = useState(phase)[1];

	// Can I interact with cards?
	const canGuess = phase === 'guessing' && myRole === 'operative' && isMyTurn;
	const canGiveClue = phase === 'clue' && myRole === 'spymaster' && isMyTurn;

	return (
		<div className="codenames-board-wrapper">
			{/* Phase header */}
			<div className="codenames-phase-header">
				<div className="codenames-phase-badge">{getPhaseLabel(phase)}</div>
				<RoleNotice myTeam={myTeam} myRole={myRole} />
			</div>

			{/* Score track */}
			<ScoreTrack
				redCardsLeft={redCardsLeft}
				blueCardsLeft={blueCardsLeft}
				currentTeam={activeTeam}
			/>

			{/* Turn / clue indicator */}
			<TurnIndicator
				currentTeam={activeTeam}
				myTeam={myTeam}
				currentPhase={phase}
				isMyTurn={isMyTurn}
				activeClue={currentClue}
			/>

			{/* Spymaster / operative panel */}
			{phase === 'clue' && myRole === 'spymaster' && (
				<CluePanel
					currentClue={currentClue}
					guessesRemaining={codenamesState.guessesRemaining}
					onGiveClue={handleGiveClue}
					onPass={handlePass}
					disabled={!canGiveClue}
				/>
			)}

			{phase === 'clue' && myRole === 'operative' && (
				<div className="codenames-waiting-panel">
					<p>Waiting for your spymaster to give a clue…</p>
				</div>
			)}

			{phase === 'guessing' && myRole === 'operative' && (
				<GuessingPanel
					guessesRemaining={codenamesState.guessesRemaining}
					onGuess={handleGuess}
					onPass={handlePass}
					disabled={!canGuess}
					hasGuessedThisRound={hasGuessedThisRound}
				/>
			)}

			{phase === 'guessing' && myRole === 'spymaster' && (
				<div className="codenames-waiting-panel">
					<p>Your operative is making guesses…</p>
				</div>
			)}

			{/* 5×5 Grid */}
			<div className="codenames-grid">
				{cards.map((card, index) => (
					<WordCard
						key={index}
						card={card}
						onClick={() => handleGuess(index)}
						disabled={!canGuess || card.revealed}
						myRole={myRole}
					/>
				))}
			</div>

			{/* Player list */}
			<div className="codenames-player-list">
				<div className="codenames-team red-team">
					<span className="team-header">🔴 Red Team</span>
					{codenamesState.playerStates
						.filter((ps) => ps.team === 'red')
						.map((ps) => {
							const player = players.find((p) => p.sessionId === ps.sessionId);
							return (
								<div key={ps.sessionId} className="codenames-player-item">
									<span className="codenames-player-name">
										{player?.displayName ?? ps.sessionId}
										{ps.sessionId === mySessionId ? ' (You)' : ''}
									</span>
									<span className={`codenames-player-role role-${ps.role}`}>
										{ps.role}
									</span>
								</div>
							);
						})}
				</div>
				<div className="codenames-team blue-team">
					<span className="team-header">🔵 Blue Team</span>
					{codenamesState.playerStates
						.filter((ps) => ps.team === 'blue')
						.map((ps) => {
							const player = players.find((p) => p.sessionId === ps.sessionId);
							return (
								<div key={ps.sessionId} className="codenames-player-item">
									<span className="codenames-player-name">
										{player?.displayName ?? ps.sessionId}
										{ps.sessionId === mySessionId ? ' (You)' : ''}
									</span>
									<span className={`codenames-player-role role-${ps.role}`}>
										{ps.role}
									</span>
								</div>
							);
						})}
				</div>
			</div>

			{/* Game end banner */}
			{winner && <GameEndBanner winner={winner} />}
		</div>
	);
}
