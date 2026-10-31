/**
 * Arena anti-cheat: server-side interest management (who may see whom) and per-player detection stats.
 * Flag only, never auto-ban. Thresholds are deliberately loose to keep false positives low.
 */
import { EYE_HEIGHT, HEAD_Z, lineOfSight, type ArenaMap } from '../shared/fps.js';

type Pos = { x: number; y: number; z: number };

/** Keep sending an enemy for this long after they were last visible, so they don't pop at corners. */
export const VIS_LINGER_MS = 600;
/** Always visible inside this range (footsteps, bumping into each other). */
export const VIS_NEAR = 2.5;
/** Peek grace: the viewer's eye is also tested this far to each side and up. */
export const VIS_PEEK = 0.5;
/** Grid that hidden shooters' positions are snapped to in shot events (enough for directional sound). */
export const COARSE_GRID = 4;

/** True if any of a few points on `t` (head, chest, edges, knees) is in sight of a few points around `v`'s eye. */
export function canSee(v: Pos, t: Pos, map: ArenaMap): boolean {
  const dx = t.x - v.x, dy = t.y - v.y;
  const d = Math.hypot(dx, dy);
  if (d < VIS_NEAR) return true;
  const px = -dy / d, py = dx / d; // perpendicular, horizontal
  const ez = v.z + EYE_HEIGHT;
  const eyes: Pos[] = [
    { x: v.x, y: v.y, z: ez },
    { x: v.x + px * VIS_PEEK, y: v.y + py * VIS_PEEK, z: ez },
    { x: v.x - px * VIS_PEEK, y: v.y - py * VIS_PEEK, z: ez },
    { x: v.x, y: v.y, z: ez + 0.3 },
  ];
  const pts: Pos[] = [
    { x: t.x, y: t.y, z: t.z + HEAD_Z },
    { x: t.x, y: t.y, z: t.z + 1.0 },
    { x: t.x + px * 0.4, y: t.y + py * 0.4, z: t.z + 1.0 },
    { x: t.x - px * 0.4, y: t.y - py * 0.4, z: t.z + 1.0 },
    { x: t.x, y: t.y, z: t.z + 0.35 },
  ];
  for (const e of eyes) for (const p of pts) if (lineOfSight(e, p, map)) return true;
  return false;
}

/** Remembers when each viewer last saw each target, for the linger window. */
export class VisibilityTracker {
  private seen = new Map<string, Map<string, number>>();
  /** Ids of fighters `viewerId` may receive full state for at `now`. */
  visible(viewerId: string, viewer: Pos, others: Array<Pos & { id: string }>, map: ArenaMap, now: number): Set<string> {
    let m = this.seen.get(viewerId);
    if (!m) { m = new Map(); this.seen.set(viewerId, m); }
    const out = new Set<string>([viewerId]);
    for (const o of others) {
      if (o.id === viewerId) continue;
      if (canSee(viewer, o, map)) { m.set(o.id, now); out.add(o.id); continue; }
      const last = m.get(o.id);
      if (last !== undefined && now - last <= VIS_LINGER_MS) out.add(o.id);
    }
    return out;
  }
  forget(id: string): void {
    this.seen.delete(id);
    for (const m of this.seen.values()) m.delete(id);
  }
}

export const coarse = (v: number) => Math.round(v / COARSE_GRID) * COARSE_GRID;

// ------------------------------------------------------------------ detection

export interface ArenaFlag { playerKey: string; name: string; reason: string; details: Record<string, unknown> }

export const FLICK_DEG = 45;
export const FLICK_MS = 80;
export const FLAG_COOLDOWN_MS = 10 * 60_000;
/** Thresholds. A flag means "a human should look", never "ban". */
export const LIMITS = {
  accuracy: { minShots: 80, rate: 0.8 },
  headshots: { minHits: 25, rate: 0.65 },
  flick: { minFlickHits: 6, share: 0.3 },
  teleport: { count: 8, windowMs: 10_000 },
  throughWall: { count: 3 },
};

interface Stats {
  name: string; key: string;
  shots: number; hits: number; heads: number; flicks: number; flickHits: number; blocked: number;
  tele: number[]; aim: { a: number; p: number; t: number } | null; flagged: Map<string, number>;
}

const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };

export class ArenaAntiCheat {
  private s = new Map<string, Stats>();
  constructor(private sink: (f: ArenaFlag) => void, private keyFor: (id: string, name: string) => string | null) {}

  join(id: string, name: string): void {
    const key = this.keyFor(id, name);
    if (!key) return; // bots are never tracked
    this.s.set(id, { name, key, shots: 0, hits: 0, heads: 0, flicks: 0, flickHits: 0, blocked: 0, tele: [], aim: null, flagged: new Map() });
  }
  leave(id: string): void { this.s.delete(id); }
  stats(id: string) { const s = this.s.get(id); return s && { shots: s.shots, hits: s.hits, heads: s.heads, flicks: s.flicks, flickHits: s.flickHits, blocked: s.blocked }; }

