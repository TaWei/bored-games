// ============================================================
// CORE TYPES — Shared across server and client
// ============================================================

// ---------- Session & Identity ----------

export type GameType = 'tic-tac-toe' | 'chess' | 'connect-four' | 'avalon' | 'codenames' | 'werewolf';

export interface SessionMetadata {
  sessionId: string;
  displayName: string;
  displayNameUpdatedAt?: number;
}

// ---------- Room ----------

export type RoomStatus = 'waiting' | 'in_progress' | 'completed' | 'abandoned';

export interface Player {
  sessionId: string;
  displayName: string;
  /** Player symbol/number in the game (e.g., 'X', 'O', 'white', 'black') */
  symbol: string;
  joinedAt: number;
}

export interface Spectator {
  sessionId: string;
  displayName: string;
  joinedAt: number;
}

export interface Room {
  code: string;
  gameType: GameType;
  hostSessionId: string;
  status: RoomStatus;
  players: Player[];
  spectators: Spectator[];
  createdAt: number;
  /** Max players for this game type */
  maxPlayers: number;
  /** Session IDs of players who have requested rematch */
  rematchRequests: string[];
}

// ---------- Game State ----------

export interface BaseGameState {
  gameType: GameType;
  players: string[]; // sessionIds in join order
  turn: string; // current player sessionId
  moveCount: number;
  result?: GameEnd;
  /** Unix timestamp when the game state was last updated */
  updatedAt: number;
}

export interface TicTacToeState extends BaseGameState {
  gameType: 'tic-tac-toe';
  /** 3x3 grid. Each cell: '' | 'X' | 'O' */
  board: string[][];
  winningLine?: [number, number][];
}

export interface ChessState extends BaseGameState {
  gameType: 'chess';
  /** FEN notation string */
  fen: string;
  // TODO: add clock, en passant square, castling rights
}

// ---------- Avalon: The Resistance ----------

/**
 * All possible Avalon roles.
 * Good roles: merlin, percival, guinevere, servant, good_lancelot, tristan, isolde, cleric, revealer, troublemaker, merlin_pure
 * Evil roles: minion, mordred, morgana, oberon, evil_lancelot, trickster, witch, lunatic, brute
 */
export type AvalonRole =
	| 'merlin'
	| 'percival'
	| 'guinevere'
	| 'servant'
	| 'good_lancelot'
	| 'tristan'
	| 'isolde'
	| 'cleric'
	| 'revealer'
	| 'troublemaker'
	| 'merlin_pure'
	| 'minion'
	| 'mordred'
	| 'morgana'
	| 'oberon'
	| 'evil_lancelot'
	| 'trickster'
	| 'witch'
	| 'lunatic'
	| 'brute';

export const AVALON_GOOD_ROLES: AvalonRole[] = [
	'merlin', 'percival', 'guinevere', 'servant', 'good_lancelot',
	'tristan', 'isolde', 'cleric', 'revealer', 'troublemaker', 'merlin_pure',
];
export const AVALON_EVIL_ROLES: AvalonRole[] = [
	'minion', 'mordred', 'morgana', 'oberon', 'evil_lancelot',
	'trickster', 'witch', 'lunatic', 'brute',
];

/** Which team a role belongs to */
export function avalonRoleTeam(role: AvalonRole): 'good' | 'evil' {
	// Inline check avoids .includes() which requires es2016+ lib
	return AVALON_GOOD_ROLES.indexOf(role) !== -1 ? 'good' : 'evil';
}

/** Mission team size by player count and mission number (1-5) */
export const AVALON_MISSION_SIZES: Record<number, [number, number, number, number, number]> = {
	5: [2, 3, 2, 3, 3],
	6: [2, 3, 4, 3, 4],
	7: [2, 3, 3, 4, 4],
	8: [3, 4, 4, 5, 5],
	9: [3, 4, 4, 5, 5],
	10: [3, 4, 4, 5, 5],
};

