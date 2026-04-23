// ============================================================
// API CLIENT — fetch wrapper with session injection
// ============================================================

const API_BASE = '/api';

interface ApiError {
  error: string;
  code?: string;
}

function getSessionId(): string {
  return localStorage.getItem('bored-games-session') ?? '';
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Inject session ID
  const sessionId = getSessionId();
  if (sessionId) {
    headers['x-session-id'] = sessionId;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    const error = new Error(body.error ?? `HTTP ${response.status}`);
    (error as unknown as { code?: string }).code = body.code;
    throw error;
  }

  return response.json() as Promise<T>;
}

// ----- Rooms -----

export async function createRoom(gameType: string): Promise<{ roomCode: string; room: unknown }> {
  return apiFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify({ gameType }),
  });
}

export async function getRoom(code: string): Promise<{ room: unknown }> {
  return apiFetch(`/rooms/${code.toUpperCase()}`);
}

export async function joinRoom(
  code: string,
  displayName?: string
): Promise<{ room: unknown; symbol: string }> {
  return apiFetch(`/rooms/${code.toUpperCase()}/join`, {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

export async function leaveRoom(code: string): Promise<{ ok: boolean }> {
  return apiFetch(`/rooms/${code.toUpperCase()}/leave`, {
    method: 'POST',
  });
}

export async function joinAsSpectator(code: string): Promise<{ room: unknown }> {
  return apiFetch(`/rooms/${code.toUpperCase()}/join-as-spectator`, {
    method: 'POST',
  });
}

// ----- Games -----

export async function getGames(): Promise<{ games: unknown[] }> {
  return apiFetch('/games');
}

// ----- Leaderboard -----

export async function getLeaderboard(
  gameType: string,
  limit = 50
): Promise<unknown> {
  return apiFetch(`/leaderboard/${gameType}?limit=${limit}`);
}

// ----- Matchmaking Queue -----

export async function addToQueue(
  gameType: string,
  displayName?: string
): Promise<{ queued: boolean; position: number; gameType: string }> {
  return apiFetch('/rooms/queue', {
    method: 'POST',
    body: JSON.stringify({ gameType, displayName }),
  });
}

export async function removeFromQueue(
  gameType: string
): Promise<{ queued: boolean }> {
  return apiFetch(`/rooms/queue?gameType=${encodeURIComponent(gameType)}`, {
    method: 'DELETE',
  });
}
