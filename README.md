# 🎲 Bored Games

> Anonymous real-time multiplayer board games — no account, no email, instant play.

**Stack:** Bun + Hono + React + Vite + Redis + PostgreSQL + WebSockets

---

## Features

- **Anonymous** — sessionId = `crypto.randomUUID()`, stored in localStorage. No login, no email.
- **Real-time** — WebSocket connections with Redis Pub/Sub fan-out; sub-second game state updates.
- **Server-authoritative** — all game logic runs server-side; clients are render-only.
- **Multi-game lobby** — create/join rooms with a room code, or use Quick Play for instant matchmaking.
- **Spectator mode** — watch a game in progress without participating.

---

## Supported Games

| Game | Status |
|---|---|
| 🎯 Tic-Tac-Toe | Ready |
| ♟️ Chess | Ready |
| 🕵️ Avalon | Ready |
| 🐺 Ultimate Werewolf | Ready |
| 💬 Codenames | Ready (UI pending) |

---

## Architecture

```
Browser (React + Zustand) ←→ Bun HTTP/WS (Hono) ←→ Redis (state + pub/sub)
                                            ←→ PostgreSQL (persistence)
```

- **packages/shared** — shared TypeScript types, game engine logic (tic-tac-toe, chess, avalon, werewolf, codenames), utilities for room codes and session management.
- **server** — Bun HTTP/WebSocket server with Hono API. Handles room management, matchmaking queue, game loop WS handler, leaderboard service.
- **client** — React + Vite frontend. Zustand stores for session, room, and game state. WebSocket hook for real-time updates.

### API Routes

| Path | Description |
|---|---|
| `GET /health` | Server health check |
| `GET /api/games` | List available games |
| `POST /api/rooms` | Create a room |
| `GET /api/rooms/:code` | Get room state |
| `GET /api/leaderboard` | Top players across games |
| `WS /ws?sessionId=&room=&mode=` | WebSocket (mode=play\|spectate) |

---

## Project Structure

```
bored-games/
├── packages/shared/       Shared TS types + game engines
│   └── src/
│       ├── games/          Game logic (tic-tac-toe, chess, avalon, werewolf, codenames)
│       ├── types.ts        Room, Player, GameState, WS event types
│       └── utils/          Room code gen, session helpers, display name utils
├── server/                 Bun HTTP/WS server (Hono)
│   └── src/
│       ├── index.ts        Entry point, middleware, WebSocket server
│       ├── routes/         REST API (games, rooms, leaderboard)
│       ├── services/       Room manager, matchmaking queue, leaderboard
│       ├── ws/             WebSocket handler + game loop processor
│       ├── lib/            Config, DB (Drizzle), Redis client
│       └── migrations/      Drizzle SQL migrations
└── client/                 React + Vite frontend
    └── src/
        ├── components/     Game boards, lobby, shared UI
        ├── hooks/          useGame, useSession, useWebSocket
        ├── stores/         Zustand stores (session, room, game)
        └── lib/            API client, WebSocket client
```

---

## Quick Start

```bash
# Prerequisites: Bun 1.1+, Docker

# 1. Install dependencies
bun install

# 2. Start infrastructure (Redis + Postgres)
docker compose up -d

# 3. Start dev servers (server + client concurrently)
bun run dev

# 4. Open the client
open http://localhost:5173
```

**Endpoints:**
- Client dev server: http://localhost:5173
- API server: http://localhost:3000
- WebSocket: ws://localhost:3000/ws

---

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start all dev servers (parallel) |
| `bun run dev:server` | Server only with watch mode |
| `bun run dev:client` | Client only (Vite) |
| `bun run build` | Build all packages |
| `bun run shared:build` | Build shared package |
| `bun run server:build` | Build server |
| `bun run client:build` | Build client for production |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run docker:up` | Start Docker infra |
| `bun run docker:down` | Stop Docker infra |
| `bun run clean` | Remove all dist folders |

---

## Environment Variables

Copy `.env.example` to `.env` and configure as needed. The defaults work for local development with the Docker Compose setup.

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bored_games
REDIS_URL=redis://localhost:6379
PORT=3000
```

---

## License

MIT
