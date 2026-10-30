import { getArenaLedger } from './arena-store.js';
import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getLeaderboard } from './leaderboard.js';
import { registerSockets, stopMaintenance } from './sockets.js';
import { resetRooms } from './rooms.js';

export interface AppContext {
  httpServer: HttpServer;
  io: Server;
}

export async function createApp(): Promise<AppContext> {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/leaderboard', async (_req, res) => {
    const board = getLeaderboard();
    await board.refresh();
    res.json({ rows: board.standings(), source: board.usingDatabase ? 'postgres' : 'memory' });
  });

  app.get('/api/arena-leaderboard', (_req, res) => {
    const ledger = getArenaLedger();
    res.json({ rows: ledger.standings(), source: ledger.usingDatabase ? 'postgres' : 'memory' });
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: false },
    pingInterval: 20000,
    pingTimeout: 20000,
  });
  registerSockets(io);

  if (process.env.NODE_ENV === 'production') {
    const clientDist = fileURLToPath(new URL('../client', import.meta.url));
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(clientDist, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  } else if (process.env.NODE_ENV !== 'test') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, ws: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  return { httpServer, io };
}

export async function closeApp(ctx: AppContext): Promise<void> {
  stopMaintenance();
  await new Promise<void>((resolve) => {
    ctx.io.close(() => resolve());
  });
  if (ctx.httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      ctx.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  resetRooms();
}
