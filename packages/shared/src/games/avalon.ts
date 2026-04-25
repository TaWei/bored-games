// ============================================================
// AVALON: THE RESISTANCE GAME ENGINE
// ============================================================
//
// Game Overview:
//   - 5-10 players divided into Good (Loyal Servants of Arthur) and Evil (Minions of Mordred)
//   - Good wins by completing 3 of 5 missions
//   - Evil wins by failing 3 missions OR correctly assassinating Merlin after a Good victory
//
// Phases:
//   waiting → role_assignment → team_proposal → team_vote → quest → resolution → [repeat or assassination or game_end]
//
// Roles (basic recommended setup for 5-7 players):
//   Good: Merlin, Percival, Servant(s)
//   Evil: Minion(s), Mordred, Morgana
//
// Mission sizes by player count:
//   5: [2, 3, 2, 3, 3]     7: [2, 3, 3, 4, 4]
//   6: [2, 3, 4, 3, 4]     8: [3, 4, 4, 5, 5]
//   9: [3, 4, 4, 5, 5]    10: [3, 4, 4, 5, 5]
//
// Missions 4 in 7-10 player games require 2 Fail cards to fail.
//
// WebSocket Events:
//   Server → Client: AVALON_ROLE_ASSIGNED, AVALON_PHASE_CHANGE, AVALON_TEAM_PROPOSED,
//                  AVALON_TEAM_VOTE, AVALON_QUEST_RESULT, AVALON_MISSION_UPDATE,
//                  AVALON_ASSASSINATION_PHASE, AVALON_ASSASSINATION_VOTE,
//                  AVALON_ROLE_REVEAL, AVALON_ABILITY_USED, AVALON_LOVERS_REVEALED,
//                  AVALON_LANCELOT_FLIPPED
//   Client → Server: AVALON_PROPOSE_TEAM, AVALON_VOTE_TEAM, AVALON_SUBMIT_QUEST_CARD,
//                    AVALON_ASSASSINATE, AVALON_USE_CLERIC, AVALON_USE_REVEALER,
//                    AVALON_USE_TROUBLEMAKER, AVALON_USE_TRICKSTER, AVALON_USE_WITCH,
//                    AVALON_FLIP_LANCELOT
//
// Implementation note:
//   The server-side GameLoop handles all phase transitions. The engine's applyMove
//   validates moves against the current phase and advances state accordingly. Secret
//   role information is never serialized to the client — only the owning player
//   receives their role via AVALON_ROLE_ASSIGNED message at game start.
// ============================================================

import type { GameEngine } from './types';
import type {
	AvalonState,
	AvalonMove,
	AvalonPhase,
	AvalonRole,
	AvalonQuestResult,
	AvalonPlayerState,
} from '../types';
import type { MoveResult, GameEnd } from '../types';

// ----- Role assignment -----

/**
 * Build a role deck for a given player count.
 * Returns an array of roles to assign in order.
 */
