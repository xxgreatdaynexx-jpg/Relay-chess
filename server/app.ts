import { getAccounts } from './accounts.js';
import { validateSettings } from '../shared/settings.js';
import { getChessStats } from './chess-stats.js';
import { getArenaLedger } from './arena-store.js';
import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getCheckersLeaderboard, getLeaderboard } from './leaderboard.js';
import { boardFor, isQaName } from '../shared/qa.js';
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
  /** True only for a valid signed-in session whose account name starts with QA-. */
  const viewerIsQa = async (req: express.Request): Promise<boolean> => {
    const token = req.get('x-relay-session');
    if (!token) return false;
    try { return isQaName((await getAccounts().resume(token))?.name); } catch { return false; }
  };

  app.get('/api/leaderboard', async (req, res) => {
    const board = getLeaderboard();
    await board.refresh();
    const stats = getChessStats();
    const qa = await viewerIsQa(req);
    res.json({ rows: boardFor(board.standings(), qa).map((row) => ({ ...row, ...stats.statsFor(row.name) })), source: board.usingDatabase ? 'postgres' : 'memory' });
  });

  app.get('/api/checkers-leaderboard', async (req, res) => {
    const board = getCheckersLeaderboard();
    await board.refresh();
    res.json({ rows: boardFor(board.standings(), await viewerIsQa(req)), source: board.usingDatabase ? 'postgres' : 'memory' });
  });

  app.get('/api/arena-leaderboard', async (req, res) => {
    const ledger = getArenaLedger();
    res.json({ rows: boardFor(ledger.standings(1e6), await viewerIsQa(req), 100), source: ledger.usingDatabase ? 'postgres' : 'memory' });
  });

  // Settings flush on page unload (sendBeacon / keepalive fetch), so a change right before a reload is never lost.
  app.post('/api/settings', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
    try {
      const body = JSON.parse(typeof req.body === 'string' ? req.body : '{}') as { session?: unknown; settings?: unknown };
      if (typeof body.session !== 'string' || !body.session) return res.status(401).json({ ok: false });
      const me = await getAccounts().resume(body.session);
      if (!me) return res.status(401).json({ ok: false });
      const clean = validateSettings(body.settings);
      if (!clean) return res.status(400).json({ ok: false });
      await getAccounts().store.setSettings(me.key, clean);
      res.json({ ok: true });
    } catch {
      res.status(400).json({ ok: false });
    }
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
          // Vite fingerprints everything under /assets, so those can be cached forever.
          else if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      // Always revalidate the shell so a deploy is picked up on the next load (no stale bundle).
      res.setHeader('Cache-Control', 'no-cache');
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