  private flag(s: Stats, reason: string, now: number, details: Record<string, unknown>): void {
    const last = s.flagged.get(reason);
    if (last !== undefined && now - last < FLAG_COOLDOWN_MS) return;
    s.flagged.set(reason, now);
    this.sink({ playerKey: s.key, name: s.name, reason, details: { ...details, shots: s.shots, hits: s.hits, heads: s.heads, flickHits: s.flickHits } });
  }

  /** Position report: `asked` is how far the client tried to move, `allowed` the speed cap for that interval. */
  move(id: string, asked: number, allowed: number, now: number): void {
    const s = this.s.get(id);
    if (!s) return;
    if (asked > allowed * 2 + 1) {
      s.tele = s.tele.filter((t) => now - t < LIMITS.teleport.windowMs);
      s.tele.push(now);
      if (s.tele.length >= LIMITS.teleport.count) this.flag(s, 'teleport', now, { asked: +asked.toFixed(2), allowed: +allowed.toFixed(2), inWindow: s.tele.length });
    }
  }

  /** View angle report. Returns the flick size (radians) if this is a fast snap. */
  aim(id: string, a: number, p: number, now: number): number {
    const s = this.s.get(id);
    if (!s) return 0;
    const prev = s.aim;
    s.aim = { a, p, t: now };
    if (!prev) return 0;
    const d = Math.hypot(angDiff(a, prev.a), p - prev.p);
    return d * 180 / Math.PI >= FLICK_DEG && now - prev.t <= FLICK_MS ? d : 0;
  }

  /** One trigger pull. `precise` = single-bullet hitscan weapon (accuracy only counts these). */
  shot(id: string, now: number, r: { precise: boolean; hit: boolean; head: boolean; flick: number; blocked: number; weapon: string }): void {
    const s = this.s.get(id);
    if (!s) return;
    if (r.precise) { s.shots += 1; if (r.hit) s.hits += 1; if (r.hit && r.head) s.heads += 1; }
    if (r.flick) { s.flicks += 1; if (r.hit) s.flickHits += 1; }
    s.blocked += r.blocked;
    const L = LIMITS;
    if (s.shots >= L.accuracy.minShots && s.hits / s.shots >= L.accuracy.rate) this.flag(s, 'accuracy', now, { rate: +(s.hits / s.shots).toFixed(3) });
    if (s.hits >= L.headshots.minHits && s.heads / s.hits >= L.headshots.rate) this.flag(s, 'headshots', now, { rate: +(s.heads / s.hits).toFixed(3) });
    if (s.flickHits >= L.flick.minFlickHits && s.flickHits / Math.max(1, s.hits) >= L.flick.share) this.flag(s, 'flick_snap', now, { lastFlickDeg: Math.round(r.flick * 180 / Math.PI), weapon: r.weapon });
    if (r.blocked && s.blocked >= L.throughWall.count) this.flag(s, 'through_wall', now, { blocked: s.blocked, weapon: r.weapon });
  }
}

// ------------------------------------------------------------------ storage

export const FLAGS_MIGRATION = `CREATE TABLE IF NOT EXISTS arena_flags (
  id BIGSERIAL PRIMARY KEY,
  player_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

type Q = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
let db: Q | null = null;
export function attachFlagStore(q: Q | null): void { db = q; }

/** Default sink: log it and write it to arena_flags (if Postgres is attached). Never throws. */
export function recordFlag(f: ArenaFlag): void {
  console.warn(`[arena-flag] ${f.playerKey} ${f.reason} ${JSON.stringify(f.details)}`);
  if (!db) return;
  db.query('INSERT INTO arena_flags (player_key, reason, details) VALUES ($1,$2,$3)', [f.playerKey, f.reason, JSON.stringify({ name: f.name, ...f.details })])
    .catch((e: Error) => console.error('[arena-flag] save failed:', e.message));
}

// ------------------------------------------------------------------ owner-granted perks

export type ArenaPerk = 'wallhack' | 'aimassist' | 'homingRpg';
/** Server-side only; the client is told the result but can never grant itself anything. Keyed by account key. */
export const ARENA_PERKS: Readonly<Record<string, readonly ArenaPerk[]>> = Object.freeze({ arenagawd: Object.freeze(['wallhack', 'aimassist', 'homingRpg'] as const) });
export const perksFor = (accountKey: string | null | undefined): ReadonlySet<ArenaPerk> =>
  new Set(accountKey ? ARENA_PERKS[accountKey.trim().toLowerCase()] ?? [] : []);

/** Aim assist cone (half-angle) and how far toward the target the shot is pulled (not an instant snap). */
export const ASSIST_CONE = (12 * Math.PI) / 180;
export const ASSIST_PULL = 0.85;
export const ASSIST_SPREAD = 0.4;

/** Heat-seeking RPG: lock cone (half-angle) and max turn rate. Same speed and splash as a normal rocket. */
export const HOMING_CONE = (25 * Math.PI) / 180;
export const HOMING_TURN = (120 * Math.PI) / 180; // rad/s
