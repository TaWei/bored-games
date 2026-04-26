// ============================================================
// SERVER ENTRY — Bun HTTP + WebSocket + Hono API
// ============================================================

import { serve } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { routes } from './routes';
import { handleWebSocket, handleWSMessage, handleWSClose, getOrCreateGameLoop, WsContext } from './ws/handler';
import { config, PORT, isDevelopment } from './lib/config';
import { redis, redisSub } from './lib/redis';
import { processQueue } from './services/matchmaking';
import { isValidRoomCode, isValidSessionId } from '@bored-games/shared';

// ----- App setup -----

const app = new Hono();

// ----- Middleware -----

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);

// ----- Health check -----

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
  })
);

// ----- API routes -----

app.route('/api', routes);

// ----- Serve React frontend in production -----

if (isDevelopment) {
  // In dev, Vite proxy handles static files
  app.get('/', (c) =>
    c.html(
      `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=http://localhost:5173" /></head>
<body><p>Redirecting to <a href="http://localhost:5173">client dev server</a>...</p></body></html>`
    )
  );
} else {
  // In production, serve the built React app
  app.get('/*', serveStatic({ root: './client/dist', rewriteRequestPath: (p) => p }));
}

// ----- Bun native WebSocket server -----
// Handles /ws path — separate from Hono HTTP handler

const server = serve({
  port: parseInt(PORT),
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade path
    if (url.pathname === '/ws') {
      console.log(`[WS] fetch /ws — url=${req.url} method=${req.method} headers=${JSON.stringify(Object.fromEntries(req.headers.entries()))}`);
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const roomCode = (url.searchParams.get('room') ?? '').toUpperCase();
      const mode = (url.searchParams.get('mode') ?? 'play') as 'play' | 'spectate';

      if (!isValidSessionId(sessionId) || !isValidRoomCode(roomCode)) {
        return new Response('Bad request', { status: 400 });
      }

      const isSpectator = mode === 'spectate';

      const upgraded = server.upgrade(req, {
        data: { sessionId, roomCode, isSpectator } as WsContext,
      });

      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      return new Response(null, { status: 200 }); // upgrade succeeded, let WS event handle it
    }

    // Regular HTTP — let Hono handle it
    return app.fetch(req, { server });
  },

  websocket: {
    open(ws) {
      const { sessionId, roomCode, isSpectator } = ws.data as WsContext;

      if (!sessionId || !roomCode) {
        console.error('[WS] open — missing sessionId/roomCode in ws.data, closing');
        ws.close(1011, 'Missing context data');
        return;
      }

      if (isDevelopment) {
        console.log(`🔌 WS open — session=${sessionId.slice(0, 8)}… room=${roomCode} spectator=${isSpectator}`);
      }

      handleWebSocket(ws as any, sessionId, roomCode, isSpectator).catch((err) => {
        console.error('[WS] handleWebSocket threw:', err);
        console.log(`[WS] Closing socket with 1011 — sessionId=${sessionId} roomCode=${roomCode}`);
        ws.close(1011, 'Internal error');
      });
    },

    message(ws, msg) {
      // Route message to the game loop via handleWSMessage
      try {
        handleWSMessage(ws as any, msg as string | Buffer);
      } catch (err) {
        console.error('[WS] handleWSMessage threw:', err);
        console.log(`[WS] Closing socket with 1011 — sessionId=${ws.data?.sessionId} roomCode=${ws.data?.roomCode}`);
        ws.close(1011, 'Message handler error');
      }
    },

    close(ws, code, reason) {
      console.log(`[WS] WebSocket closed — code=${code} reason=${reason} url=${ws.url}`);
      handleWSClose(ws as any);
    },
  },
});

// ----- Queue processor (background task) -----
// Process matchmaking queues every 2 seconds

const queueInterval = setInterval(async () => {
  try {
    await processQueue('tic-tac-toe');
    await processQueue('chess');
    await processQueue('avalon');
    await processQueue('codenames');
    await processQueue('werewolf');
  } catch (err) {
    console.error('Queue processing error:', err);
  }
}, 2000);

// ----- Redis keyspace notification processor -----

async function setupKeyspaceNotifications() {
  try {
    await redis.config('SET', 'notify-keyspace-events', 'Ex');
    const sub = redis.duplicate();
    await sub.subscribe('__keyevent@0__:expired');

    sub.on('message', (channel, key) => {
      if (key.startsWith('room:') && key.split(':').length === 2) {
        const code = key.split(':')[1];
        if (code && code.length === 6) {
          console.log(`🧹 Room ${code} expired (TTL reached)`);
          redis
            .publish(`room:${code}:events`, JSON.stringify({ type: 'ROOM_EXPIRED' }))
            .catch(() => {});
        }
      }
    });
  } catch (err) {
    console.warn('⚠️  Keyspace notifications not available — room cleanup relies on connection-close handlers');
  }
}

setupKeyspaceNotifications();

// ----- Start server -----

console.log(`
╔═══════════════════════════════════════════╗
║     🎲 Bored Games Server                ║
╠═══════════════════════════════════════════╣
║  HTTP:  http://localhost:${PORT}               ║
║  WS:    ws://localhost:${PORT}/ws             ║
║  Env:   ${(isDevelopment ? 'development  ' : 'production   ')}              ║
╚═══════════════════════════════════════════╝
`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  clearInterval(queueInterval);
  server.stop();
  redis.quit();
  redisSub.quit();
  process.exit(0);
});
