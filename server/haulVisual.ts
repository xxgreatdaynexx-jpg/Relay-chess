/**
 * Cosmetic haul truck broadcasts. Purely visual: rate-limited, merged, capped. Does not touch inventory.
 */
import type { Server, Socket } from 'socket.io';
import {
  HAUL_BG_GAP_MS, HAUL_MAX_VISIBLE, HAUL_MERGE_MS, HAUL_PER_PLAYER_PER_MIN,
  buildHaul, type HaulEvent, type HaulKind,
} from '../shared/haulVisual.js';

type Live = HaulEvent & { mergeKey: string };
const live = new Map<string, Live>();
const recentByPlayer = new Map<string, number[]>(); // timestamps
const bgLast = new Map<string, number>(); // name|kind → last bg emit
let ioRef: Server | null = null;
let seq = 0;

const playerKey = (n: string) => n.trim().toLowerCase();

function prune(now: number) {
  for (const [id, e] of live) if (e.arriveAt <= now) live.delete(id);
  for (const [k, ts] of recentByPlayer) {
    const keep = ts.filter((t) => now - t < 60_000);
    if (keep.length) recentByPlayer.set(k, keep); else recentByPlayer.delete(k);
  }
}

function allowPlayer(name: string, now: number): boolean {
  const k = playerKey(name); const ts = recentByPlayer.get(k) ?? [];
  const keep = ts.filter((t) => now - t < 60_000);
  if (keep.length >= HAUL_PER_PLAYER_PER_MIN) { recentByPlayer.set(k, keep); return false; }
  keep.push(now); recentByPlayer.set(k, keep); return true;
}

function publish(e: Live) {
  live.set(e.id, e);
  // Cap: drop oldest departing
  if (live.size > HAUL_MAX_VISIBLE) {
    const ordered = [...live.values()].sort((a, b) => a.departAt - b.departAt);
    while (live.size > HAUL_MAX_VISIBLE) { const drop = ordered.shift(); if (drop) live.delete(drop.id); }
  }
  ioRef?.to('freight').emit('haul_visual', snapshot());
}

function snapshot(): HaulEvent[] {
  const now = Date.now(); prune(now);
  return [...live.values()]
    .filter((e) => e.arriveAt > now)
    .sort((a, b) => a.departAt - b.departAt)
    .slice(0, HAUL_MAX_VISIBLE)
    .map(({ mergeKey: _m, ...e }) => e);
}

export function haulLive(): HaulEvent[] { return snapshot(); }

/**
 * Spawn a cosmetic truck. `background` applies the sweep throttle.
 * Returns the event if broadcast, null if skipped (same map only; unknown sites; rate limits).
 */
export function emitHaul(opts: {
  name: string; from: string; to: string; kind: HaulKind;
  background?: boolean; now?: number;
}): HaulEvent | null {
  const name = (opts.name || '').trim(); if (!name) return null;
  const now = opts.now ?? Date.now();
  prune(now);
  if (opts.background) {
    const bk = `${playerKey(name)}|${opts.kind}|${opts.from}|${opts.to}`;
    const last = bgLast.get(bk) ?? 0;
    if (now - last < HAUL_BG_GAP_MS) return null;
    bgLast.set(bk, now);
  }
  const mergeKey = `${playerKey(name)}|${opts.from}|${opts.to}|${opts.kind}`;
  // Merge bursts: refresh an in-flight twin
  for (const e of live.values()) {
    if (e.mergeKey === mergeKey && now - e.departAt < HAUL_MERGE_MS) {
      e.departAt = now; e.arriveAt = now + (e.arriveAt - e.departAt);
      publish(e); return e;
    }
  }
  if (!allowPlayer(name, now)) return null;
  const built = buildHaul(name, opts.from, opts.to, opts.kind, now, `h${(++seq).toString(36)}${now.toString(36)}`);
  if (!built) return null;
  const e: Live = { ...built, mergeKey };
  publish(e);
  return e;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function registerHaulVisual(io: Server, socket: Socket) {
  ioRef = io;
  if (!timer) {
    timer = setInterval(() => {
      const before = live.size; prune(Date.now());
      if (live.size !== before) io.to('freight').emit('haul_visual', snapshot());
    }, 5_000);
    timer.unref?.();
  }
  socket.on('haul_watch', (on: unknown) => {
    if (on === false) return;
    void socket.join('freight');
    socket.emit('haul_visual', snapshot());
  });
}
