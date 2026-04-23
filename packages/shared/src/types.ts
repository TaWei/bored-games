// ============================================================
// CORE TYPES — Shared across server and client
// ============================================================

// ---------- Session & Identity ----------

export type GameType = 'tic-tac-toe' | 'chess' | 'connect-four';

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

export type GameState = TicTacToeState | ChessState;

// ---------- Move ----------

export interface TicTacToeMove {
  type: 'PLACE_MARK';
  cell: [number, number]; // [row, col], 0-indexed
}

export interface ChessMove {
  type: 'MOVE_PIECE';
  from: string; // e.g., 'e2'
  to: string;   // e.g., 'e4'
}

export type Move = TicTacToeMove | ChessMove;

// ---------- Move Result ----------

export interface MoveError {
  code:
    | 'NOT_YOUR_TURN'
    | 'CELL_OCCUPIED'
    | 'INVALID_MOVE'
    | 'GAME_OVER'
    | 'PLAYER_NOT_IN_GAME'
    | 'MOVE_OUT_OF_RANGE';
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
  | 'BOARD_FULL';         // Tic-Tac-Toe draw

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
  | { type: 'LEAVE_ROOM' };

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
  | { type: 'SPECTATOR_LEFT'; payload: { sessionId: string } };

// ---------- Rate Limit Error ----------

export interface RateLimitError {
  error: 'RATE_LIMITED';
  retryAfter: number; // seconds
}