/** Missions that require 2 fail cards (index = mission number - 1) */
export const AVALON_DOUBLE_FAIL_MISSIONS: Record<number, number[]> = {
	7: [3],
	8: [3],
	9: [3],
	10: [3],
};

export type AvalonPhase =
	| 'waiting'          // Lobby — players joining
	| 'role_assignment'  // Roles being distributed (server-side only)
	| 'team_proposal'    // Leader proposes a mission team
	| 'team_vote'        // Players vote approve/reject on the proposal
	| 'quest'            // Approved team members submit Success/Fail cards
	| 'assassination'    // Post-game: Evil players guess Merlin
	| 'game_end';        // Game concluded

export interface AvalonQuestResult {
	succeeded: boolean;
	failCards: number; // number of fail cards submitted
}

export interface AvalonPlayerState {
	sessionId: string;
	displayName: string;
	role?: AvalonRole; // secret — only sent to the owning player
	isEvil?: boolean;   // secret — only sent to Evil players about their teammates
	questCards?: ('success' | 'fail')[]; // private per-player cards
}

export interface AvalonState extends BaseGameState {
	gameType: 'avalon';
	/** Current game phase */
	phase: AvalonPhase;
	/** Current mission number (1-5) */
	mission: number;
	/** Mission results so far [M1, M2, M3, M4, M5] */
	missionResults: (AvalonQuestResult | null)[];
	/** Index into players[] of the current leader */
	leaderIndex: number;
	/** Proposed team for current mission (sessionIds) */
	proposedTeam: string[];
	/** Who has voted on the current proposal */
	votesReceived: string[];
	/** approve=true / reject=false per player who voted */
	votes: Record<string, boolean>;
	/** Team members who have submitted quest cards this round */
	questCardsSubmitted: string[];
	/** The shuffled quest cards revealed at resolution */
	revealedQuestCards: ('success' | 'fail')[];
	/** Special abilities used this game */
	abilitiesUsed: {
		clericUsed: boolean;
		revealerUsed: boolean;
		troublemakerUsed: boolean;
		tricksterUsed: boolean;
		witchUsed: boolean;
		lancelotReversed: boolean; // tracks if Good/Evil Lancelot has flipped
	};
	/** assassination target chosen by Evil (sessionId) — only set in assassination phase */
	assassinationTarget: string | null;
	/** assassination votes: sessionId -> target sessionId */
	assassinationVotes: Record<string, string>;
	/** All players including their secret roles */
	playerStates: AvalonPlayerState[];
	/** How many proposals have been rejected in a row this round */
	consecutiveRejects: number;
	/** Final winner: 'good' | 'evil' | null */
	winner: 'good' | 'evil' | null;
	/** Extra info about game end */
	gameEndReason?: string;
	/** Role reveal info (for Cleric/Revealer abilities) */
	roleRevealTarget: string | null;
	/** Cards swapped by Troublemaker: [playerA, playerB] */
	roleSwap: [string, string] | null;
	/** Which player's card did Revealer reveal */
	revealedCardPlayer: string | null;
	/** Witch swap target */
	witchSwapTarget: string | null;
	/** Session ID of Tristan/Isolde partner */
	loversPair: [string, string] | null;
	/** Whether a Lover died (linked death mechanic) */
	loversDeath: boolean;
}

export type AvalonMove =
	| { type: 'PROPOSE_TEAM'; team: string[] }
	| { type: 'VOTE_TEAM'; approve: boolean }
	| { type: 'SUBMIT_QUEST_CARD'; card: 'success' | 'fail' }
	| { type: 'ASSASSINATE'; target: string }
	| { type: 'USE_CLERIC'; target: string }
	| { type: 'USE_REVEALER'; target: string }
	| { type: 'USE_TROUBLEMAKER'; targetA: string; targetB: string }
	| { type: 'USE_TRICKSTER'; fakeFailTarget: string }
	| { type: 'USE_WITCH'; target: string }
	| { type: 'FLIP_LANCELOT' }; // Good/Evil Lancelot ability

