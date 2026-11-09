/**
 * Cosmetic delivery trucks on the city map (pt2101u / queue #6). Pure rules: site → xz, road path,
 * travel time, caps. No inventory or economy. Worker hauls start at the job site (mine / quarry / dock),
 * not the Employment Office. Pantry harvests land in the Chud City Warehouse pool (not the factory).
 */
import { ROADS, LANDMARK_SLOTS, MINE_SITES, SPOT_POS, PLATE } from './worldLayout.js';
import { farmPlots, plotId } from './farm.js';

export const HAUL_MAX_VISIBLE = 50; // was 30; raised so longer trips (half speed) don't cull more aggressively
export const HAUL_MERGE_MS = 2_500;
export const HAUL_PER_PLAYER_PER_MIN = 12;
export const HAUL_BG_GAP_MS = 20_000; // throttle offline/background sweeps
export const HAUL_SPEED = 14; // world units / second along path (was 28; t2105u ~50% slower)
export const HAUL_MIN_MS = 8_000; // was 4_000 — short hops also take ~2×
export const HAUL_MAX_MS = 90_000; // was 45_000 — headroom so longest routes still finish at half speed
/** localStorage: set to '1' to hide cosmetic haul trucks. */
export const HAUL_OFF_KEY = 'chud-haul-trucks-off';

export type HaulKind =
  | 'farm-pantry' | 'farm-sell' | 'farm-factory'
  | 'worker-ore' | 'worker-fish'
  | 'factory-sell' | 'mine-sell'
  | 'grocery' | 'market' | 'warehouse' | 'depot' | 'freight-truck' | 'other';

export interface HaulEvent {
  id: string;
  name: string;
  from: [number, number];
  to: [number, number];
  path: [number, number][];
  departAt: number;
  arriveAt: number;
  kind: HaulKind;
}

const lm = (id: string): [number, number] | null => {
  const s = SPOT_POS[id] ?? LANDMARK_SLOTS[id];
  return s ? [s[0], s[1]] : null;
};

/** Resolve a logical site id to a city-map xz. Cross-map / unknown → null (caller skips). */
export function haulSiteXZ(site: string): [number, number] | null {
  if (!site) return null;
  if (site === 'factory') return lm('factory');
  if (site === 'warehouse' || site === 'resort') return lm('warehouse');
  if (site === 'market') return lm('market');
  if (site === 'grocery') return lm('grocery');
  if (site === 'dock' || site === 'cooler' || site === 'fishing:lake') return lm('dock');
  if (site === 'airport') return lm('airport');
  if (site === 'harbour' || site === 'harbor' || site === 'port') {
    const d = lm('dock'); return d ? [d[0], Math.min(d[1] + 40, PLATE - 4)] : lm('casino');
  }
  if (site.startsWith('mine:') || site.startsWith('mine-') || site === 'mine' || site === 'frost' || site === 'magma' || site === 'quarry') {
    const cave = site.startsWith('mine:') ? site.slice(5) : site.startsWith('mine-') ? site.slice(5) : site;
    const key = cave === 'mine' ? 'mine' : cave === 'frost' ? 'mine-frost' : cave === 'magma' ? 'mine-magma' : cave === 'quarry' ? 'mine-quarry' : `mine-${cave}`;
    const m = MINE_SITES[key] ?? MINE_SITES[cave];
    return m ? [m.x, m.z] : null;
  }
  if (site.startsWith('farm:') || site.startsWith('f:') || site.startsWith('cf:')) {
    const id = site.startsWith('farm:') ? site.slice(5) : site;
    if (id.startsWith('rf:')) return null; // resort map — skip (boats/planes cover cross-map)
    if (id.startsWith('f:')) {
      const n = Number(id.slice(2)); const p = farmPlots().find((x) => x.n === n);
      return p ? [p.x, p.z] : null;
    }
    if (id.startsWith('cf:')) {
      // Country / Big Farms: approximate east farm district centre (exact field varies by seed).
      return [PLATE + 40, -40];
    }
  }
  // Direct "x,z"
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(site);
  if (m) return [Number(m[1]), Number(m[2])];
  return lm(site);
}

