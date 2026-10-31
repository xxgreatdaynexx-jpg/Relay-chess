import type { Server, Socket } from 'socket.io';
import { guestName, MOVE_SPEED, TICK_HZ } from '../shared/fps.js';
import { ArenaWorld, type ArenaEvent } from './arena-world.js';
import { getArenaLedger } from './arena-store.js';
import { ArenaBots, isArenaBot, warmNavGraphs } from './arena-bots.js';
import { MAPS } from '../shared/arenaMaps.js';
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) warmNavGraphs(Object.values(MAPS));

/** socket id -> claimed account name; guests are absent and never recorded. */
const claimed = new Map<string, string>();

const ROOM = '__fps_arena';
const MAX_PLAYERS = 24;
let world = new ArenaWorld();
let ticker: ReturnType<typeof setInterval> | null = null;

// ---- QA bots (test hook). Disabled unless ARENA_QA_BOTS=1 is set on the server; never set it in production.
export const QA_BOT_PREFIX = 'qa-bot-';
const MAX_QA_BOTS = 6;
const botHeading = new Map<string, number>();
export const qaBotsEnabled = () => process.env.ARENA_QA_BOTS === '1';
const isBot = (id: string) => id.startsWith(QA_BOT_PREFIX) || isArenaBot(id);
const isHuman = (id: string) => !isBot(id);
/** Fill-in bots: 3 join when exactly one human plays, they leave when a second human arrives, none run with nobody. */
let arenaBots = new ArenaBots();
const syncBots = (now: number) => arenaBots.sync(world, now, isHuman);

/** Adds up to `n` wandering, non-shooting bots so QA can chain kills (killstreaks, UAV, airstrike, drone, nuke). */
export function addQaBots(n: unknown, now = Date.now()): number {
  if (!qaBotsEnabled()) return 0;
  const want = Math.max(0, Math.min(MAX_QA_BOTS, Math.floor(Number(n) || 0)));
  let have = [...world.fighters.keys()].filter(isBot).length;
  let added = 0;
  for (let i = 1; have < want && i <= MAX_QA_BOTS; i++) {
    const id = `${QA_BOT_PREFIX}${i}`;
    if (world.fighters.has(id)) continue;
    world.join(id, `QA Bot ${i}`, now);
    botHeading.set(id, Math.random() * Math.PI * 2);
    have++;
    added++;
  }
  return added;
}

/** Slow random walk with the odd jump (so QA can shoot at targets at different heights); bots turn when they bump a wall. */
function driveBots(now: number): void {
  for (const f of world.fighters.values()) {
    if (!f.id.startsWith(QA_BOT_PREFIX) || !f.alive) continue;
    let a = botHeading.get(f.id) ?? 0;
    const step = (MOVE_SPEED * 0.4) / TICK_HZ;
    const bx = f.x, by = f.y;
    world.move(f.id, f.x + Math.cos(a) * step, f.y + Math.sin(a) * step, a, now, 0);
    if (Math.hypot(f.x - bx, f.y - by) < step * 0.3 || Math.random() < 0.02) {
      a = Math.random() * Math.PI * 2;
      botHeading.set(f.id, a);
    }
    if (Math.random() < 0.015) world.jump(f.id, now);
  }
}

function dropBotsIfAlone(): void {
  if ([...world.fighters.keys()].some(isHuman)) return;
  for (const id of [...world.fighters.keys()]) { world.leave(id); botHeading.delete(id); }
  arenaBots = new ArenaBots();
}

export function resetArena(): void {
  world = new ArenaWorld();
  botHeading.clear();
  arenaBots = new ArenaBots();
  claimed.clear();
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** Folds arena events into lifetime stats (server-side only). */
export function recordArena(events: ArenaEvent[], w: ArenaWorld = world): void {
  const ledger = getArenaLedger();
  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    if (e.ev === 'fps_kill') {
      const killerId = d.killerId as string | null, victimId = d.victimId as string;
      // Arena bot kills and deaths never touch lifetime stats (match scoreboard only).
      if ((killerId && isArenaBot(killerId)) || isArenaBot(victimId)) continue;
      const v = claimed.get(victimId);
      if (v) ledger.death(v);
      const k = killerId ? claimed.get(killerId) : undefined;
      if (k && killerId !== victimId && d.cause !== 'nuke' && !victimId.startsWith(QA_BOT_PREFIX)) ledger.kill(k, w.fighters.get(killerId!)?.streak ?? 1);
    } else if (e.ev === 'fps_streak' && d.kind === 'nuke') {
      const n = claimed.get(d.id as string);
      if (n) ledger.nuke(n);
    } else if (e.ev === 'fps_nuke' && d.phase === 'boom') {
      for (const id of w.fighters.keys()) { const n = claimed.get(id); if (n) ledger.round(n); }
    }
  }
}