export type GameState = TicTacToeState | ChessState | AvalonState | CodenamesState | WerewolfState;

// ---------- Codenames: Word Spy Game ----------

export type CodenamesCardType = 'red' | 'blue' | 'bystander' | 'assassin';
export type CodenamesTeam = 'red' | 'blue';

export interface CodenamesCard {
	word: string;
	type: CodenamesCardType;
	revealed: boolean;
}

export type CodenamesPhase =
	| 'waiting'          // Lobby — players joining
	| 'role_assignment'  // Spymasters being determined
	| 'clue'              // Spymaster gives a clue
	| 'guessing'          // Operatives selecting cards
	| 'game_end';

export interface CodenamesPlayerState {
	sessionId: string;
	displayName: string;
	team: CodenamesTeam;
	role: 'spymaster' | 'operative';
}

export interface CodenamesState extends BaseGameState {
	gameType: 'codenames';
	/** 5x5 grid of codename cards */
	grid: CodenamesCard[];
	/** Which team's turn it is to give a clue */
	activeTeam: CodenamesTeam;
	/** Current phase */
	phase: CodenamesPhase;
	/** Current clue word + number (set when active team gives clue) */
	currentClue: { word: string; number: number } | null;
	/** How many guesses the operative has left this turn */
	guessesRemaining: number;
	/** Index into grid[] of the card that was just revealed (for animation) */
	lastRevealedIndex: number | null;
	/** Starting team for the current round */
	startingTeam: CodenamesTeam;
	/** Secret player assignments (server-side only) */
	playerStates: CodenamesPlayerState[];
	/** Final winner: 'red' | 'blue' | null */
	winner: CodenamesTeam | null;
	/** Extra info about game end */
	gameEndReason?: string;
}

export type CodenamesMove =
	| { type: 'GIVE_CLUE'; word: string; number: number }
	| { type: 'GUESS'; cardIndex: number }
	| { type: 'PASS' }; // Operative ends guessing

// ---------- Werewolf: Ultimate Mafia ----------

/**
 * Werewolf roles. Default setup:
 * - villager: Vanilla, no special abilities
 * - werewolf: Sees other werewolves, eliminates one player per night
 * - seer: May peek one player's role each night
 * - hunter: Upon death, may eliminate one player
 */
export type WerewolfRole = 'villager' | 'werewolf' | 'seer' | 'hunter' | 'default';

export type WerewolfTeam = 'villagers' | 'werewolves';

export function werewolfRoleTeam(role: WerewolfRole): WerewolfTeam {
	return role === 'werewolf' ? 'werewolves' : 'villagers';
}

/**
 * Player in the Werewolf game with their current status.
 * role is secret — only sent to the owning player.
 */
export interface WerewolfPlayerState {
	sessionId: string;
	displayName: string;
	role?: WerewolfRole;      // secret — only sent to owning player
	isDead?: boolean;          // whether player has been eliminated
	hasVoted?: boolean;        // whether player has voted this round
	voteTarget?: string;       // sessionId they voted for
}

export type WerewolfPhase =
	| 'waiting'           // Lobby — players joining
	| 'role_assignment'  // Roles being distributed (server-side only)
	| 'night'             // Werewolves + Seer act
	| 'day'               // Discussion phase
	| 'voting'            // Players vote to eliminate
	| 'game_end';         // Game concluded

