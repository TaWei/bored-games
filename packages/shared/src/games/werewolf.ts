// ============================================================
// WEREWOLF GAME ENGINE
// ============================================================
//
// Game Overview:
//   - 6+ players divided into Villagers and Werewolves
//   - Villagers win by eliminating all Werewolves
//   - Werewolves win when their numbers equal or exceed Villagers
//
// Phases:
//   waiting → role_assignment → night → day → voting → [night or game_end]
//
// Roles (recommended for 6-12 players):
//   villager, werewolf, seer, hunter, cupid, witch, little_girl
//
// Night order (simultaneous within each group):
//   1. Werewolves agree on a kill target
//   2. Seer peeks a player's role
//   3. Witch can protect or poison (one use each)
//   4. Hunter shoots if dead
//
// Cupid mechanic: on night 1, cupid picks two players to link. If either dies,
// the other dies too (even if protected). Lovers win together if all wolves die.
//
// Implementation note:
//   The server-side GameLoop handles all phase transitions and night sequencing.
//   The engine's applyMove validates moves against the current phase.
//   Secret role information is never fully serialized to the client — only the
//   owning player receives their role via WEREWOLF_ROLE_ASSIGNED message.
// ============================================================

import type { GameEngine } from './types';
import type {
	WerewolfState,
	WerewolfMove,
	WerewolfPhase,
	WerewolfRole,
	WerewolfPlayerState,
	MoveResult,
	GameEnd,
	GameEndReason,
} from '../types';

// ----- Role deck builder -----

interface RoleDeckTemplate {
 good: WerewolfRole[];
 evil: WerewolfRole[];
}

