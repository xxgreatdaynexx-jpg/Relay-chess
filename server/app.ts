import { invHealth } from './invFence.js';
import { getBank } from './casino-store.js';
import { nightlyView } from './nightly-event.js';
import { getAccounts } from './accounts.js';
import { validateSettings } from '../shared/settings.js';
import { getChessStats } from './chess-stats.js';
import { getArenaLedger } from './arena-store.js';
import { mountClientErrors } from './client-error.js';
import express from 'express';
import { buildInfo } from './build.js';
import { requestsRouter } from './requests.js';
import { mayorRouter } from './mayor.js';
import { cityRouter } from './city.js';
import { economyRouter } from './economy.js';
import { wealthTaxRouter } from './wealth-tax.js';
import { factoryViewRouter } from './factory.js';
import { priceIndexRouter } from './price-index.js';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getCheckersLeaderboard, getLeaderboard } from './leaderboard.js';
import { boardFor, isQaName } from '../shared/qa.js';
import { getChatLog } from './chat.js';
import { registerSockets, stopMaintenance } from './sockets.js';
import { resetRooms } from './rooms.js';
import { getConquest } from './conquest.js';
import { getSolitro, solitroBoard } from './solitro.js';
import { bootStates, reconnectMsg } from './boot-retry.js';
import { adminRouter } from './admin.js';
import { backTaxRefundRouter } from './backTaxRefund.js';
import { trailerRouter } from './trailers.js';
import { coopMapSummary } from './coop.js';
import { getEstate } from './estateProjects.js';
import { realEstateRouter } from './realEstate.js';
import { playerProfileRouter } from './player-profile.js';
import { houseRoomRouter } from './house-room.js';
import { farmRouter } from './farm.js';
import { lootMatchRouter } from './lootMatch.js';
import { employmentRouter } from './employment.js';
import { getMinesBoard } from './mines-board.js';
import { isMinePeriod } from '../shared/minesBoard.js';
import { getWeekly } from './weeklyEvent.js';
import { isHubAwake, hubSleepView, HUB_SLEEP_MSG } from '../shared/hubSleep.js';
import { isMillionairePrelaunch, millionairePrelaunchView, MILLIONAIRE_PRELAUNCH_MSG } from '../shared/millionairePrelaunch.js';

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
  // Overnight hub sleep 01:00–07:00 UTC-6: block play/API; keep health (+ build/status) for Render.
  // Millionaire prelaunch (19:45–20:00 UTC-6 Nov 6 2026): separate maintenance gate; admin bearer still works.
  const HUB_SLEEP_ALLOW = new Set(['/health', '/api/health', '/api/build', '/api/hub-sleep', '/api/millionaire-prelaunch']);
  const PRELAUNCH_ALLOW = new Set(['/health', '/api/health', '/api/build', '/api/hub-sleep', '/api/millionaire-prelaunch']);
  app.use((req, res, next) => {
    const path = req.path || '';
    // Static assets + SPA shell always load so overlays can render without refresh.
    if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/health') return next();
    if (isMillionairePrelaunch()) {
      if (PRELAUNCH_ALLOW.has(path)) return next();
      // Authenticated admin/deploy only — router still checks bearer; no arbitrary user bypass.
      if (path.startsWith('/api/admin')) return next();
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ ...millionairePrelaunchView(), ok: false, error: MILLIONAIRE_PRELAUNCH_MSG });
    }
    if (!isHubAwake()) {
      if (HUB_SLEEP_ALLOW.has(path)) return next();
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ ...hubSleepView(), ok: false, error: HUB_SLEEP_MSG });
    }
    return next();
  });
  mountClientErrors(app); // t2051: classified client crash reports
  app.get('/api/hub-sleep', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...hubSleepView() });
  });
  app.get('/api/millionaire-prelaunch', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...millionairePrelaunchView() });
  });
  app.use(adminRouter());
  app.use(backTaxRefundRouter());
  app.use(trailerRouter());
  app.get('/api/coop', (_req, res) => { res.json({ ok: true, projects: coopMapSummary() }); });
  app.get('/api/estate', (_req, res) => { const e = getEstate(); res.json({ ok: true, ...(e ? e.mapSummary() : { sites: [], rigs: [], hyper: [] }) }); });
  app.use(realEstateRouter());
  app.use(farmRouter());
  app.use(employmentRouter());
  app.use(lootMatchRouter());
  app.use(requestsRouter());
  app.use(mayorRouter());
  app.use(cityRouter());
  app.use(economyRouter());
  app.use(wealthTaxRouter());
  app.use(factoryViewRouter());
  app.use(priceIndexRouter());
  app.get('/health', (_req, res) => {
    // Truck logistics: not healthy while this process does not hold the inventory writer fence or has not finished its
    // boot migration (writes would be refused): never "silently healthy" with inventory down.
    const inv = invHealth(); res.status(inv.ok ? 200 : 503).json({ ok: inv.ok, inventory: inv });
  });
  /** True only for a valid signed-in session whose account name starts with QA-. */
  const viewerIsQa = async (req: express.Request): Promise<boolean> => {
    const token = req.get('x-relay-session');
    if (!token) return false;
    try { return isQaName((await getAccounts().resume(token))?.name); } catch { return false; }
  };

  /** Render health check: 200 only when the chip DB is connected (or dev memory mode), else 503 so the instance takes no traffic. */
  app.get('/api/health', (_req, res) => {
    const bank = getBank();
    res.set('Cache-Control', 'no-store');
    const chipDb = bank.status === 'ok' ? 'ok' : bank.status === 'memory' ? 'memory' : bank.status;
    const inv = invHealth(); const ok = bank.ready && inv.ok;
    res.status(ok ? 200 : 503).json({ ok, chipDb, inventory: inv, ...(bank.ready ? {} : { error: bank.lastError ?? 'connecting' }), ...(bank.ready && !inv.ok ? { error: 'inventory writer not ready (fence ' + inv.fence + ')' } : {}), subsystems: bootStates(), build: buildInfo() });
  });
  app.get('/api/weekly-event', (_req, res) => { res.set('Cache-Control', 'no-store'); const v = getWeekly().view(null); res.json({ ok: true, ...v, top: v.top.slice(0, 5) }); });
  app.get('/api/nightly-event', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(nightlyView()); });
  app.get('/api/build', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildInfo()); });

  app.get('/api/hiscores', async (req, res) => {
    try {
      const skill = typeof req.query.skill === 'string' ? req.query.skill : 'overall';
      const { getSkills } = await import('./skills.js');
      res.set('Cache-Control', 'no-store');
      res.json({ skill, rows: await getSkills().hiscores(skill) });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  /** A subsystem still reconnecting to Postgres: say so instead of serving an empty board as if it were real. */
  const offline = (res: express.Response, what: string, key = 'rows') => res.status(503).json({ ok: false, offline: true, error: reconnectMsg(what), [key]: [] });

  app.get('/api/leaderboard', async (req, res) => {
    const board = getLeaderboard();
    if (board.offline) return void offline(res, 'The leaderboard');
    await board.refresh();
    const stats = getChessStats();
    const qa = await viewerIsQa(req);
    res.json({ rows: boardFor(board.standings(), qa).map((row) => (stats.offline ? row : { ...row, ...stats.statsFor(row.name) })), source: board.usingDatabase ? 'postgres' : 'memory' });
  });

  app.get('/api/checkers-leaderboard', async (req, res) => {
    const board = getCheckersLeaderboard();
    if (board.offline) return void offline(res, 'The leaderboard');
    await board.refresh();
    res.json({ rows: boardFor(board.standings(), await viewerIsQa(req)), source: board.usingDatabase ? 'postgres' : 'memory' });
  });

  app.get('/api/conquest-leaderboard', async (req, res) => {
    const board = getConquest().board;
    if (board.offline) return void offline(res, 'The leaderboard');
    await board.refresh();
    res.json({ rows: boardFor(board.standings(), await viewerIsQa(req)), source: board.usingDatabase ? 'postgres' : 'memory' });
  });

  app.get('/api/arena-leaderboard', async (req, res) => {
    const ledger = getArenaLedger();
    if (ledger.offline) return void offline(res, 'Arena stats');
    res.json({ rows: boardFor(ledger.standings(1e6), await viewerIsQa(req), 100), source: ledger.usingDatabase ? 'postgres' : 'memory' });
  });

  /** Mining leaderboard (Today / This week / All time). QA- accounts and guests are never on it. */
  app.get('/api/mines-leaderboard', async (req, res) => {
    const period = isMinePeriod(req.query.period) ? req.query.period : 'all';
    const b = getMinesBoard();
    try { res.json({ period, ...(await b.board(period)), source: b.usingDatabase ? 'postgres' : 'memory' }); }
    catch (e) { console.error('[mines] leaderboard failed:', (e as Error).message); res.status(500).json({ error: 'Mining leaderboard unavailable.' }); }
  });

  app.get('/api/solitro-leaderboard', async (req, res) => {
    if (getSolitro().offline) return void offline(res, 'Solitro');
    res.json({ rows: solitroBoard(await viewerIsQa(req)), source: getSolitro().usingDatabase ? 'postgres' : 'memory' });
  });

  /** Recent global chat (read-only). QA accounts' messages are only included for a signed-in QA viewer. */
  app.get('/api/chat', async (req, res) => {
    const log = getChatLog();
    if (log.offline) return void offline(res, 'Chat', 'messages');
    res.json({ messages: log.history(await viewerIsQa(req)), source: log.usingDatabase ? 'postgres' : 'memory' });
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
  app.use(playerProfileRouter(io, viewerIsQa));
  app.use(houseRoomRouter());

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
    // A hashed asset that isn't in this build (old tab after a deploy) is a real 404, never the SPA shell served as
    // text/html: that made lazy chunks "load" as HTML and broke the 3D engine silently.
    app.use((req, res, next) => {
      if (isMissingAssetPath(req.path)) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).type('text/plain').send('Not found'); }
      next();
    });
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

/** A request for a static file (hashed /assets/* or anything with a static extension) that express.static didn't find. */
export function isMissingAssetPath(p: string): boolean {
  if (p.startsWith('/api/') || p.startsWith('/socket.io')) return false;
  return p.startsWith('/assets/') || /\.(?:m?js|css|map|wasm|woff2?|ttf|png|jpe?g|gif|svg|webp|avif|ico|glb|gltf|mp3|ogg|wav)$/i.test(p);
}