function buildRoleDeck(playerCount: number): AvalonRole[] {
	// Role deck templates: [good roles, evil roles]
	// First N roles are Good, remaining are Evil
	const templates: Record<number, { good: AvalonRole[]; evil: AvalonRole[] }> = {
		5: { good: ['merlin', 'percival', 'servant'], evil: ['minion', 'mordred'] },
		6: { good: ['merlin', 'percival', 'servant'], evil: ['minion', 'minion', 'mordred'] },
		7: { good: ['merlin', 'percival', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana'] },
		8: { good: ['merlin', 'percival', 'servant', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana', 'oberon'] },
		9: { good: ['merlin', 'percival', 'servant', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana', 'oberon'] },
		10: { good: ['merlin', 'percival', 'servant', 'servant', 'servant'], evil: ['minion', 'minion', 'mordred', 'morgana', 'oberon'] },
	};

	const template = templates[playerCount] ?? templates[5]!;

	// Pad with servants to reach playerCount
	while (template.good.length + template.evil.length < playerCount) {
		template.good.push('servant');
	}

	return [...template.good, ...template.evil];
}

/**
 * Fisher-Yates shuffle
 */
function shuffle<T>(arr: T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

/**
 * Assign roles to players. Returns playerStates with roles set.
 */
function assignRoles(
	players: string[],
	playerNames: Record<string, string>
): AvalonPlayerState[] {
	const deck = shuffle(buildRoleDeck(players.length));
	const playerStates: AvalonPlayerState[] = players.map((sessionId, i) => ({
		sessionId,
		displayName: playerNames[sessionId] ?? 'Player',
		role: deck[i]!,
	}));

	// Tag evil teammates visibility
	const evilPlayers = playerStates.filter((p) =>
		(['minion', 'mordred', 'morgana', 'evil_lancelot', 'trickster', 'witch', 'brute'] as string[]).indexOf(p.role!) !== -1
	);
	evilPlayers.forEach((evil) => {
		evil.isEvil = true;
	});

	return playerStates;
}

/**
 * Get the list of Minion-of-Mordred identities that Merlin can see.
 * Excludes Mordred (hidden from Merlin).
 */
function merlinSees(playerStates: AvalonPlayerState[]): string[] {
	return playerStates
		.filter((p) =>
			(['minion', 'morgana', 'evil_lancelot', 'trickster', 'witch', 'brute', 'lunatic'] as string[]).indexOf(p.role!) !== -1
		)
		.map((p) => p.sessionId);
}

/**
 * Get the list of identities Percival sees (Merlin and Morgana, both disguised).
 * Returns the sessionIds of Merlin and Morgana (without revealing which is which).
 */
function percivalSees(playerStates: AvalonPlayerState[]): string[] {
	const merlin = playerStates.filter((p) => p.role === 'merlin')[0];
	const morgana = playerStates.filter((p) => p.role === 'morgana')[0];
	return [merlin?.sessionId, morgana?.sessionId].filter(Boolean) as string[];
}

// ----- Mission helpers -----

/** Required team size for a given mission number and player count */
function missionTeamSize(mission: number, playerCount: number): number {
	const sizes: Record<number, [number, number, number, number, number]> = {
		5: [2, 3, 2, 3, 3],
		6: [2, 3, 4, 3, 4],
		7: [2, 3, 3, 4, 4],
		8: [3, 4, 4, 5, 5],
		9: [3, 4, 4, 5, 5],
		10: [3, 4, 4, 5, 5],
	};
	return sizes[playerCount]?.[mission - 1] ?? 3;
}

/** Does mission number N require 2 fail cards in a playerCount game? */
function requiresDoubleFail(mission: number, playerCount: number): boolean {
	return [7, 8, 9, 10].indexOf(playerCount) !== -1 && mission === 4;
}

// ----- Phase helpers -----

function nextLeaderIndex(players: string[], current: number): number {
	return (current + 1) % players.length;
}

function countGoodWins(results: (AvalonQuestResult | null)[]): number {
	return results.filter((r) => r?.succeeded === true).length;
}

function countEvilWins(results: (AvalonQuestResult | null)[]): number {
	return results.filter((r) => r?.succeeded === false).length;
}

// ----- Engine -----

export const avalonEngine = {
	gameType: 'avalon' as const,
	minPlayers: 5,
	maxPlayers: 10,
	name: 'Avalon: The Resistance',
	description:
		'Social deduction for 5–10 players. Hidden roles, secret missions, and deducing who to trust. No account needed.',
	slug: 'avalon',
	icon: '⚔️',

	createInitialState(players: string[]): AvalonState {
		const playerCount = players.length;
		// Build placeholder playerStates — roles assigned after game starts
		// (roles are assigned in the game-loop, not here, so the engine starts in 'waiting')
		const playerStates: AvalonPlayerState[] = players.map((sessionId) => ({
			sessionId,
			displayName: 'Player',
		}));

		return {
			gameType: 'avalon',
			players,
			turn: players[0]!, // first leader
			moveCount: 0,
			phase: 'waiting',
			mission: 1,
			missionResults: [null, null, null, null, null],
			leaderIndex: 0,
			proposedTeam: [],
			votesReceived: [],
			votes: {},
			questCardsSubmitted: [],
			revealedQuestCards: [],
			abilitiesUsed: {
				clericUsed: false,
				revealerUsed: false,
				troublemakerUsed: false,
				tricksterUsed: false,
				witchUsed: false,
				lancelotReversed: false,
			},
			assassinationTarget: null,
			assassinationVotes: {},
			playerStates,
			consecutiveRejects: 0,
			winner: null,
			gameEndReason: undefined,
			roleRevealTarget: null,
			roleSwap: null,
			revealedCardPlayer: null,
			witchSwapTarget: null,
			loversPair: null,
			loversDeath: false,
			updatedAt: Date.now(),
		};
	},

	applyMove(state: AvalonState, move: AvalonMove, playerId: string): MoveResult<AvalonState> {
		const playerIndex = state.players.indexOf(playerId);
		if (playerIndex === -1) {
			return {
				ok: false,
				error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' },
			};
		}

		// Forward to the appropriate phase handler
		switch (state.phase) {
			case 'waiting':
				return { ok: false, error: { code: 'INVALID_MOVE', message: 'Game has not started yet.' } };
			case 'game_end':
				return { ok: false, error: { code: 'GAME_OVER', message: 'Game has already ended.' } };
		case 'team_proposal':
			return this.applyProposeTeam!(state, move, playerId);
		case 'team_vote':
			return this.applyVoteTeam!(state, move, playerId);
		case 'quest':
			return this.applyQuestCard!(state, move, playerId);
		case 'assassination':
			return this.applyAssassinate!(state, move, playerId);
			case 'role_assignment':
				// Only server-initiated transitions happen here; no client moves accepted
				return { ok: false, error: { code: 'INVALID_MOVE', message: 'Waiting for roles to be assigned.' } };
			default:
				return { ok: false, error: { code: 'INVALID_MOVE', message: `Unknown phase: ${state.phase}` } };
		}
	},

	// ----- Team Proposal -----

	applyProposeTeam(
		state: AvalonState,
		move: AvalonMove,
		_playerId: string
	): MoveResult<AvalonState> {
		if (move.type !== 'PROPOSE_TEAM') {
			return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected PROPOSE_TEAM.' } };
		}

		const leader = state.players[state.leaderIndex]!;
		// PlayerId here is checked by the server (GameLoop) to be the leader

		const requiredSize = missionTeamSize(state.mission, state.players.length);
		if (move.team.length !== requiredSize) {
			return {
				ok: false,
				error: {
					code: 'INVALID_TARGET',
					message: `Mission ${state.mission} requires exactly ${requiredSize} players.`,
				},
			};
		}

		// All team members must be in the game
		for (const pid of move.team) {
			if (state.players.indexOf(pid) === -1) {
				return {
					ok: false,
					error: { code: 'INVALID_TARGET', message: 'Team member is not in the game.' },
				};
			}
		}

		const newState: AvalonState = {
			...state,
			proposedTeam: move.team,
			phase: 'team_vote',
			votesReceived: [],
			votes: {},
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		};

		return { ok: true, state: newState };
	},

	// ----- Team Vote -----

	applyVoteTeam(
		state: AvalonState,
		move: AvalonMove,
		playerId: string
	): MoveResult<AvalonState> {
		if (move.type !== 'VOTE_TEAM') {
			return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected VOTE_TEAM.' } };
		}

		if (state.votesReceived.indexOf(playerId) !== -1) {
			return {
				ok: false,
				error: { code: 'ALREADY_VOTED', message: 'You have already voted.' },
			};
		}

		const newVotesReceived = [...state.votesReceived, playerId];
		const newVotes = { ...state.votes, [playerId]: move.approve };

		const newState: AvalonState = {
			...state,
			votesReceived: newVotesReceived,
			votes: newVotes,
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		};

		// Check majority after each vote (not just at the end)
		const approvals = Object.keys(newVotes).filter(k => newVotes[k as keyof typeof newVotes]).length;
		const rejections = Object.keys(newVotes).filter(k => !newVotes[k as keyof typeof newVotes]).length;
		const majority = Math.floor(state.players.length / 2) + 1;
		const approved = approvals >= majority;

		// If majority reached on this vote, determine outcome immediately
		if (approvals >= majority || rejections >= majority) {
			if (!approved) {
				const newConsecutiveRejects = state.consecutiveRejects + 1;
				const newLeaderIndex = nextLeaderIndex(state.players, state.leaderIndex);

				// 5 consecutive rejects → leader picks unilaterally
				if (newConsecutiveRejects >= 5) {
					const unilateralTeam = state.players.slice(0, missionTeamSize(state.mission, state.players.length));
					return {
						ok: true,
						state: {
							...newState,
							phase: 'quest',
							proposedTeam: unilateralTeam,
							questCardsSubmitted: [],
							revealedQuestCards: [],
							consecutiveRejects: 0,
							leaderIndex: newLeaderIndex,
							updatedAt: Date.now(),
						},
					};
				}

				return {
					ok: true,
					state: {
						...newState,
						phase: 'team_proposal',
						leaderIndex: newLeaderIndex,
						proposedTeam: [],
						consecutiveRejects: newConsecutiveRejects,
						updatedAt: Date.now(),
					},
				};
			}

			// Team approved — move to quest phase
			return {
				ok: true,
				state: {
					...newState,
					phase: 'quest',
					questCardsSubmitted: [],
					revealedQuestCards: [],
					consecutiveRejects: 0,
					updatedAt: Date.now(),
				},
			};
		}

		// No majority yet — stay in team_vote
		return { ok: true, state: newState };
	},

	// ----- Quest -----

	applyQuestCard(
		state: AvalonState,
		move: AvalonMove,
		playerId: string
	): MoveResult<AvalonState> {
		if (move.type !== 'SUBMIT_QUEST_CARD') {
			return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected SUBMIT_QUEST_CARD.' } };
		}

		if (state.proposedTeam.indexOf(playerId) === -1) {
			return {
				ok: false,
				error: { code: 'NOT_ON_PROPOSED_TEAM', message: 'You are not on the proposed team.' },
			};
		}

		if (state.questCardsSubmitted.indexOf(playerId) !== -1) {
			return {
				ok: false,
				error: { code: 'ALREADY_SUBMITTED_QUEST_CARD', message: 'You have already submitted a quest card.' },
			};
		}

		const newCardsSubmitted = [...state.questCardsSubmitted, playerId];
		const newPlayerStates = state.playerStates.map((p) => {
			if (p.sessionId === playerId) {
				return { ...p, questCards: [...(p.questCards ?? []), move.card] };
			}
			return p;
		});

		const newState: AvalonState = {
			...state,
			playerStates: newPlayerStates,
			questCardsSubmitted: newCardsSubmitted,
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		};

		// If not all team members have submitted yet, stay in quest
		if (newCardsSubmitted.length < state.proposedTeam.length) {
			return { ok: true, state: newState };
		}

		// All cards submitted — resolve the quest
		// Collect all fail cards from team members (evil players should typically fail)
		const teamCards: ('success' | 'fail')[] = [];
		for (const pid of state.proposedTeam) {
			const ps = state.playerStates.filter((p) => p.sessionId === pid)[0];
			const lastCard = ps?.questCards != null ? ps.questCards[ps.questCards.length - 1] : undefined;
			if (lastCard) teamCards.push(lastCard);
		}

		// Shuffle the cards so we can't tell who submitted which
		const shuffled = shuffle(teamCards);
		const failCount = shuffled.filter((c) => c === 'fail').length;
		const needsDoubleFail = requiresDoubleFail(state.mission, state.players.length);
		const questSucceeded = needsDoubleFail ? failCount < 2 : failCount === 0;

		const questResult: AvalonQuestResult = {
			succeeded: questSucceeded,
			failCards: failCount,
		};

		const newMissionResults = [...state.missionResults];
		newMissionResults[state.mission - 1] = questResult;

		// Check win conditions
		const goodWins = countGoodWins(newMissionResults);
		const evilWins = countEvilWins(newMissionResults);

		// Check Lovers death (Tristan/Isolde)
		let loversDeath = state.loversDeath;
		if (state.loversPair) {
			const [a, b] = state.loversPair;
			const diedThisMission = state.proposedTeam.indexOf(a) !== -1 || state.proposedTeam.indexOf(b) !== -1;
			if (diedThisMission) {
				loversDeath = true;
			}
		}

		const newStateResolved: AvalonState = {
			...newState,
			missionResults: newMissionResults,
			revealedQuestCards: shuffled,
			phase: 'team_proposal',
			proposedTeam: [],
			votesReceived: [],
			votes: {},
			questCardsSubmitted: [],
			loversDeath,
			updatedAt: Date.now(),
		};

		// Advance mission counter if this mission succeeded
		if (questSucceeded && state.mission < 5) {
			(newStateResolved as AvalonState).mission = state.mission + 1;
		}

		// Good wins: 3 missions succeeded
		if (goodWins >= 3) {
			return {
				ok: true,
				state: {
					...newStateResolved,
					phase: 'assassination',
					winner: null, // not yet decided
					updatedAt: Date.now(),
				},
			};
		}

		// Evil wins: 3 missions failed
		if (evilWins >= 3) {
			return {
				ok: true,
				state: {
					...newStateResolved,
					phase: 'game_end',
					winner: 'evil',
					gameEndReason: 'THREE_MISSIONS_FAILED',
					result: { winner: null, reason: 'THREE_MISSIONS_FAILED' },
					updatedAt: Date.now(),
				},
			};
		}

		// All 5 missions done without winner
		if (state.mission === 5 && !questSucceeded) {
			return {
				ok: true,
				state: {
					...newStateResolved,
					phase: 'game_end',
					winner: 'evil',
					gameEndReason: 'THREE_MISSIONS_FAILED',
					result: { winner: null, reason: 'THREE_MISSIONS_FAILED' },
					updatedAt: Date.now(),
				},
			};
		}

		if (state.mission === 5 && questSucceeded && goodWins < 3) {
			// This was the last mission — check if Good won
			return {
				ok: true,
				state: {
					...newStateResolved,
					phase: 'game_end',
					winner: 'good',
					gameEndReason: 'THREE_MISSIONS_WON',
					result: { winner: null, reason: 'THREE_MISSIONS_WON' },
					updatedAt: Date.now(),
				},
			};
		}

		return { ok: true, state: newStateResolved };
	},

	// ----- Assassination -----

	applyAssassinate(
		state: AvalonState,
		move: AvalonMove,
		playerId: string
	): MoveResult<AvalonState> {
		if (move.type !== 'ASSASSINATE') {
			return { ok: false, error: { code: 'INVALID_MOVE', message: 'Expected ASSASSINATE.' } };
		}

		// Only Evil players can vote on assassination
		const myState = state.playerStates.filter((p) => p.sessionId === playerId)[0];
		const isEvil = myState && (['minion', 'mordred', 'morgana', 'evil_lancelot', 'trickster', 'witch', 'brute'] as string[]).indexOf(myState.role ?? '') !== -1;

		if (!isEvil) {
			return {
				ok: false,
				error: { code: 'NOT_EVIL_PLAYER', message: 'Only Evil players can vote on assassination.' },
			};
		}

		const newVotes = { ...state.assassinationVotes, [playerId]: move.target };

		const newState: AvalonState = {
			...state,
			assassinationVotes: newVotes,
			moveCount: state.moveCount + 1,
			updatedAt: Date.now(),
		};

		// All Evil players must vote
		const evilPlayers = state.playerStates.filter((p) =>
			(['minion', 'mordred', 'morgana', 'evil_lancelot', 'trickster', 'witch', 'brute'] as string[]).indexOf(p.role ?? '') !== -1
		);

		if (Object.keys(newVotes).length < evilPlayers.length) {
			// Still waiting for votes
			return { ok: true, state: newState };
		}

		// Tally assassination votes — most voted target wins
		const voteCounts: Record<string, number> = {};
		for (const voteKey of Object.keys(newVotes)) {
			voteCounts[voteKey] = (voteCounts[voteKey] ?? 0) + 1;
		}

		let topTarget = '';
		let topCount = 0;
		for (const voteTarget of Object.keys(voteCounts)) {
			if (voteCounts[voteTarget] > topCount) {
				topCount = voteCounts[voteTarget]!;
				topTarget = voteTarget;
			}
		}

		// Check if target is Merlin
		const targetState = state.playerStates.filter((p) => p.sessionId === topTarget)[0];
		const isMerlin = targetState?.role === 'merlin';

		if (isMerlin) {
			return {
				ok: true,
				state: {
					...newState,
					phase: 'game_end',
					assassinationTarget: topTarget,
					winner: 'evil',
					gameEndReason: 'MERLIN_ASSASSINATED',
					result: { winner: null, reason: 'MERLIN_ASSASSINATED' },
					updatedAt: Date.now(),
				},
			};
		}

		// Failed to assassinate Merlin — Good wins
		return {
			ok: true,
			state: {
				...newState,
				phase: 'game_end',
				assassinationTarget: topTarget,
				winner: 'good',
				gameEndReason: 'THREE_MISSIONS_WON',
				result: { winner: null, reason: 'THREE_MISSIONS_WON' },
				updatedAt: Date.now(),
			},
		};
	},

	// ----- Win detection -----

	checkGameEnd(state: AvalonState): GameEnd | null {
		if (state.winner) {
			return state.result ?? { winner: null, reason: (state.gameEndReason as GameEnd['reason']) ?? 'THREE_MISSIONS_WON' };
		}
		return null;
	},

	// ----- Serialization -----

	serialize(state: AvalonState): string {
		// NOTE: This is called for Redis storage.
		// Secret per-player questCards are kept in Redis (server-side only).
		// When broadcasting to clients, the GameLoop strips questCards from playerStates.
		return JSON.stringify(state);
	},

	deserialize(data: string): AvalonState {
		return JSON.parse(data) as AvalonState;
	},
};
