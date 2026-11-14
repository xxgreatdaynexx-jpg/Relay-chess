/**
 * Public launch "show": when a player rolls a rocket out, every online player sees it lift off from the
 * Space Center pad on the city map. The server broadcasts one small event per launch; each client plays a
 * deterministic animation from the liftoff time, so a late joiner sees the rest of the flight in the same
 * place. Purely cosmetic: nothing here touches chips, contracts or the flight sim.
 */
import type { VesselDesign } from './spaceParts.js';
import { PART_BY_ID } from './spaceParts.js';
import { analyzeDesign } from './spaceFlight.js';

export type LaunchSize = 'small' | 'medium' | 'heavy';

export interface LaunchShow {
  id: string;
  player: string;
  design: string;
  size: LaunchSize;
  /** Strap-on boosters that separate during the climb. */
  boosters: boolean;
  /** Liftoff time (server epoch ms). The pad countdown runs in the COUNTDOWN_MS before it. */
  at: number;
}

/** Matches the launching player's own 5-second Mission Control countdown. */
export const SHOW_COUNTDOWN_MS = 5_000;
/** Powered climb shown in the sky; by the end the rocket is a dot far downrange. */
export const SHOW_FLIGHT_S = 60;
/** The exhaust trail lingers and drifts after the rocket has gone. */
export const SHOW_LINGER_S = 40;
/** Whole show window from liftoff (ms). */
export const SHOW_END_MS = (SHOW_FLIGHT_S + SHOW_LINGER_S) * 1000;
/** Booster separation time (s after liftoff) for designs with boosters. */
export const SHOW_SEP_S = 20;
/** At most this many shows play at once; extra launches still fly, they just skip the city broadcast. */
export const SHOW_MAX_ACTIVE = 4;
/** Late joiners get a toast only if they arrive within this long of liftoff. */
export const SHOW_TOAST_FRESH_MS = 20_000;

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Size class and booster flag from a validated design (wet mass at liftoff). */
export function classifyLaunch(design: VesselDesign): { size: LaunchSize; boosters: boolean } {
  const st = analyzeDesign(design);
  const m = st.wetMass;
  const size: LaunchSize = m >= 60_000 ? 'heavy' : m >= 12_000 ? 'medium' : 'small';
  const boosters = design.parts.some((p) => p.radial && PART_BY_ID.get(p.partId)?.category === 'srb');
  return { size, boosters };
}

export function makeLaunchShow(id: string, player: string, design: VesselDesign, launchedAt: number): LaunchShow {
  const { size, boosters } = classifyLaunch(design);
  return { id, player: clean(player, 24) || 'A pilot', design: clean(design.name, 40) || 'Rocket', size, boosters, at: launchedAt + SHOW_COUNTDOWN_MS };
}

/** Strict parse of a broadcast payload (clients never trust the socket shape). */
export function parseLaunchShow(raw: unknown): LaunchShow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const size = r.size === 'small' || r.size === 'medium' || r.size === 'heavy' ? r.size : null;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 64 || !size || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return { id: r.id, player: clean(r.player, 24) || 'A pilot', design: clean(r.design, 40) || 'Rocket', size, boosters: r.boosters === true, at: r.at };
}

/** Shows still worth drawing at `now` (countdown, flight, or lingering trail). */
export const showActive = (s: LaunchShow, now: number) => now >= s.at - SHOW_COUNTDOWN_MS && now < s.at + SHOW_END_MS;

export interface ShowPose {
  /** Metres-ish world units from the pad base: east/downrange along the heading, and up. */
  down: number;
  up: number;
  /** Pitch from vertical (radians). */
  pitch: number;
  /** Speed (world units / s). */
  speed: number;
  /** Engines lit. */
  burning: boolean;
}

const ACCEL: Record<LaunchSize, number> = { small: 1.8, medium: 1.3, heavy: 1.05 };
const DT = 0.1;
const tables = new Map<LaunchSize, Float32Array>();

/** Gravity turn: straight up for 5 s, then pitch over smoothly towards ~68° by 45 s while accelerating. */
function table(size: LaunchSize): Float32Array {
  let t = tables.get(size);
  if (t) return t;
  const n = Math.ceil(SHOW_FLIGHT_S / DT) + 1;
  t = new Float32Array(n * 4);
  const A = ACCEL[size];
  let down = 0, up = 0;
  for (let i = 0; i < n; i++) {
    const s = i * DT;
    const v = A * (s + (s * s) / 36);
    const k = Math.min(1, Math.max(0, (s - 5) / 40));
    const pitch = (68 * Math.PI / 180) * k * k * (3 - 2 * k);
    t[i * 4] = down; t[i * 4 + 1] = up; t[i * 4 + 2] = pitch; t[i * 4 + 3] = v;
    down += v * Math.sin(pitch) * DT;
    up += v * Math.cos(pitch) * DT;
  }
  tables.set(size, t);
  return t;
}

/** Deterministic pose `ts` seconds after liftoff (clamped to the flight window; before liftoff = on the pad). */
export function showPose(size: LaunchSize, ts: number): ShowPose {
  if (ts <= 0) return { down: 0, up: 0, pitch: 0, speed: 0, burning: false };
  const t = table(size);
  const n = t.length / 4;
  const f = Math.min(ts, SHOW_FLIGHT_S) / DT;
  const i = Math.min(n - 2, Math.floor(f));
  const a = f - i;
  const L = (j: number) => t[i * 4 + j]! + (t[(i + 1) * 4 + j]! - t[i * 4 + j]!) * a;
  const extra = ts > SHOW_FLIGHT_S ? ts - SHOW_FLIGHT_S : 0;
  const pitch = L(2), speed = L(3);
  return { down: L(0) + speed * Math.sin(pitch) * extra, up: L(1) + speed * Math.cos(pitch) * extra, pitch, speed, burning: ts < SHOW_FLIGHT_S };
}

/** Small integer hash -> [0, 1) for deterministic per-show / per-particle jitter. */
export function hash01(seed: string | number, i = 0): number {
  let h = 2166136261 ^ i;
  const s = String(seed);
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
