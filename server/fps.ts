import type { Server, Socket } from 'socket.io';
import { guestName, TICK_HZ } from '../shared/fps.js';
import { ArenaWorld, type ArenaEvent } from './arena-world.js';
import { getArenaLedger } from './arena-store.js';

/** socket id -> claimed account name; guests are absent and never recorded. */
const claimed = new Map<string, string>();

const ROOM = '__fps_arena';
const MAX_PLAYERS = 24;
let world = new ArenaWorld();
let ticker: ReturnType<typeof setInterval> | null = null;

export function resetArena(): void {
  world = new ArenaWorld();
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
      const v = claimed.get(victimId);
      if (v) ledger.death(v);
      const k = killerId ? claimed.get(killerId) : undefined;
      if (k && killerId !== victimId && d.cause !== 'nuke') ledger.kill(k, w.fighters.get(killerId!)?.streak ?? 1);
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
    emit(io, world.tick(now));
    io.to(ROOM).emit('fps_state', world.snapshot(now));
  }, Math.round(1000 / TICK_HZ));
  (ticker as unknown as { unref?: () => void }).unref?.();
}

function leave(io: Server, socket: Socket): void {
  if (!world.leave(socket.id)) return;
  claimed.delete(socket.id);
  socket.leave(ROOM);
  io.to(ROOM).emit('fps_state', world.snapshot(Date.now()));
}

const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

export function registerFps(io: Server, socket: Socket): void {
  socket.on('fps_join', (_payload: unknown, ack?: (res: unknown) => void) => {
    if (!world.fighters.has(socket.id)) {
      if (world.fighters.size >= MAX_PLAYERS) {
        ack?.({ ok: false, error: 'Arena is full, try again in a bit.' });
        return;
      }
      const account = (socket.data.account as { name?: string } | undefined)?.name;
      world.join(socket.id, account ?? guestName(), Date.now());
      claimArenaName(socket.id, account ?? null);
      if (account) getArenaLedger().match(account);
      socket.join(ROOM);
    }
    const f = world.fighters.get(socket.id)!;
    ack?.({ ok: true, id: socket.id, x: f.x, y: f.y, a: f.a });
    ensureTicker(io);
  });
  socket.on('fps_move', (p: unknown) => {
    const b = body(p);
    world.move(socket.id, b.x, b.y, b.a, Date.now());
  });
  socket.on('fps_shoot', (p: unknown) => emit(io, world.shoot(socket.id, body(p).a, Date.now())));
  socket.on('fps_jump', () => emit(io, world.jump(socket.id, Date.now())));
  socket.on('fps_weapon', (p: unknown) => world.switchWeapon(socket.id, body(p).w, Date.now()));
  socket.on('fps_reload', () => world.reload(socket.id, Date.now()));
  socket.on('fps_scope', (p: unknown) => world.setScope(socket.id, body(p).on, Date.now()));
  socket.on('fps_leave', () => leave(io, socket));
  socket.on('disconnect', () => leave(io, socket));
}
