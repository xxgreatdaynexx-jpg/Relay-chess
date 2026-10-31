// Client-side shot prediction for the Arena. The client shows tracers, impacts and the hit marker the
// instant it fires (raycast against the interpolated positions it is displaying); the server stays
// authoritative and confirms or denies each prediction by echoing the shot id (sid) in fps_shot.
import { fireWeapon, type Target, type WeaponSpec } from './fps.js';
import type { ArenaMap } from './arenaMaps.js';

export interface PredictedShot {
  rays: Array<{ a: number; p: number; dist: number; hit: boolean }>;
  hits: Map<string, number>;
  heads: Set<string>;
  dmg: number;
  head: boolean;
}

/** Centre-of-spread raycast (rand = 0.5 -> zero deviation) against what the shooter currently sees. */
export function predictShot(
  shooter: { id: string; x: number; y: number; z: number; a: number; p: number; crouch?: boolean },
  spec: WeaponSpec, targets: Target[], map: ArenaMap, scoped = false,
): PredictedShot {
  const r = fireWeapon(shooter, spec, targets, { scoped, rand: () => 0.5, map });
  let dmg = 0; for (const d of r.hits.values()) dmg += d;
  return { rays: r.rays.map((x) => ({ a: x.a, p: x.p, dist: x.dist, hit: !!x.hit })), hits: r.hits, heads: r.heads, dmg, head: r.heads.size > 0 };
}

export const PREDICT_TIMEOUT_MS = 1500;
export type Verdict = 'confirm' | 'deny' | 'late-hit' | 'miss';

/** Tracks in-flight predicted shots until the server's fps_shot echo (same sid) resolves them. */
export class ShotPredictor {
  private next = 1;
  private pending = new Map<number, { hit: boolean; head: boolean; at: number }>();
  newSid(): number { const s = this.next; this.next = (this.next % 0x7fffffff) + 1; return s; }
  add(sid: number, hit: boolean, head: boolean, now: number): void { this.pending.set(sid, { hit, head, at: now }); }
  has(sid: unknown): boolean { return typeof sid === 'number' && this.pending.has(sid); }
  /** Resolve against the server's verdict for that sid. */
  resolve(sid: unknown, serverHit: boolean): Verdict | null {
    if (typeof sid !== 'number') return null;
    const p = this.pending.get(sid);
    if (!p) return null;
    this.pending.delete(sid);
    if (p.hit) return serverHit ? 'confirm' : 'deny';
    return serverHit ? 'late-hit' : 'miss';
  }
  /** Drop shots the server never answered (e.g. rejected by cooldown); predicted hits count as denied. */
  expire(now: number): number[] {
    const denied: number[] = [];
    for (const [sid, p] of this.pending) if (now - p.at > PREDICT_TIMEOUT_MS) { this.pending.delete(sid); if (p.hit) denied.push(sid); }
    return denied;
  }
  get size(): number { return this.pending.size; }
}

/** Server-side: accept a client shot id only if it is a sane positive integer. */
export const cleanSid = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 0x7fffffff ? v : undefined);

/** How long a local fire/reload/switch owns ammo + reload state before snapshots may overwrite it. */
export const localGraceMs = (pingMs: number): number => Math.min(600, Math.max(250, pingMs + 150));
/**
 * Snapshots are ~RTT/2 + one tick stale: adopting their ammo/reload right after a local shot or reload start
 * makes the counter jump back and the reload anim flicker off. Keep local state inside the grace window.
 */
export function adoptServerAmmo(now: number, lastLocalAt: number, pingMs: number): boolean {
  return now - lastLocalAt >= localGraceMs(pingMs);
}

/** Client move packets: ~30 Hz (one per server tick), carrying the ~60 Hz aim samples in between. */
export const INPUT_SEND_MS = 32;
