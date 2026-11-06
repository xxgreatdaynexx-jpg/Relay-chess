/**
 * Town Hall protest crowd — cosmetic milling NPCs outside City Hall (Millionaire Update launch).
 * Pure sim (no Three.js) so movement / zone / reduced-motion can be unit-tested.
 * Layout influenced by aerial crowd references under /workspace/bugs/townhall-protesters/references
 * (organic clusters, clear entrance aisle, placards at mixed heights) — slogans are fictional in-game only.
 */

/** Front-plaza local box on the cityhall group (group already rotated to face its street). */
export const PROTEST_ZONE = { lx0: -4.3, lx1: 4.3, lz0: 5.15, lz1: 8.85 } as const;
/** Keep the walk-up to the doors mostly clear (matches aerial buffer / doorway clearance). */
export const ENTRANCE_AISLE = 0.95;
export const PROTEST_COUNT_DEFAULT = 12;
export const PROTEST_COUNT_LOW = 8;
export const MIN_SEP = 0.72;
export const BUBBLE_MS = 2.4;
export const CHANT_SLOGANS = ['No Carter!', 'Vote for change!', 'Fair city!', 'New mayor!'] as const;

export const SHIRT_COLORS = [0x2a3344, 0xc45a3a, 0x3a6ea5, 0xe8e2d4, 0x1f1f24, 0x5a8f4a, 0x8b4513, 0xd4a017] as const;

export interface ProtesterState {
  id: number;
  lx: number;
  lz: number;
  yaw: number;
  phase: number;
  speed: number;
  targetLx: number;
  targetLz: number;
  wave: number;
  shirt: number;
  hasSign: boolean;
  slogan: string;
  /** Sim-time when the speech bubble should hide. */
  bubbleUntil: number;
  nextRetarget: number;
  nextBubble: number;
  /** Side cluster bias (−1 / +1) so density thins at aisle and edges (aerial clustering). */
  side: number;
}

export interface ProtestZone { lx0: number; lx1: number; lz0: number; lz1: number }
export interface StepOpts {
  reducedMotion: boolean;
  /** When false, skip bubble scheduling (e.g. camera far). Default true. */
  allowBubbles?: boolean;
  /** Optional local milling bounds (defaults to City Hall PROTEST_ZONE). */
  zone?: ProtestZone;
  /** Soft aisle half-width to keep clear inside zone (0 = none). */
  aisle?: number;
  /** Reject local (lx,lz) samples (e.g. keep farm clusters off crop pads). */
  reject?: (lx: number, lz: number) => boolean;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Pick a plaza point biased into a side cluster, avoiding the entrance aisle when possible. */
export function pickPlazaPoint(rand: () => number, side: number): { lx: number; lz: number } {
  const { lx0, lx1, lz0, lz1 } = PROTEST_ZONE;
  for (let attempt = 0; attempt < 12; attempt++) {
    const band = side >= 0 ? [ENTRANCE_AISLE + 0.15, lx1] : [lx0, -ENTRANCE_AISLE - 0.15];
    const lx = band[0] + rand() * (band[1] - band[0]);
    // denser nearer the building (smaller lz), thinner toward the road edge
    const u = rand();
    const lz = lz0 + (lz1 - lz0) * (u * u * 0.55 + rand() * 0.45);
    if (Math.abs(lx) >= ENTRANCE_AISLE * 0.85) return { lx, lz };
  }
  return { lx: side * (ENTRANCE_AISLE + 0.8 + rand() * 2.2), lz: lz0 + 0.6 + rand() * 2.2 };
}

export function inProtestZone(lx: number, lz: number, pad = 0): boolean {
  const { lx0, lx1, lz0, lz1 } = PROTEST_ZONE;
  return lx >= lx0 - pad && lx <= lx1 + pad && lz >= lz0 - pad && lz <= lz1 + pad;
}

/** World XZ from cityhall landmark OBB + local plaza coords. */
export function protestWorldXZ(hallX: number, hallZ: number, hallRot: number, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(hallRot), s = Math.sin(hallRot);
  return { x: hallX + lx * c + lz * s, z: hallZ - lx * s + lz * c };
}

export function spawnProtesters(seed = 42, count = PROTEST_COUNT_DEFAULT): ProtesterState[] {
  const rand = mulberry(seed);
  const n = Math.max(4, Math.min(18, count | 0));
  const out: ProtesterState[] = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const p = pickPlazaPoint(rand, side);
    // soft separation at spawn
    for (const o of out) {
      const dx = p.lx - o.lx, dz = p.lz - o.lz;
      const d = Math.hypot(dx, dz);
      if (d < MIN_SEP && d > 1e-4) {
        p.lx += (dx / d) * (MIN_SEP - d);
        p.lz += (dz / d) * (MIN_SEP - d) * 0.5;
      }
    }
    p.lx = clamp(p.lx, PROTEST_ZONE.lx0, PROTEST_ZONE.lx1);
    p.lz = clamp(p.lz, PROTEST_ZONE.lz0, PROTEST_ZONE.lz1);
    if (Math.abs(p.lx) < ENTRANCE_AISLE) p.lx = Math.sign(p.lx || side) * ENTRANCE_AISLE;
    const tgt = pickPlazaPoint(rand, side);
    const slogan = CHANT_SLOGANS[i % CHANT_SLOGANS.length]!;
    out.push({
      id: i,
      lx: p.lx,
      lz: p.lz,
      yaw: Math.atan2(tgt.lx - p.lx, tgt.lz - p.lz) + (rand() - 0.5) * 0.4,
      phase: rand() * Math.PI * 2,
      speed: 0.55 + rand() * 0.85,
      targetLx: tgt.lx,
      targetLz: tgt.lz,
      wave: 0.35 + rand() * 0.55,
      shirt: i % SHIRT_COLORS.length,
      hasSign: rand() > 0.28,
      slogan,
      bubbleUntil: -1,
      nextRetarget: 1.2 + rand() * 3.5 + i * 0.17,
      nextBubble: 2.5 + rand() * 6 + i * 0.41,
      side,
    });
  }
  return out;
}

