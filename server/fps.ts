import type { Server, Socket } from 'socket.io';
import {
  applyDamage, DAMAGE, guestName, hitscan, MAX_HP, maybeRespawn, normAngle, pickSpawn,
  SHOT_COOLDOWN_MS, TICK_HZ, validateMove, type Fighter,
} from '../shared/fps.js';

const ROOM = '__fps_arena';
const MAX_PLAYERS = 24;
const fighters = new Map<string, Fighter>();
let ticker: ReturnType<typeof setInterval> | null = null;

export function resetArena(): void {
  fighters.clear();
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function cleanFpsName(input: unknown): string {
  if (typeof input !== 'string') return guestName();
  const name = input.replace(/\s+/g, ' ').trim().slice(0, 18);
  if (!name || !/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(name)) return guestName();
  return name;
}

function snapshot() {
  return {
    t: Date.now(),
    players: [...fighters.values()].map((f) => ({
      id: f.id, name: f.name, x: +f.x.toFixed(3), y: +f.y.toFixed(3), a: +f.a.toFixed(3),
      hp: f.hp, k: f.kills, d: f.deaths, alive: f.alive,
    })),
  };
}

function ensureTicker(io: Server): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!fighters.size) {
      if (ticker) clearInterval(ticker);
      ticker = null;
      return;
    }
    const now = Date.now();
    const all = [...fighters.values()];
    for (const f of all) maybeRespawn(f, now, all);
    io.to(ROOM).emit('fps_state', snapshot());
  }, Math.round(1000 / TICK_HZ));
  (ticker as unknown as { unref?: () => void }).unref?.();
}

function leave(io: Server, socket: Socket): void {
  if (!fighters.delete(socket.id)) return;
  socket.leave(ROOM);
  io.to(ROOM).emit('fps_state', snapshot());
}

export function registerFps(io: Server, socket: Socket): void {
  socket.on('fps_join', (payload: unknown, ack?: (res: unknown) => void) => {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    let f = fighters.get(socket.id);
    if (!f) {
      if (fighters.size >= MAX_PLAYERS) {
        ack?.({ ok: false, error: 'Arena is full, try again in a bit.' });
        return;
      }
      const [x, y] = pickSpawn([...fighters.values()]);
      const now = Date.now();
      f = { id: socket.id, name: cleanFpsName(body.name), x, y, a: Math.random() * Math.PI * 2, hp: MAX_HP, kills: 0, deaths: 0, alive: true, respawnAt: 0, lastShot: 0, lastMove: now };
      fighters.set(socket.id, f);
      socket.join(ROOM);
    }
    ack?.({ ok: true, id: socket.id, x: f.x, y: f.y, a: f.a });
    ensureTicker(io);
  });

  socket.on('fps_move', (payload: unknown) => {
    const f = fighters.get(socket.id);
    if (!f || !f.alive || !payload || typeof payload !== 'object') return;
    const body = payload as Record<string, unknown>;
    const now = Date.now();
    if (now - f.lastMove < 25) return; // ~40 Hz max
    const pos = validateMove(f, body.x, body.y, now - f.lastMove);
    f.lastMove = now;
    f.x = pos.x;
    f.y = pos.y;
    const a = normAngle(body.a);
    if (a !== null) f.a = a;
  });

  socket.on('fps_shoot', (payload: unknown) => {
    const f = fighters.get(socket.id);
    if (!f || !f.alive) return;
    const now = Date.now();
    if (now - f.lastShot < SHOT_COOLDOWN_MS) return;
    f.lastShot = now;
    const a = normAngle(payload && typeof payload === 'object' ? (payload as Record<string, unknown>).a : null);
    if (a !== null) f.a = a;
    io.to(ROOM).emit('fps_shot', { id: f.id });
    const hit = hitscan(f, [...fighters.values()]);
    if (!hit) return;
    const target = fighters.get(hit.id)!;
    const killed = applyDamage(target, now, DAMAGE);
    io.to(ROOM).emit('fps_hit', { by: f.id, target: target.id, hp: target.hp });
    if (killed) {
      f.kills += 1;
      io.to(ROOM).emit('fps_kill', { killer: f.name, victim: target.name, killerId: f.id, victimId: target.id });
    }
  });

  socket.on('fps_leave', () => leave(io, socket));
  socket.on('disconnect', () => leave(io, socket));
}