export interface WerewolfState extends BaseGameState {
	gameType: 'werewolf';
	/** Current phase */
	phase: WerewolfPhase;
	/** All players including their secret roles (server-side only) */
	playerStates: WerewolfPlayerState[];
	/** Session IDs of players who were eliminated (dead this round, shown publicly) */
	deadPlayers: string[];
	/** Session IDs of living players */
	alivePlayers: string[];
	/** Werewolf kill target chosen last night (sessionId) */
	werewolfKillTarget: string | null;
	/** Seer peek result: sessionId → role */
	seerPeekResults: Record<string, WerewolfRole>;
	/** Hunter elimination target chosen (sessionId) */
	hunterKillTarget: string | null;
	/** Hunter's choice of who to eliminate when they die */
	hunterTarget: string | null;
	/** Players who have acted this night (sessionId[]) */
	nightActionsReceived: string[];
	/** Current votes during voting phase: sessionId → voteTarget */
	votes: Record<string, string>;
	/** Players who have voted this round */
	votesReceived: string[];
	/** Whether day discussion has started (first morning after night) */
	dayStarted: boolean;
	/** Consecutive ties in voting (forces revote) */
	consecutiveTies: number;
	/** Phase transition timestamp (for night suspense delay) */
	phaseStartedAt: number;
	/** Final winner: 'villagers' | 'werewolves' | null */
	winner: WerewolfTeam | null;
	/** Extra info about game end */
	gameEndReason?: string;
	/** Night number (starts at 1) */
	nightNumber: number;
}

export type WerewolfMove =
	| { type: 'WEREWOLF_KILL'; target: string }         // Werewolf: eliminate a player
	| { type: 'SEER_PEEK'; target: string }              // Seer: peek a player's role
	| { type: 'HUNTER_SHOOT'; target: string }          // Hunter: eliminate on death
	| { type: 'VOTE'; target: string }                  // Day vote to eliminate
	| { type: 'PASS' };                                   // Skip night action

// ---------- Move ----------

export interface TicTacToeMove {
  type: 'PLACE_MARK';
  /** Flat cell index 0-8 (row-major): 0=top-left, 8=bottom-right */
  cell: number;
}

export interface ChessMove {
  type: 'MOVE_PIECE';
  from: string; // e.g., 'e2'
  to: string;   // e.g., 'e4'
}

export type Move = TicTacToeMove | ChessMove | AvalonMove | CodenamesMove | WerewolfMove;

// ---------- Move Result ----------

export interface MoveError {
  code:
    | 'NOT_YOUR_TURN'
    | 'CELL_OCCUPIED'
    | 'INVALID_MOVE'
    | 'GAME_OVER'
    | 'PLAYER_NOT_IN_GAME'
    | 'MOVE_OUT_OF_RANGE'
    | 'NOT_LEADER'
    | 'NOT_ON_PROPOSED_TEAM'
    | 'ALREADY_VOTED'
    | 'ALREADY_SUBMITTED_QUEST_CARD'
    | 'ABILITY_ALREADY_USED'
    | 'NOT_EVIL_PLAYER'
    | 'NOT_ASSASSIN_PHASE'
    | 'INVALID_TARGET';
  message: string;
}

export interface MoveResult<S = GameState> {
  ok: boolean;
  state?: S;
  error?: MoveError;
}

// ---------- Game End ----------

export type GameEndReason =
	| 'CHECKMATE'
	| 'STALEMATE'
	| 'RESIGNATION'
	| 'TIME_OUT'
	| 'AGREED_DRAW'
	| 'THREE_IN_A_ROW'      // Tic-Tac-Toe
	| 'BOARD_FULL'          // Tic-Tac-Toe draw
	| 'MERLIN_ASSASSINATED' // Avalon: Evil guessed Merlin
	| 'THREE_MISSIONS_WON'  // Avalon: Good completed 3 missions
	| 'THREE_MISSIONS_FAILED'; // Avalon: Evil failed 3 missions

export interface GameEnd {
  winner: string | null; // null = draw
  reason: GameEndReason;
}

// ---------- Leaderboard ----------

export interface GameStats {
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  winRate: number;
}

export interface LeaderboardEntry {
  rank: number;
  sessionHash: string;
  displayName: string;
  stats: GameStats;
}

// ---------- API Request / Response ----------

// --- Rooms ---

export interface CreateRoomRequest {
  gameType: GameType;
  displayName?: string;
}

export interface CreateRoomResponse {
  roomCode: string;
  room: Room;
}

export interface JoinRoomRequest {
  displayName?: string;
}

export interface JoinRoomResponse {
  room: Room;
  /** Assigned player symbol (X/O/white/black) */
  symbol: string;
}

