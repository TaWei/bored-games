// ============================================================
// ULTIMATE WEREWOLF GAME ENGINE
// ============================================================
//
// Game Overview:
//   - Players are secretly assigned roles: Villager, Werewolf, Seer, or Hunter
//   - Werewolves win if they equal or outnumber Villagers (not counting dead)
//   - Villagers win when all Werewolves are eliminated
//   - Phases:
//     waiting → role_assignment → night → day → voting → [night or game_end]
//     (After voting, if a Hunter dies they get a shoot action before next night)
//   - Night: Werewolves collectively kill one player; Seer may peek one role
//   - Day: Discussion → Vote to eliminate one player
//   - Hunter: Upon death, may eliminate one player
//
// Codenames uses a server-side only model — client receives derived state via WS events
// ============================================================

import type { GameEngine } from './types';
import type {
	WerewolfState,
	WerewolfMove,
	WerewolfPlayerState,
	WerewolfRole,
	WerewolfTeam,
	WerewolfPhase,
	MoveResult,
	GameEnd,
} from '../types';

// ----- Role assignment -----

/**
 * Default role distribution:
 * 4 players: 2 villager, 1 werewolf, 1 seer
 * 5 players: 3 villager, 1 werewolf, 1 seer
 * 6 players: 3 villager, 2 werewolf, 1 seer
 * 7 players: 4 villager, 2 werewolf, 1 seer (add 1 hunter)
 * 8 players: 4 villager, 3 werewolf, 1 seer
 * 9 players: 5 villager, 3 werewolf, 1 seer
 * 10 players: 5 villager, 4 werewolf, 1 seer
 */
function buildRoleDeck(playerCount: number): WerewolfRole[] {
	const templates: Record<number, WerewolfRole[]> = {
		4: ['villager', 'villager', 'werewolf', 'seer'],
		5: ['villager', 'villager', 'villager', 'werewolf', 'seer'],
		6: ['villager', 'villager', 'villager', 'werewolf', 'werewolf', 'seer'],
		7: ['villager', 'villager', 'villager', 'villager', 'werewolf', 'werewolf', 'seer', 'hunter'],
		8: ['villager', 'villager', 'villager', 'villager', 'werewolf', 'werewolf', 'werewolf', 'seer'],
		9: ['villager', 'villager', 'villager', 'villager', 'villager', 'werewolf', 'werewolf', 'werewolf', 'seer'],
		10: ['villager', 'villager', 'villager', 'villager', 'villager', 'werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer'],
	};
	return templates[playerCount] ?? templates[4]!;
}

// ----- Fisher-Yates shuffle -----

function shuffle<T>(arr: readonly T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

/**
 * Assign Werewolf roles to players. Returns playerStates with roles set.
 * Exported for use by the server-side game loop.
 */
export function assignWerewolfRoles(
	players: string[],
	playerNames: Record<string, string>
): WerewolfPlayerState[] {
	const deck = shuffle(buildRoleDeck(players.length));
	return players.map((sessionId, i) => ({
		sessionId,
		displayName: playerNames[sessionId] ?? 'Player',
		role: deck[i]!,
		isDead: false,
		hasVoted: false,
	}));
}

// ----- Role / team helpers -----

function werewolfRoleTeam(role: WerewolfRole): WerewolfTeam {
	return role === 'werewolf' ? 'werewolves' : 'villagers';
}

function countLivingByTeam(playerStates: WerewolfPlayerState[]): { villagers: number; werewolves: number } {
	let villagers = 0;
	let werewolves = 0;
	for (const p of playerStates) {
		if (p.isDead) continue;
		if (werewolfRoleTeam(p.role!) === 'werewolves') werewolves++;
		else villagers++;
	}
	return { villagers, werewolves };
}

function isAlive(playerStates: WerewolfPlayerState[], sessionId: string): boolean {
	return playerStates.some((p) => p.sessionId === sessionId && !p.isDead);
}

function getPlayer(playerStates: WerewolfPlayerState[], sessionId: string): WerewolfPlayerState | undefined {
	return playerStates.find((p) => p.sessionId === sessionId);
}

function getWerewolfTeammates(playerStates: WerewolfPlayerState[], sessionId: string): string[] {
	const role = getPlayer(playerStates, sessionId)?.role;
	if (role !== 'werewolf') return [];
	return playerStates
		.filter((p) => p.role === 'werewolf' && p.sessionId !== sessionId && !p.isDead)
		.map((p) => p.sessionId);
}

function livingPlayers(playerStates: WerewolfPlayerState[]): WerewolfPlayerState[] {
	return playerStates.filter((p) => !p.isDead);
}

// ----- Win condition check -----

function checkWin(playerStates: WerewolfPlayerState[]): { winner: WerewolfTeam; reason: string } | null {
	const { villagers, werewolves } = countLivingByTeam(playerStates);
	// Villagers win when all werewolves are dead
	if (werewolves === 0) {
		return { winner: 'villagers', reason: 'All Werewolves have been eliminated.' };
	}
	// Werewolves win when they equal or outnumber villagers
	if (werewolves >= villagers) {
		return { winner: 'werewolves', reason: 'Werewolves outnumber the Villagers.' };
	}
	return null;
}

// ----- Phase handlers (standalone, called by applyMove) -----

function applyNightKill(
	state: WerewolfState,
	move: WerewolfMove,
	playerId: string
): MoveResult<WerewolfState> {
	if (move.type !== 'WEREWOLF_KILL') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected WEREWOLF_KILL.' } };
	}

	const player = getPlayer(state.playerStates, playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}
	if (player.role !== 'werewolf') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Only Werewolves can make a kill.' } };
	}
	if (player.isDead) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'You are dead.' } };
	}

	const { target } = move;
	if (!isAlive(state.playerStates, target)) {
		return { ok: false, error: { code: 'INVALID_TARGET', message: 'Target is not alive.' } };
	}
	if (target === playerId) {
		return { ok: false, error: { code: 'INVALID_TARGET', message: 'You cannot kill yourself.' } };
	}

	const newState: WerewolfState = {
		...state,
		werewolfKillTarget: target,
		nightActionsReceived: [...state.nightActionsReceived, playerId],
		moveCount: state.moveCount + 1,
		updatedAt: Date.now(),
	};

	return { ok: true, state: newState };
}

