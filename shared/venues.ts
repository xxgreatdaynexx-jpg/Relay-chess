/**
 * Outskirts venues: the Airport (west, between the plate's south-west shore road and the industrial yard) and the Racetrack (north-west, between The Mine and
 * Frostbite Caverns). Both are off the city plate and reached by their own paved access roads.
 * Pure geometry + race rules (no three.js) so the server can time laps from the same shapes the client draws.
 */
import { PLATE, shoreZ, type OBB } from './worldLayout.js';
import { EXPANSION_ROADS, EXPANSION_ROAD_W, inExpansion } from './mapExpansion.js';

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export const inRect = (r: Rect, x: number, z: number, m = 0) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;

// ---- Airport (west) ----
export const AIRPORT: Rect = { x0: -280, x1: -126, z0: -4, z1: 146 }; // = RESERVED_VENUES.airport (worldLayout)
export const RUNWAY = { x: -200, z0: 6, z1: 136, w: 10 };
/** Second parallel runway (international expansion). The original runway is unchanged. */
export const RUNWAY2 = { x: -252, z0: 6, z1: 136, w: 10 };
/** Terminal landmark pad centre (the 'airport' world spot). */
export const AIRPORT_SLOT: [number, number] = [-142, 66];
/** Paved roads: [from, to, width]. The access road continues the west shore road (shore-w) off the plate; the last is the taxiway. */
export const AIRPORT_ROADS: Array<[[number, number], [number, number], number]> = [
  [[-PLATE + 1, 66], [AIRPORT_SLOT[0] + 8, AIRPORT_SLOT[1]], 5.5], [[AIRPORT_SLOT[0] - 8, AIRPORT_SLOT[1]], [RUNWAY.x + RUNWAY.w / 2, AIRPORT_SLOT[1]], 4.5],
];

// ---- Racetrack (north-west) ----
/** Stadium oval: two straights (half-length L) joined by semicircles (radius R) around C; W wide. */
export const TRACK = { cx: -103, cz: -169, L: 40, R: 24, W: 10 };
export const RACETRACK: Rect = { x0: TRACK.cx - TRACK.L - TRACK.R - 10, x1: TRACK.cx + TRACK.L + TRACK.R + 10, z0: TRACK.cz - TRACK.R - 12, z1: TRACK.cz + TRACK.R + 12 }; // inside RESERVED_VENUES.racetrack
/** Grandstand / pit building in the infield (the 'racetrack' world spot). */
export const RACETRACK_SLOT: [number, number] = [TRACK.cx, TRACK.cz];
/** Access road: the north-south boulevard runs straight on north to the outskirts' north road (z = -PLATE - 8), west
 * along it, then north up to the oval's bottom straight (ends at the track edge; never crosses the track). */
export const NORTH_ROAD_Z = -PLATE - 8;
export const RACETRACK_ROADS: Array<[[number, number], [number, number], number]> = [
  [[0, -PLATE + 1], [0, NORTH_ROAD_Z], 5.5], [[0, NORTH_ROAD_Z], [-80, NORTH_ROAD_Z], 5.5], [[-80, NORTH_ROAD_Z], [-80, TRACK.cz + TRACK.R + TRACK.W / 2], 5.5],
];
export const TRACK_LEN = 4 * TRACK.L + 2 * Math.PI * TRACK.R;