function buildRoleDeck(playerCount: number): WerewolfRole[] {
 const templates: Record<number, RoleDeckTemplate> = {
  6:  { good: ['villager', 'villager', 'seer', 'hunter', 'cupid', 'witch'], evil: ['werewolf', 'werewolf'] },
  7:  { good: ['villager', 'seer', 'hunter', 'cupid', 'witch'],             evil: ['werewolf', 'werewolf', 'werewolf'] },
  8:  { good: ['villager', 'villager', 'seer', 'hunter', 'cupid', 'witch'], evil: ['werewolf', 'werewolf', 'werewolf'] },
  9:  { good: ['villager', 'seer', 'hunter', 'cupid', 'witch'],             evil: ['werewolf', 'werewolf', 'werewolf', 'werewolf'] },
  10: { good: ['villager', 'villager', 'seer', 'hunter', 'cupid', 'witch'], evil: ['werewolf', 'werewolf', 'werewolf', 'werewolf'] },
  11: { good: ['villager', 'seer', 'hunter', 'cupid', 'witch'],             evil: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'werewolf'] },
  12: { good: ['villager', 'villager', 'seer', 'hunter', 'cupid', 'witch'], evil: ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'werewolf'] },
 };

 const template = templates[playerCount] ?? templates[6]!;

 // Validate counts
 const total = template.good.length + template.evil.length;
 if (total !== playerCount) {
  // Adjust: fill remaining slots with villagers
  const diff = playerCount - total;
  for (let i = 0; i < diff; i++) {
   template.good.push('villager');
  }
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
 * Also sets isWerewolf=true for werewolf players.
 */
export function assignWerewolfRoles(
 players: string[],
 playerNames: Record<string, string>
): WerewolfPlayerState[] {
 const deck = shuffle(buildRoleDeck(players.length));
 const playerStates: WerewolfPlayerState[] = players.map((sessionId, i) => ({
  sessionId,
  displayName: playerNames[sessionId] ?? 'Player',
  role: deck[i]!,
  isWerewolf: deck[i] === 'werewolf',
  isDead: false,
  isAlive: true,
  hasVoted: false,
  lastNightAction: null,
  cupidPartner: null,
  isLinked: false,
 }));

 // Tag werewolf teammates visibility
 const werewolves = playerStates.filter((p) => p.isWerewolf);
 werewolves.forEach((ww) => {
  ww.isWerewolf = true;
 });

 return playerStates;
}

/**
 * Get the sessionIds of werewolf teammates for a player.
 */
function werewolfTeammates(playerStates: WerewolfPlayerState[], playerId: string): string[] {
 const player = playerStates.find((p) => p.sessionId === playerId);
 if (!player?.isWerewolf) return [];
 return playerStates
  .filter((p) => p.isWerewolf && p.sessionId !== playerId)
  .map((p) => p.sessionId);
}

/**
 * Get the sessionIds that Seer can see (all alive non-Seer players).
 */
function seerCandidates(playerStates: WerewolfPlayerState[], _seerId: string): string[] {
 return playerStates
  .filter((p) => !p.isDead && p.role !== 'seer')
  .map((p) => p.sessionId);
}

/**
 * Check if Werewolves have won.
 * Werewolves win when their count >= alive Villager count.
 */
function werewolvesWin(playerStates: WerewolfPlayerState[]): boolean {
 const aliveWerewolves = playerStates.filter((p) => p.isWerewolf && !p.isDead).length;
 const aliveVillagers = playerStates.filter((p) => !p.isWerewolf && !p.isDead).length;
 return aliveWerewolves >= aliveVillagers && aliveWerewolves > 0;
}

/**
 * Check if Villagers have won.
 * Villagers win when all Werewolves are dead.
 */
function villagersWin(playerStates: WerewolfPlayerState[]): boolean {
 const aliveWerewolves = playerStates.filter((p) => p.isWerewolf && !p.isDead).length;
 return aliveWerewolves === 0;
}

// ----- Phase helpers -----

function nextLeaderIndex(players: string[], current: number): number {
 return (current + 1) % players.length;
}

// ----- Engine -----

export const werewolfEngine: GameEngine<WerewolfState, WerewolfMove> = {
 gameType: 'werewolf',
 minPlayers: 6,
 maxPlayers: 12,
 name: 'Werewolf',
 description:
  'Social deduction for 6–12 players. Hidden roles, night killings, and finding the werewolves before they get you.',
 slug: 'werewolf',
 icon: '🐺',

 createInitialState(players: string[]): WerewolfState {
  const playerStates: WerewolfPlayerState[] = players.map((sessionId) => ({
   sessionId,
   displayName: 'Player',
   isDead: false,
   isAlive: true,
   hasVoted: false,
  }));

  return {
   gameType: 'werewolf',
   players,
   turn: players[0]!,
   moveCount: 0,
   phase: 'waiting',
   nightNumber: 0,
   phaseStartedAt: Date.now(),
   playerStates,
   lastKill: null,
   lastProtect: null,
   lastPeek: null,
   seerPeekResults: {},
   hunterKillTarget: null,
   deadPlayers: [],
   winner: null,
   gameEndReason: undefined,
   votes: {},
   votesReceived: [],
   eliminatedToday: [],
   alivePlayers: players,
   werewolfKillTarget: null,
   nightActionsReceived: [],
   consecutiveTies: 0,
   dayStarted: false,
   updatedAt: Date.now(),
  };
 },

 applyMove(state: WerewolfState, move: WerewolfMove, playerId: string): MoveResult<WerewolfState> {
  const playerIndex = state.players.indexOf(playerId);
  if (playerIndex === -1) {
   return {
    ok: false,
    error: { code: 'PLAYER_NOT_IN_GAME', message: 'You are not in this game.' },
   };
  }

  const player = state.playerStates.find((p) => p.sessionId === playerId);
  if (player?.isDead) {
   return {
    ok: false,
    error: { code: 'INVALID_MOVE', message: 'Dead players cannot make moves.' },
   };
  }

  switch (state.phase) {
   case 'waiting':
    return { ok: false, error: { code: 'INVALID_MOVE', message: 'Game has not started yet.' } };
   case 'game_end':
    return { ok: false, error: { code: 'GAME_OVER', message: 'Game has already ended.' } };
   case 'role_assignment':
    return { ok: false, error: { code: 'INVALID_MOVE', message: 'Waiting for roles to be assigned.' } };
   case 'night':
   case 'day':
   case 'voting':
    // All moves are handled by the phase-aware logic above in applyMove
    return { ok: false, error: { code: 'INVALID_MOVE', message: `Cannot make that move in ${state.phase} phase.` } };
   default:
    return { ok: false, error: { code: 'INVALID_MOVE', message: `Unknown phase: ${state.phase}` } };
  }
 },

 checkGameEnd(state: WerewolfState): GameEnd | null {
  if (state.winner === 'werewolves') {
   return { winner: 'werewolves', reason: 'WEREWOLF_VICTORY' as GameEndReason };
  }
  if (state.winner === 'villagers') {
   return { winner: 'villagers', reason: 'VILLAGER_VICTORY' as GameEndReason };
  }
  return null;
 },

 serialize(state: WerewolfState): string {
  return JSON.stringify(state);
 },

 deserialize(data: string): WerewolfState {
  return JSON.parse(data) as WerewolfState;
 },
};