export interface RoomInfoResponse {
  room: Room;
}

// --- Games ---

export interface GameInfo {
  gameType: GameType;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Short slug for URL routing */
  slug: string;
  /** Emoji icon */
  icon: string;
}

export interface GameInfoListResponse {
  games: GameInfo[];
}

export interface GameInfoResponse {
  game: GameInfo;
}

// --- Leaderboard ---

export interface LeaderboardResponse {
  gameType: GameType;
  entries: LeaderboardEntry[];
}

// ---------- WebSocket Messages ----------

// --- Client → Server ---

export type ClientMessage =
  | { type: 'JOIN_ROOM'; payload: { roomCode: string; displayName?: string } }
  | { type: 'JOIN_AS_SPECTATOR'; payload: { roomCode: string } }
  | { type: 'MOVE'; payload: { move: Move } }
  | { type: 'CHAT'; payload: { message: string } }
  | { type: 'HEARTBEAT'; payload: { clientTime: number } }
  | { type: 'REMATCH_REQUEST' }
  | { type: 'RESIGN' }
  | { type: 'LEAVE_ROOM' }
  // Avalon-specific
  | { type: 'AVALON_PROPOSE_TEAM'; payload: { team: string[] } }
  | { type: 'AVALON_VOTE_TEAM'; payload: { approve: boolean } }
  | { type: 'AVALON_SUBMIT_QUEST_CARD'; payload: { card: 'success' | 'fail' } }
  | { type: 'AVALON_ASSASSINATE'; payload: { target: string } }
  | { type: 'AVALON_USE_CLERIC'; payload: { target: string } }
  | { type: 'AVALON_USE_REVEALER'; payload: { target: string } }
  | { type: 'AVALON_USE_TROUBLEMAKER'; payload: { targetA: string; targetB: string } }
  | { type: 'AVALON_USE_TRICKSTER'; payload: { fakeFailTarget: string } }
  | { type: 'AVALON_USE_WITCH'; payload: { target: string } }
  | { type: 'AVALON_FLIP_LANCELOT' }
  // Codenames-specific
  | { type: 'CODENAMES_GIVE_CLUE'; payload: { word: string; number: number } }
  | { type: 'CODENAMES_GUESS'; payload: { cardIndex: number } }
  | { type: 'CODENAMES_PASS' }
  // Werewolf-specific
  | { type: 'WEREWOLF_KILL'; payload: { target: string } }
  | { type: 'WEREWOLF_PEEK'; payload: { target: string } }
  | { type: 'WEREWOLF_HUNTER_SHOOT'; payload: { target: string } }
  | { type: 'WEREWOLF_VOTE'; payload: { target: string } }
  | { type: 'WEREWOLF_PASS' };

// --- Server → Client ---