/** Distance from (x, z) to the track centreline. */
export function trackDist(x: number, z: number): number {
  const dx = Math.abs(x - TRACK.cx) - TRACK.L, dz = z - TRACK.cz;
  return dx <= 0 ? Math.abs(Math.abs(dz) - TRACK.R) : Math.abs(Math.hypot(dx, dz) - TRACK.R);
}
/** Centreline point at fraction u of a lap (u=0: start line, heading +x along the south straight). Returns [x, z, heading]. */
export function trackPoint(u: number): [number, number, number] {
  const { cx, cz, L, R } = TRACK; let s = (((u % 1) + 1) % 1) * TRACK_LEN; const arc = Math.PI * R;
  if (s < L) return [cx + s, cz + R, 0]; s -= L;
  if (s < arc) { const t = s / R; return [cx + L + Math.sin(t) * R, cz + Math.cos(t) * R, -t]; } s -= arc;
  if (s < 2 * L) return [cx + L - s, cz - R, Math.PI]; s -= 2 * L;
  if (s < arc) { const t = s / R; return [cx - L - Math.sin(t) * R, cz - Math.cos(t) * R, Math.PI - t]; } s -= arc;
  return [cx - L + s, cz + R, 0];
}
/** Timing gates in lap order: start/finish, east hairpin, back straight, west hairpin. Each is a line across the track. */
export const GATES: Array<[[number, number], [number, number]]> = [0, 0.25, 0.5, 0.75].map((u) => {
  // u in "quarter of a lap" terms: map to the start, east apex, back-straight middle, west apex.
  const pts: Record<number, [number, number, number]> = { 0: [TRACK.cx, TRACK.cz + TRACK.R, 0], 0.25: [TRACK.cx + TRACK.L + TRACK.R, TRACK.cz, -Math.PI / 2], 0.5: [TRACK.cx, TRACK.cz - TRACK.R, Math.PI], 0.75: [TRACK.cx - TRACK.L - TRACK.R, TRACK.cz, Math.PI / 2] };
  const [x, z, a] = pts[u]!; const h = TRACK.W / 2 + 3; const nx = -Math.sin(a), nz = Math.cos(a);
  return [[x - nx * h, z - nz * h], [x + nx * h, z + nz * h]];
});
export const OFF_TRACK = TRACK.W / 2 + 2.5; // further than this from the centreline mid-lap voids the lap

// ---- Driving surface ----
const onSeg = (x: number, z: number, a: [number, number], b: [number, number], hw: number) => {
  const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) <= hw;
};
/** Paved venue surface (runway, apron roads, the track): full speed there. */
export function onVenueRoad(x: number, z: number): boolean {
  if (Math.abs(x - RUNWAY.x) <= RUNWAY.w / 2 && z >= RUNWAY.z0 && z <= RUNWAY.z1) return true;
  if (Math.abs(x - RUNWAY2.x) <= RUNWAY2.w / 2 && z >= RUNWAY2.z0 && z <= RUNWAY2.z1) return true;
  if (trackDist(x, z) <= TRACK.W / 2) return true;
  return [...AIRPORT_ROADS, ...RACETRACK_ROADS].some(([a, b, w]) => onSeg(x, z, a, b, w / 2));
}
/** Can a car be here at all (city plate on land, or inside a venue's grounds)? m = margin. */
export function drivable(x: number, z: number, m = 0): boolean {
  if (Math.abs(x) <= PLATE - m && Math.abs(z) <= PLATE - m && z < shoreZ(x) - m) return true;
  if (inExpansion(x, z) && m <= 0) return true;
  if (EXPANSION_ROADS.some(([a, b]) => onSeg(x, z, a, b, EXPANSION_ROAD_W / 2 + Math.max(0, -m)))) return true;
  return inRect(AIRPORT, x, z, m) || inRect(RACETRACK, x, z, m) || onVenueRoad(x, z);
}
/** Map extents the venues add (for the camera pan clamp and the server's drive bounds). */
export const VENUE_BOUNDS = { x0: Math.min(AIRPORT.x0, RACETRACK.x0), x1: Math.max(AIRPORT.x1, RACETRACK.x1), z0: Math.min(AIRPORT.z0, RACETRACK.z0), z1: Math.max(AIRPORT.z1, RACETRACK.z1) };