function applySeerPeek(
	state: WerewolfState,
	move: WerewolfMove,
	playerId: string
): MoveResult<WerewolfState> {
	if (move.type !== 'SEER_PEEK') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected SEER_PEEK.' } };
	}

	const player = getPlayer(state.playerStates, playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}
	if (player.role !== 'seer') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Only the Seer can peek.' } };
	}
	if (player.isDead) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'You are dead.' } };
	}

	const { target } = move;
	if (!isAlive(state.playerStates, target)) {
		return { ok: false, error: { code: 'INVALID_TARGET', message: 'Target is not alive.' } };
	}
	if (target === playerId) {
		return { ok: false, error: { code: 'INVALID_TARGET', message: 'You cannot peek at yourself.' } };
	}

	const targetPlayer = getPlayer(state.playerStates, target);
	const seerPeekResults = { ...state.seerPeekResults, [target]: targetPlayer?.role! };

	const newState: WerewolfState = {
		...state,
		seerPeekResults,
		nightActionsReceived: [...state.nightActionsReceived, playerId],
		moveCount: state.moveCount + 1,
		updatedAt: Date.now(),
	};

	return { ok: true, state: newState };
}

function applyNightPass(
	state: WerewolfState,
	move: WerewolfMove,
	playerId: string
): MoveResult<WerewolfState> {
	if (move.type !== 'PASS') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected PASS.' } };
	}

	const player = getPlayer(state.playerStates, playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}
	if (player.isDead) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'You are dead.' } };
	}

	return {
		ok: true,
		state: {
			...state,
			nightActionsReceived: [...state.nightActionsReceived, playerId],
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		},
	};
}

function applyHunterShoot(
	state: WerewolfState,
	move: WerewolfMove,
	playerId: string
): MoveResult<WerewolfState> {
	if (move.type !== 'HUNTER_SHOOT') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected HUNTER_SHOOT.' } };
	}

	const player = getPlayer(state.playerStates, playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}
	if (player.role !== 'hunter') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Only the Hunter can shoot.' } };
	}
	if (!player.isDead) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'You must be dead to use this ability.' } };
	}

	const { target } = move;
	if (!isAlive(state.playerStates, target)) {
		return { ok: false, error: { code: 'INVALID_TARGET', message: 'Target is not alive.' } };
	}

	// Hunter kill is immediate and the game continues (hunterTarget tracks who they chose)
	return {
		ok: true,
		state: {
			...state,
			hunterKillTarget: target,
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		},
	};
}

