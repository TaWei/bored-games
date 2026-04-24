# 🎲 Bored Games

> Anonymous real-time board games — no account, no email, instant play.

Stack: **Bun** + **Hono** + **React** + **Redis** + **PostgreSQL**

## Quick Start

```bash
# Prerequisites: Bun 1.1+, Docker

# 1. Clone and install
bun install

# 2. Start infrastructure
docker-compose up -d

# 3. Start dev servers (runs server + client concurrently)
bun run dev

# Client: http://localhost:5173
# API:    http://localhost:3000
```

## Architecture

```
Browser (React) ←→ Bun HTTP/WS (Hono) ←→ Redis (state + pub/sub)
                                    ←→ PostgreSQL (persistence)
```

- **Server-authoritative**: all game logic runs server-side, clients render only
- **Anonymous**: sessionId = crypto.randomUUID(), stored in localStorage
- **Real-time**: WebSocket connections with Redis Pub/Sub fan-out

## Project Structure

```
packages/shared/   — Shared TypeScript types, game engines, utilities
server/            — Bun HTTP/WS server, Hono API, Redis services
client/            — React + Vite frontend, Zustand stores
```

## Supported Games

- 🎯 Tic-Tac-Toe (MVP)
- ♟️ Chess (planned)

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start all dev servers |
| `bun run dev:server` | Server only |
| `bun run dev:client` | Client only |
| `bun run build` | Build all packages |
| `bun run db:migrate` | Run database migrations |
| `docker-compose up -d` | Start Redis + Postgres |

## License

MIT