// ---- Fast travel ----
export type FlyDest = 'racetrack' | 'downtown' | 'airport';
export const FLY_DEST: Record<FlyDest, { label: string; x: number; z: number; a: number }> = {
  airport: { label: 'Airport', x: -131, z: 66, a: Math.PI },
  racetrack: { label: 'the Speedway', x: TRACK.cx - 12, z: TRACK.cz + TRACK.R, a: 0 },
  downtown: { label: 'Downtown', x: 0, z: 10, a: Math.PI / 2 },
};
export const FLY_FROM_R = 40; // must be this close to the terminal to take off
export const nearAirport = (x: number, z: number) => Math.hypot(x - AIRPORT_SLOT[0], z - AIRPORT_SLOT[1]) <= FLY_FROM_R || inRect(AIRPORT, x, z);

// ---- Daily Cup (entry fee + prize pool) ----
export const RACE_ENTRY_BASE = 250; // chips, through px()
export const RACE_SEED_BASE = 2000; // house adds this to every day's pool, through px()
export const RACE_SPLIT = [0.5, 0.3, 0.2];
export const MIN_LAP_MS = 4000;
/** Longest gap between accepted poses (ms) during a timed lap before it is voided (driving sends 8 Hz; generous for mobile jitter, the midpoint check below still catches infield shortcuts). */
export const LAP_MAX_GAP_MS = 1500;

/** Pure lap timer fed with accepted poses (server-side). */
export interface LapEvent { kind: 'start' | 'gate' | 'lap' | 'void'; ms?: number; gate?: number; why?: string }
function cross(p: [number, number], q: [number, number], a: [number, number], b: [number, number]): number | null {
  const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]]; const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den, u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
/** Which way a gate must be crossed (along the racing direction). */
const GATE_DIR: Array<[number, number]> = [[1, 0], [0, -1], [-1, 0], [0, 1]];
export class LapTimer {
  private last: { x: number; z: number; t: number } | null = null;
  private next = -1; // -1: not on a lap yet (waiting for the start line); else the gate index expected next
  private lapStart = 0;
  /** `minMs`: fastest believable lap for this car (server anti-cheat, racePhysics.minLapMs); quicker laps are voided. */
  constructor(private readonly opts: { minMs?: number } = {}) {}
  feed(x: number, z: number, t: number): LapEvent[] {
    const out: LapEvent[] = []; const prev = this.last; this.last = { x, z, t };
    if (!prev) return out;
    if (this.next >= 0 && trackDist(x, z) > OFF_TRACK) { this.next = -1; out.push({ kind: 'void', why: 'Off the track: lap void. Cross the start line to go again.' }); return out; }
    // Sparse poses could chord across the infield between two on-track points: void on a long gap or an off-track midpoint.
    if (this.next >= 0 && (t - prev.t > LAP_MAX_GAP_MS || trackDist((x + prev.x) / 2, (z + prev.z) / 2) > OFF_TRACK)) { this.next = -1; out.push({ kind: 'void', why: 'Lost track of your car (connection hiccup or a shortcut): lap void. Cross the start line to go again.' }); return out; }
    for (let g = 0; g < GATES.length; g++) {
      const f = cross([prev.x, prev.z], [x, z], GATES[g]![0], GATES[g]![1]); if (f == null) continue;
      const d = GATE_DIR[g]!; if ((x - prev.x) * d[0] + (z - prev.z) * d[1] <= 0) continue; // wrong way
      const at = prev.t + (t - prev.t) * f;
      if (g === 0) {
        if (this.next === 0) { const ms = Math.round(at - this.lapStart); if (ms >= Math.max(MIN_LAP_MS, this.opts.minMs ?? 0)) out.push({ kind: 'lap', ms }); else if (ms >= MIN_LAP_MS) out.push({ kind: 'void', why: 'Lap faster than your car can physically go: not counted.' }); }
        if (trackDist(x, z) <= OFF_TRACK) { this.next = 1; this.lapStart = at; out.push({ kind: 'start' }); }
      } else if (g === this.next) { this.next = g === 3 ? 0 : g + 1; out.push({ kind: 'gate', gate: g }); }
    }
    return out;
  }
  reset() { this.last = null; this.next = -1; }
}
export const fmtLap = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`;
export type { OBB };