export type ServerMessage =
  | { type: 'CONNECTED'; payload: { sessionId: string } }
  | { type: 'ROOM_JOINED'; payload: { room: Room; symbol: string; mySessionId: string } }
  | { type: 'PLAYER_JOINED'; payload: { player: Player } }
  | { type: 'PLAYER_LEFT'; payload: { sessionId: string; reason: 'left' | 'disconnected' | 'kicked' } }
  | { type: 'GAME_START'; payload: { state: GameState } }
  | { type: 'STATE_UPDATE'; payload: { state: GameState; lastMove: Move } }
  | { type: 'GAME_END'; payload: { result: GameEnd; state: GameState } }
  | { type: 'REMATCH_OFFERED'; payload: { sessionId: string } }
  | { type: 'REMATCH_ACCEPTED'; payload: { newRoomCode: string; state: GameState } }
  | { type: 'CHAT'; payload: { sessionId: string; displayName: string; message: string } }
  | { type: 'HEARTBEAT_ACK'; payload: { serverTime: number; clientTime: number } }
  | { type: 'ERROR'; payload: { code: string; message: string } }
  | { type: 'ROOM_NOT_FOUND' }
  | { type: 'ROOM_FULL' }
  | { type: 'SPECTATOR_JOINED'; payload: { spectator: Spectator } }
  | { type: 'SPECTATOR_LEFT'; payload: { sessionId: string } }
  // Avalon-specific
  | { type: 'AVALON_ROLE_ASSIGNED'; payload: { role: AvalonRole; isEvil: boolean; teammates?: string[]; merlinSees?: string[]; percivalSees?: string[] } }
  | { type: 'AVALON_PHASE_CHANGE'; payload: { phase: AvalonPhase; leaderIndex: number; missionSizes: number[] } }
  | { type: 'AVALON_TEAM_PROPOSED'; payload: { leader: string; team: string[] } }
  | { type: 'AVALON_TEAM_VOTE'; payload: { votes: Record<string, boolean>; votesReceived: string[] } }
  | { type: 'AVALON_QUEST_RESULT'; payload: { succeeded: boolean; failCards: number; revealedCards: ('success' | 'fail')[] } }
  | { type: 'AVALON_MISSION_UPDATE'; payload: { mission: number; results: (AvalonQuestResult | null)[] } }
  | { type: 'AVALON_ASSASSINATION_PHASE'; payload: { candidates: string[] } }
  | { type: 'AVALON_ASSASSINATION_VOTE'; payload: { votes: Record<string, string> } }
  | { type: 'AVALON_ROLE_REVEAL'; payload: { target: string; role: AvalonRole } }
  | { type: 'AVALON_ABILITY_USED'; payload: { ability: string; player: string; target?: string } }
  | { type: 'AVALON_LOVERS_REVEALED'; payload: { partnerA: string; partnerB: string } }
  | { type: 'AVALON_LANCELOT_FLIPPED'; payload: { player: string; newAlignment: 'good' | 'evil' } }
  // Codenames-specific
  | { type: 'CODENAMES_ROLE_ASSIGNED'; payload: { team: CodenamesTeam; role: 'spymaster' | 'operative' } }
  | { type: 'CODENAMES_CLUE_GIVEN'; payload: { word: string; number: number; team: CodenamesTeam } }
  | { type: 'CODENAMES_CARD_REVEALED'; payload: { cardIndex: number; cardType: CodenamesCardType; guesser: string } }
  | { type: 'CODENAMES_TURN_ENDED'; payload: { nextTeam: CodenamesTeam; startingTeam: CodenamesTeam } }
  | { type: 'CODENAMES_GAME_END'; payload: { winner: CodenamesTeam; reason: string } }
  // Werewolf-specific
  | { type: 'WEREWOLF_ROLE_ASSIGNED'; payload: { role: WerewolfRole; teammates?: string[] } }
  | { type: 'WEREWOLF_PHASE_CHANGE'; payload: { phase: WerewolfPhase; nightNumber?: number; phaseStartedAt: number } }
  | { type: 'WEREWOLF_NIGHT_ACTION'; payload: { playerId: string; action: string } }  // notifies player acted (not what they did)
  | { type: 'WEREWOLF_KILL_RESULT'; payload: { target: string; died: boolean; byHunter: boolean } }
  | { type: 'WEREWOLF_SEER_RESULT'; payload: { target: string; role: WerewolfRole } }  // private to seer
  | { type: 'WEREWOLF_VOTE_UPDATE'; payload: { votes: Record<string, string>; votesReceived: string[] } }
  | { type: 'WEREWOLF_VOTE_RESULT'; payload: { eliminated: string | null; tied: boolean } }
  | { type: 'WEREWOLF_GAME_END'; payload: { winner: WerewolfTeam; reason: string } }
  | { type: 'WEREWOLF_DEATH'; payload: { sessionId: string; byHunter: boolean } }
  | { type: 'WEREWOLF_WEREWOLVES_SEEN'; payload: { teammates: string[] } };  // private to werewolves

// ---------- Rate Limit Error ----------

export interface RateLimitError {
  error: 'RATE_LIMITED';
  retryAfter: number; // seconds
}