/** Sample road network into a coarse graph and BFS a path. Falls back to a bent polyline if disconnected. */
export function roadPath(from: [number, number], to: [number, number]): [number, number][] {
  type N = { x: number; z: number; i: number };
  const nodes: N[] = [];
  const add = (x: number, z: number) => { nodes.push({ x, z, i: nodes.length }); };
  for (const r of ROADS) {
    const step = Math.max(1, Math.floor(r.pts.length / 12));
    for (let i = 0; i < r.pts.length; i += step) add(r.pts[i]![0], r.pts[i]![1]);
    const last = r.pts[r.pts.length - 1]!; add(last[0], last[1]);
  }
  for (const s of Object.values(MINE_SITES)) {
    add(s.x, s.z);
    for (const t of s.track) add(t[0], t[1]);
  }
  add(from[0], from[1]); add(to[0], to[1]);
  const start = nodes.length - 2, goal = nodes.length - 1;
  const JOIN = 14;
  const adj: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const d = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.z - nodes[j]!.z);
    if (d > 0.5 && d <= JOIN) { adj[i]!.push(j); adj[j]!.push(i); }
  }
  // Link consecutive samples on same road denser already; ensure from/to connect to nearest
  const nearest = (i: number) => {
    let best = -1, bd = Infinity;
    for (let j = 0; j < nodes.length; j++) if (j !== i) {
      const d = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.z - nodes[j]!.z);
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0 && !adj[i]!.includes(best)) { adj[i]!.push(best); adj[best]!.push(i); }
  };
  nearest(start); nearest(goal);

  const prev = new Int32Array(nodes.length).fill(-1);
  const q = [start]; prev[start] = start;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi]!; if (u === goal) break;
    for (const v of adj[u]!) if (prev[v] < 0) { prev[v] = u; q.push(v); }
  }
  if (prev[goal] < 0) {
    // Soft bend via a mid road point near the midpoint
    const mx = (from[0] + to[0]) / 2, mz = (from[1] + to[1]) / 2;
    let mid: [number, number] = [mx, mz]; let bd = Infinity;
    for (const r of ROADS) for (const p of r.pts) {
      const d = Math.hypot(p[0] - mx, p[1] - mz); if (d < bd) { bd = d; mid = [p[0], p[1]]; }
    }
    return [from, mid, to];
  }
  const chain: [number, number][] = [];
  for (let u = goal; ; u = prev[u]!) { chain.push([nodes[u]!.x, nodes[u]!.z]); if (u === start) break; }
  chain.reverse();
  // Drop near-duplicates
  const out: [number, number][] = [chain[0]!];
  for (const p of chain.slice(1)) {
    const last = out[out.length - 1]!;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 2) out.push(p);
  }
  if (out[out.length - 1] !== to) out.push(to);
  return out;
}

export function pathLength(path: [number, number][]): number {
  let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  return L;
}

export function haulDurationMs(path: [number, number][]): number {
  const ms = (pathLength(path) / HAUL_SPEED) * 1000;
  return Math.max(HAUL_MIN_MS, Math.min(HAUL_MAX_MS, Math.round(ms)));
}

/** Pose along path at time `now`. */
export function haulPose(e: Pick<HaulEvent, 'path' | 'departAt' | 'arriveAt'>, now: number): { x: number; z: number; a: number; done: boolean } {
  if (now >= e.arriveAt) {
    const p = e.path[e.path.length - 1]!; const q = e.path[Math.max(0, e.path.length - 2)]!;
    return { x: p[0], z: p[1], a: Math.atan2(p[1] - q[1], p[0] - q[0]), done: true };
  }
  if (now <= e.departAt) {
    const p = e.path[0]!; const q = e.path[Math.min(1, e.path.length - 1)]!;
    return { x: p[0], z: p[1], a: Math.atan2(q[1] - p[1], q[0] - p[0]), done: false };
  }
  const t = (now - e.departAt) / Math.max(1, e.arriveAt - e.departAt);
  const total = pathLength(e.path); let dist = t * total;
  for (let i = 1; i < e.path.length; i++) {
    const a = e.path[i - 1]!, b = e.path[i]!; const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dist <= seg || i === e.path.length - 1) {
      const u = seg > 0 ? Math.min(1, dist / seg) : 0;
      return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, a: Math.atan2(b[1] - a[1], b[0] - a[0]), done: false };
    }
    dist -= seg;
  }
  const p = e.path[e.path.length - 1]!; return { x: p[0], z: p[1], a: 0, done: true };
}

export function buildHaul(name: string, fromSite: string, toSite: string, kind: HaulKind, now = Date.now(), id?: string): HaulEvent | null {
  const from = haulSiteXZ(fromSite); const to = haulSiteXZ(toSite);
  if (!from || !to) return null;
  if (Math.hypot(from[0] - to[0], from[1] - to[1]) < 4) return null;
  const path = roadPath(from, to);
  const dur = haulDurationMs(path);
  return { id: id ?? `h-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, from, to, path, departAt: now, arriveAt: now + dur, kind };
}

/** Stable farm site key from a plot id like f:3 / cf:12 / farm:f:3. */
export function farmHaulSite(plotId: string): string {
  if (plotId.startsWith('farm:')) return plotId;
  return `farm:${plotId}`;
}

export { plotId };