function separate(list: ProtesterState[], zone: ProtestZone, aisle: number): void {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const dx = a.lx - b.lx, dz = a.lz - b.lz;
      const d = Math.hypot(dx, dz);
      if (d >= MIN_SEP || d < 1e-5) continue;
      const push = (MIN_SEP - d) * 0.5;
      const nx = dx / d, nz = dz / d;
      a.lx += nx * push; a.lz += nz * push;
      b.lx -= nx * push; b.lz -= nz * push;
    }
  }
  for (const p of list) {
    p.lx = clamp(p.lx, zone.lx0, zone.lx1);
    p.lz = clamp(p.lz, zone.lz0, zone.lz1);
    if (aisle > 0 && Math.abs(p.lx) < aisle * 0.55) p.lx = Math.sign(p.lx || p.side) * aisle * 0.55;
  }
}

/**
 * Advance milling / waving / bubble timers.
 * Reduced motion: freeze travel; keep a gentle sign bob only (no pathing, no new bubbles).
 */
export function stepProtesters(list: ProtesterState[], dt: number, t: number, opts: StepOpts): void {
  const allowBubbles = opts.allowBubbles !== false;
  const zone = opts.zone ?? PROTEST_ZONE;
  const aisle = opts.aisle ?? (opts.zone ? 0 : ENTRANCE_AISLE);
  if (opts.reducedMotion) {
    for (const p of list) {
      p.wave = 0.55 + Math.sin(t * 0.7 + p.phase) * 0.04;
      p.bubbleUntil = -1;
    }
    return;
  }
  const rand = mulberry((((t * 1000) | 0) ^ (list.length * 9973)) >>> 0);
  const pickInZone = (side: number) => {
    if (!opts.zone) return pickPlazaPoint(rand, side);
    // farm / custom zone: stay in box, soft bias away from centre aisle if any
    for (let k = 0; k < 16; k++) {
      const lx = zone.lx0 + rand() * (zone.lx1 - zone.lx0);
      const lz = zone.lz0 + rand() * (zone.lz1 - zone.lz0);
      if (aisle > 0 && Math.abs(lx) < aisle * 0.85) continue;
      if (opts.reject?.(lx, lz)) continue;
      return { lx, lz };
    }
    // fallback: keep current-ish edge sample
    return { lx: side * Math.max(aisle, Math.abs(zone.lx0), Math.abs(zone.lx1)) * 0.5, lz: (zone.lz0 + zone.lz1) / 2 };
  };
  for (const p of list) {
    const dx = p.targetLx - p.lx, dz = p.targetLz - p.lz;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.08) {
      const step = Math.min(dist, p.speed * dt);
      p.lx += (dx / dist) * step;
      p.lz += (dz / dist) * step;
      const want = Math.atan2(dx, dz);
      let dy = want - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += clamp(dy, -2.2 * dt, 2.2 * dt);
    }
    p.wave = 0.4 + 0.55 * (0.5 + 0.5 * Math.sin(t * (1.1 + p.speed * 0.35) + p.phase));

    if (t >= p.nextRetarget || dist < 0.12) {
      const tgt = pickInZone(p.side);
      p.targetLx = tgt.lx;
      p.targetLz = tgt.lz;
      p.nextRetarget = t + 1.4 + rand() * 4.2 + (p.id % 5) * 0.13;
      p.speed = 0.5 + rand() * 0.95;
    }
    if (allowBubbles && t >= p.nextBubble) {
      p.bubbleUntil = t + BUBBLE_MS;
      p.slogan = CHANT_SLOGANS[(p.id + ((t * 3) | 0)) % CHANT_SLOGANS.length]!;
      p.nextBubble = t + BUBBLE_MS + 3.5 + rand() * 8 + (p.id % 7) * 0.37;
    }
  }
  separate(list, zone, aisle);
  if (opts.reject) {
    for (const p of list) {
      if (!opts.reject(p.lx, p.lz)) continue;
      // nudge outward from zone centre
      const cx = (zone.lx0 + zone.lx1) / 2, cz = (zone.lz0 + zone.lz1) / 2;
      let dx = p.lx - cx, dz = p.lz - cz;
      const d = Math.hypot(dx, dz) || 1;
      for (let k = 0; k < 6 && opts.reject(p.lx, p.lz); k++) {
        p.lx += (dx / d) * 0.35;
        p.lz += (dz / d) * 0.35;
        p.lx = clamp(p.lx, zone.lx0, zone.lx1);
        p.lz = clamp(p.lz, zone.lz0, zone.lz1);
      }
    }
  }
}

/** Cap how many protesters we animate when the camera is mid-range (perf). */
export function protestUpdateBudget(camDist: number, lowDetail: boolean): { step: boolean; bubbles: boolean; count: number } {
  if (camDist > 95) return { step: false, bubbles: false, count: 0 };
  if (camDist > 55) return { step: true, bubbles: false, count: lowDetail ? PROTEST_COUNT_LOW : PROTEST_COUNT_DEFAULT };
  return { step: true, bubbles: true, count: lowDetail ? PROTEST_COUNT_LOW : PROTEST_COUNT_DEFAULT };
}
