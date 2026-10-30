import type { Server, Socket } from 'socket.io';
import { guestName, TICK_HZ } from '../shared/fps.js';
import { ArenaWorld, type ArenaEvent } from './arena-world.js';

const ROOM = '__fps_arena';
const MAX_PLAYERS = 24;
let world = new ArenaWorld();
let ticker: ReturnType<typeof setInterval> | null = null;

export function resetArena(): void {
  world = new ArenaWorld();
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function emit(io: Server, events: ArenaEvent[]): void {
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
      world.join(socket.id, (socket.data.account as { name?: string } | undefined)?.name ?? guestName(), Date.now());
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