function applyDayVote(
	state: WerewolfState,
	move: WerewolfMove,
	playerId: string
): MoveResult<WerewolfState> {
	if (move.type !== 'VOTE') {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected VOTE.' } };
	}

	const player = getPlayer(state.playerStates, playerId);
	if (!player) {
		return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
	}
	if (player.isDead) {
		return { ok: false, error: { code: 'INVALID_MOVE', message: 'You are dead.' } };
	}
	if (player.hasVoted) {
		return { ok: false, error: { code: 'ALREADY_VOTED', message: 'You have already voted.' } };
	}

	const { target } = move;
	if (!isAlive(state.playerStates, target)) {
		return { ok: false, error: { code: 'INVALID_TARGET', message: 'Target is not alive.' } };
	}

	const newVotes = { ...state.votes, [playerId]: target };
	const newVotesReceived = [...state.votesReceived, playerId];
	const newPlayerStates = state.playerStates.map((p) =>
		p.sessionId === playerId ? { ...p, hasVoted: true, voteTarget: target } : p
	);

	const newState: WerewolfState = {
		...state,
		playerStates: newPlayerStates,
		votes: newVotes,
		votesReceived: newVotesReceived,
		moveCount: state.moveCount + 1,
		updatedAt: Date.now(),
	};

	// If not all living players have voted yet, stay in voting
	if (newVotesReceived.length < livingPlayers(state.playerStates).length) {
		return { ok: true, state: newState };
	}

	// All votes in — tally results
	const voteTally: Record<string, number> = {};
	for (const targetId of Object.values(newVotes)) {
		voteTally[targetId] = (voteTally[targetId] ?? 0) + 1;
	}

	const living = livingPlayers(state.playerStates);
	const maxVotes = Math.max(...Object.values(voteTally));
	const topVoted = Object.keys(voteTally).filter((k) => voteTally[k] === maxVotes);

	// Tie — force revote
	if (topVoted.length > 1) {
		const newConsecutiveTies = state.consecutiveTies + 1;
		return {
			ok: true,
			state: {
				...newState,
				phase: 'voting',
				votes: {},
				votesReceived: [],
				consecutiveTies: newConsecutiveTies,
				phaseStartedAt: Date.now(),
				updatedAt: Date.now(),
			},
		};
	}

	// Single elimination
	const eliminated = topVoted[0]!;
	const eliminatedPlayer = getPlayer(state.playerStates, eliminated);
	const eliminatedRole = eliminatedPlayer?.role;

	const finalPlayerStates = state.playerStates.map((p) =>
		p.sessionId === eliminated ? { ...p, isDead: true } : p
	);

	// If eliminated is hunter → they get a shoot action before next night
	if (eliminatedRole === 'hunter') {
		const hunterState: WerewolfState = {
			...newState,
			playerStates: finalPlayerStates,
			deadPlayers: [...state.deadPlayers, eliminated],
			alivePlayers: finalPlayerStates.filter((p) => !p.isDead).map((p) => p.sessionId),
			// Don't clear votes yet — hunter shoot follows
			phase: 'voting', // stay in voting until hunter shoots
			consecutiveTies: 0,
			phaseStartedAt: Date.now(),
			updatedAt: Date.now(),
		};
		return { ok: true, state: hunterState };
	}

	// Check win condition
	const winResult = checkWin(finalPlayerStates);
	if (winResult) {
		return {
			ok: true,
			state: {
				...newState,
				playerStates: finalPlayerStates,
				deadPlayers: [...state.deadPlayers, eliminated],
				alivePlayers: finalPlayerStates.filter((p) => !p.isDead).map((p) => p.sessionId),
				phase: 'game_end',
				winner: winResult.winner,
				gameEndReason: winResult.reason,
				consecutiveTies: 0,
				phaseStartedAt: Date.now(),
				updatedAt: Date.now(),
			},
		};
	}

	// Transition to night
	return {
		ok: true,
		state: {
			...newState,
			playerStates: finalPlayerStates,
			deadPlayers: [...state.deadPlayers, eliminated],
			alivePlayers: finalPlayerStates.filter((p) => !p.isDead).map((p) => p.sessionId),
			phase: 'night',
			votes: {},
			votesReceived: [],
			nightActionsReceived: [],
			werewolfKillTarget: null,
			seerPeekResults: {},
			hunterKillTarget: null,
			consecutiveTies: 0,
			nightNumber: (state.nightNumber ?? 0) + 1,
			phaseStartedAt: Date.now(),
			updatedAt: Date.now(),
		},
	};
}

// ----- Engine -----

