# 🎲 Bored Games

> Anonymous real-time board games — no account, no email, instant play.

Stack: **Bun** + **Hono** + **React** + **Redis** + **PostgreSQL**

## Quick Start

```bash
# Prerequisites: Bun 1.1+, Docker

# 1. Clone and install
bun install

# 2. Start infrastructure (Redis + PostgreSQL)
docker-compose up -d

# 3. Run database migrations
bun run db:migrate

# 4. Start dev servers (server + client concurrently)
bun run dev

# Client:    http://localhost:5173
# API:       http://localhost:3000
# Health:    http://localhost:3000/health
```

In development, the Vite dev server proxies `/api` and `/ws` requests to the Bun server at port 3000 — no CORS issues, same origin. The server redirects `/` to the Vite client during dev.

## Dev Server Proxy

Vite (`client/vite.config.ts`) runs at **port 5173** and proxies two paths to the Bun server at **port 3000**:

```
Browser → Vite (5173) ─┬─ /api/*  → Bun server (3000) → REST API
                       └─ /ws/*   → Bun server (3000) → WebSocket
```

This means the client makes API calls to `/api/rooms`, `/api/games`, etc. just as it would in production, but Vite forwards them to the server automatically. In production, the built React app is served directly by the Bun server at `/` and API/WebSocket requests go directly to port 3000.

## Architecture

```
Browser (React) ←→ Bun HTTP/WS (Hono) ←→ Redis (state + pub/sub)
                                    ←→ PostgreSQL (persistence)
```

- **Server-authoritative**: all game logic runs server-side, clients render only
- **Anonymous**: sessionId = crypto.randomUUID(), stored in localStorage
- **Real-time**: WebSocket connections with Redis Pub/Sub fan-out
- **Plugin-style game engines**: each game implements a `GameEngine` interface in `packages/shared/src/games/`

## Project Structure

```
packages/shared/   — Shared TypeScript types, game engines (tic-tac-toe, chess,
                      avalon, codenames, werewolf), game registry, utilities
server/            — Bun HTTP/WS server, Hono REST API, WebSocket game loop,
                      Redis services (rooms, matchmaking, leaderboard)
client/            — React + Vite frontend, Zustand stores, WebSocket hooks
```

## Supported Games

| Game | Players | Status |
|------|---------|--------|
| 🎯 Tic-Tac-Toe | 2 | ✅ Playable |
| ♟️ Chess | 2 | ✅ Playable |
| 🔮 Avalon (The Resistance) | 5–10 | ✅ Playable |
| 🕵️ Codenames | 4–8 | ✅ Playable |
| 🌙 Werewolf | 4–10 | ✅ Playable |

**Game Engine Pattern** — Each game in `packages/shared/src/games/` exports a `GameEngine` interface:

```typescript
interface GameEngine<S extends GameState, M extends Move> {
  gameType: GameType;
  minPlayers: number;
  maxPlayers: number;
  name: string;
  description: string;
  slug: string;
  icon: string;
  createInitialState(players: string[]): S;
  applyMove(state: S, move: M, playerId: string): MoveResult<S>;
  checkGameEnd(state: S): GameEnd | null;
  serialize(state: S): string;
  deserialize(data: string): S;
}
```

Games with secret roles (Avalon, Codenames, Werewolf) keep role assignments server-side only. The game-loop.ts in the server handles per-game phase transitions and broadcasts sanitized state to clients.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/games` | List all available games |
| GET | `/api/games/:type` | Get metadata for a specific game |
| POST | `/api/rooms` | Create a new room |
| GET | `/api/rooms/:code` | Get room info |
| POST | `/api/rooms/:code/join` | Join a room |
| WS | `/ws?roomCode=:code&sessionId=:id` | WebSocket for game events |

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all dev servers |
| `bun run dev:server` | Server only |
| `bun run dev:client` | Client only |
| `bun run build` | Build all packages |
| `bun run db:migrate` | Run database migrations |
| `docker-compose up -d` | Start Redis + Postgres |
| `bun run db:studio` | Open Drizzle Studio |

## License

MIT