/** Test hook: mark a fighter id as a claimed name. */
export function claimArenaName(id: string, name: string | null): void {
  if (name) claimed.set(id, name); else claimed.delete(id);
}

function emit(io: Server, events: ArenaEvent[]): void {
  recordArena(events);
  for (const e of events) io.to(ROOM).emit(e.ev, e.data);
}

function ensureTicker(io: Server): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!world.fighters.size) {
      if (ticker) clearInterval(ticker);
      ticker = null;
      return;
    }
    const now = Date.now();
    driveBots(now);
    syncBots(now);
    emit(io, arenaBots.drive(world, now));
    emit(io, world.tick(now));
    io.to(ROOM).emit('fps_state', world.snapshot(now));
  }, Math.round(1000 / TICK_HZ));
  (ticker as unknown as { unref?: () => void }).unref?.();
}

function leave(io: Server, socket: Socket): void {
  if (!world.leave(socket.id)) return;
  claimed.delete(socket.id);
  dropBotsIfAlone();
  syncBots(Date.now());
  socket.leave(ROOM);
  io.to(ROOM).emit('fps_state', world.snapshot(Date.now()));
}

const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

export function registerFps(io: Server, socket: Socket): void {
  socket.on('fps_join', (payload: unknown, ack?: (res: unknown) => void) => {
    if (!world.fighters.has(socket.id)) {
      if (world.fighters.size >= MAX_PLAYERS) {
        ack?.({ ok: false, error: 'Arena is full, try again in a bit.' });
        return;
      }
      const account = (socket.data.account as { name?: string } | undefined)?.name;
      world.join(socket.id, account ?? guestName(), Date.now());
      // The first human in can choose the map straight away.
      const want = body(payload).map;
      if (want !== undefined) { const ev = world.pickMap(want, socket.id, Date.now(), isHuman); if (ev) emit(io, ev); }
      claimArenaName(socket.id, account ?? null);
      if (account) getArenaLedger().match(account);
      socket.join(ROOM);
    }
    syncBots(Date.now());
    const bots = addQaBots(body(payload).qaBots);
    if (bots) io.to(ROOM).emit('fps_state', world.snapshot(Date.now()));
    const f = world.fighters.get(socket.id)!;
    ack?.({ ok: true, id: socket.id, x: f.x, y: f.y, z: f.z, a: f.a, map: world.map.id });
    ensureTicker(io);
  });
  socket.on('fps_move', (p: unknown) => {
    const b = body(p);
    world.move(socket.id, b.x, b.y, b.a, Date.now(), b.p);
  });
  socket.on('fps_shoot', (p: unknown) => emit(io, world.shoot(socket.id, body(p).a, Date.now(), body(p).p)));
  socket.on('fps_jump', () => emit(io, world.jump(socket.id, Date.now())));
  socket.on('fps_weapon', (p: unknown) => world.switchWeapon(socket.id, body(p).w, Date.now()));
  socket.on('fps_reload', () => world.reload(socket.id, Date.now()));
  socket.on('fps_scope', (p: unknown) => world.setScope(socket.id, body(p).on, Date.now()));
  socket.on('fps_map', (p: unknown, ack?: (res: unknown) => void) => {
    const ev = world.pickMap(body(p).map, socket.id, Date.now(), isHuman);
    if (ev) { emit(io, ev); io.to(ROOM).emit('fps_state', world.snapshot(Date.now())); }
    if (typeof ack === 'function') ack({ ok: !!ev, map: world.map.id, next: world.upcomingMapId });
  });
  socket.on('fps_leave', () => leave(io, socket));
  socket.on('disconnect', () => leave(io, socket));
}