export const werewolfEngine: GameEngine<WerewolfState, WerewolfMove> = {
	gameType: 'werewolf',
	minPlayers: 4,
	maxPlayers: 10,
	name: 'Ultimate Werewolf',
	description:
		'Social deduction for 4-10 players. Werewolves lurk in the night while the Seer seeks the truth. Talk, vote, and survive!',
	slug: 'werewolf',
	icon: '🐺',

	createInitialState(players: string[]): WerewolfState {
		const playerStates: WerewolfPlayerState[] = players.map((sessionId) => ({
			sessionId,
			displayName: 'Player',
		}));

		return {
			gameType: 'werewolf',
			players,
			turn: players[0]!,
			moveCount: 0,
			phase: 'waiting',
			playerStates,
			deadPlayers: [],
			alivePlayers: players,
			werewolfKillTarget: null,
			seerPeekResults: {},
			hunterKillTarget: null,
			hunterTarget: null,
			nightActionsReceived: [],
			votes: {},
			votesReceived: [],
			dayStarted: false,
			consecutiveTies: 0,
			phaseStartedAt: Date.now(),
			winner: null,
			gameEndReason: undefined,
			nightNumber: 0,
			updatedAt: Date.now(),
		};
	},

	applyMove(state: WerewolfState, move: WerewolfMove, playerId: string): MoveResult<WerewolfState> {
		// Player must be in game
		if (!state.players.includes(playerId)) {
			return { ok: false, error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' } };
		}

		// Game over?
		if (state.phase === 'game_end' || state.winner) {
			return { ok: false, error: { code: 'GAME_OVER', message: 'Game has already ended.' } };
		}

		// Waiting / role_assignment — no moves accepted
		if (state.phase === 'waiting' || state.phase === 'role_assignment') {
			return { ok: false, error: { code: 'INVALID_MOVE', message: 'Game has not started yet.' } };
		}

		switch (state.phase) {
			case 'night':
				if (move.type === 'WEREWOLF_KILL') return applyNightKill(state, move, playerId);
				if (move.type === 'SEER_PEEK') return applySeerPeek(state, move, playerId);
				if (move.type === 'PASS') return applyNightPass(state, move, playerId);
				return { ok: false, error: { code: 'INVALID_MOVE', message: 'Invalid night action.' } };

			case 'day':
				// Day phase is purely informational (discussion) — voting is a separate phase
				return { ok: false, error: { code: 'INVALID_MOVE', message: 'Use VOTE to eliminate a player.' } };

			case 'voting':
				if (move.type === 'VOTE') return applyDayVote(state, move, playerId);
				return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected VOTE.' } };

			default:
				return { ok: false, error: { code: 'INVALID_MOVE', message: `Unknown phase: ${state.phase}` } };
		}
	},

	checkGameEnd(state: WerewolfState): GameEnd | null {
		if (!state.winner) return null;
		return {
			winner: state.winner,
			reason: (state.gameEndReason as GameEnd['reason']) ?? 'timeout',
		};
	},

	serialize(state: WerewolfState): string {
		return JSON.stringify(state);
	},

	deserialize(data: string): WerewolfState {
		return JSON.parse(data) as WerewolfState;
	},

	isValidMove(state: WerewolfState, move: WerewolfMove, playerId: string): boolean {
		return this.applyMove(state, move, playerId).ok;
	},

	getValidMoves(state: WerewolfState, playerId: string): WerewolfMove[] {
		if (state.phase === 'game_end' || state.winner) return [];
		if (state.phase === 'waiting' || state.phase === 'role_assignment') return [];
		if (state.phase === 'day') return [];

		const player = getPlayer(state.playerStates, playerId);
		if (!player || player.isDead) return [];

		const alive = state.playerStates.filter((p) => !p.isDead && p.sessionId !== playerId);

		if (state.phase === 'night') {
			if (player.role === 'werewolf') {
				// Werewolf kill targets — any alive player except self
				return alive.map((p) => ({ type: 'WEREWOLF_KILL' as const, target: p.sessionId }));
			}
			if (player.role === 'seer') {
				// Seer peek targets — any alive player except self
				const peeks: WerewolfMove[] = alive.map((p) => ({ type: 'SEER_PEEK', target: p.sessionId }));
				peeks.push({ type: 'PASS' });
				return peeks;
			}
			// Other roles can pass during night
			return [{ type: 'PASS' as const }];
		}

		if (state.phase === 'voting') {
			if (player.hasVoted) return [];
			return alive.map((p) => ({ type: 'VOTE' as const, target: p.sessionId }));
		}

		return [];
	},
};
