/**
 * Cosmetic delivery trucks on the city map (pt2101u / queue #6). Pure rules: site → xz, road path,
 * travel time, caps. No inventory or economy. Worker hauls start at the job site (mine / quarry / dock),
 * not the Employment Office. Pantry harvests land in the Chud City Warehouse pool (not the factory).
 */
import { EXP_PAVED, EXP_ROADS } from './expansionRoads.js';
import { ROADS, LANDMARK_SLOTS, MINE_SITES, SPOT_POS, PLATE } from './worldLayout.js';
import { farmPlots, plotId } from './farm.js';
import { fieldPlotOf } from './fieldFarms.js';
import { resortPlotOf } from './resort.js';
import { HUB_MAPS, type HubId } from './logistics.js';
import { RURAL_ROADS, DOCK } from './outskirts.js';
import { BIG_ROADS } from './bigFarms.js';
import { AIRPORT_ROADS, RACETRACK_ROADS } from './venues.js';

export const HAUL_MAX_VISIBLE = 50; // was 30; raised so longer trips (half speed) don't cull more aggressively
export const HAUL_MERGE_MS = 2_500;
export const HAUL_PER_PLAYER_PER_MIN = 12;
export const HAUL_BG_GAP_MS = 20_000; // throttle offline/background sweeps
export const HAUL_SPEED = 7; // world units / second along path (was 14; t2111u ~50% slower again)
export const HAUL_MIN_MS = 16_000; // was 8_000 — short hops also take ~2×
export const HAUL_MAX_MS = 180_000; // was 90_000 — headroom so longest road routes aren't squeezed above HAUL_SPEED
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
  /** Which map the cosmetic truck is drawn on. */
  hub: HubId;
}

const lm = (id: string): [number, number] | null => {
  const s = SPOT_POS[id] ?? LANDMARK_SLOTS[id];
  return s ? [s[0], s[1]] : null;
};

/** Resolve a logical site id to a city-map xz. Cross-map / unknown → null (caller skips). */
/** Resort Warehouse visual dock: first truck point on the resort hub (inventory loc is virtual). */
export const RESORT_WAREHOUSE_XZ: [number, number] = [HUB_MAPS.resort.truck[0]![0], HUB_MAPS.resort.truck[0]![1]];

/** Resolve a logical site id to xz on its map. Unknown → null (caller skips). */
export function haulSiteXZ(site: string): [number, number] | null {
  if (!site) return null;
  if (site === 'factory') return lm('factory');
  if (site === 'warehouse') return lm('warehouse');
  if (site === 'resort') return RESORT_WAREHOUSE_XZ;
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
  if (site.startsWith('farm:') || site.startsWith('f:') || site.startsWith('cf:') || site.startsWith('rf:')) {
    const id = site.startsWith('farm:') ? site.slice(5) : site;
    if (id.startsWith('f:')) {
      const n = Number(id.slice(2)); const p = farmPlots().find((x) => x.n === n);
      return p ? [p.x, p.z] : null;
    }
    if (id.startsWith('cf:')) {
      const p = fieldPlotOf(id);
      return p ? [p.x, p.z] : null;
    }
    if (id.startsWith('rf:')) {
      const p = resortPlotOf(id);
      return p ? [p.x, p.z] : null;
    }
  }
  // Direct "x,z"
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(site);
  if (m) return [Number(m[1]), Number(m[2])];
  return lm(site);
}

/** Which map a haul site belongs on (for filtering city vs resort cosmetic trucks). */
export function haulSiteHub(site: string): HubId {
  if (!site) return 'city';
  if (site === 'resort') return 'resort';
  const id = site.startsWith('farm:') ? site.slice(5) : site;
  if (id.startsWith('rf:') || site.startsWith('rf:')) return 'resort';
  return 'city';
}

/** Road graph for cosmetic haul trucks: city ROADS + rural/airport/track spurs (same network city traffic uses). */
type HaulPt = [number, number];
interface HaulGraph { nodes: HaulPt[]; adj: Array<Array<{ to: number; w: number }>> }

let HAUL_GRAPH: HaulGraph | null = null;
const HAUL_ROUTE_CACHE = new Map<string, HaulPt[] | null>();
/** Sites whose last pathfind found no road connection (straight-line fallback). Cleared on graph rebuild. */
export const haulNoRoadRoutes: string[] = [];

const roundKey = (x: number, z: number) => `${Math.round(x * 2) / 2},${Math.round(z * 2) / 2}`;
const routeKey = (a: HaulPt, b: HaulPt) => `${roundKey(a[0], a[1])}>${roundKey(b[0], b[1])}`;

function densifySeg(a: HaulPt, b: HaulPt, step = 6): HaulPt[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L / step));
  const out: HaulPt[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return out;
}

function buildHaulRoadGraph(): HaulGraph {
  const nodes: HaulPt[] = [];
  const idOf = new Map<string, number>();
  const nk = (x: number, z: number) => `${Math.round(x * 10) / 10},${Math.round(z * 10) / 10}`;
  const add = (x: number, z: number) => {
    const k = nk(x, z); const hit = idOf.get(k); if (hit !== undefined) return hit;
    const i = nodes.length; nodes.push([x, z]); idOf.set(k, i); return i;
  };
  const adj: Array<Array<{ to: number; w: number }>> = [];
  const ensure = (i: number) => { while (adj.length <= i) adj.push([]); };
  const link = (i: number, j: number) => {
    if (i === j) return;
    const w = Math.hypot(nodes[i]![0] - nodes[j]![0], nodes[i]![1] - nodes[j]![1]);
    if (w < 0.05 || w > 40) return; // skip micro + absurd jumps
    ensure(i); ensure(j);
    if (!adj[i]!.some((e) => e.to === j)) adj[i]!.push({ to: j, w });
    if (!adj[j]!.some((e) => e.to === i)) adj[j]!.push({ to: i, w });
  };
  const addPoly = (pts: HaulPt[]) => {
    let prev = -1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i > 0) {
        for (const q of densifySeg(pts[i - 1]!, p)) {
          const id = add(q[0], q[1]); ensure(id);
          if (prev >= 0) link(prev, id);
          prev = id;
        }
      } else {
        prev = add(p[0], p[1]); ensure(prev);
      }
    }
  };

  for (const r of ROADS) {
    const pts = (r.closed ? [...r.pts, r.pts[0]!] : r.pts) as HaulPt[];
    addPoly(pts);
  }
  for (const [a, b] of RURAL_ROADS) addPoly(densifySeg(a, b));
  for (const [a, b] of BIG_ROADS) addPoly(densifySeg(a, b));
  for (const [a, b] of AIRPORT_ROADS) addPoly(densifySeg(a as HaulPt, b as HaulPt));
  for (const [a, b] of RACETRACK_ROADS) addPoly(densifySeg(a as HaulPt, b as HaulPt));
  for (const s of Object.values(MINE_SITES)) {
    const track = s.track.map((t) => [t[0], t[1]] as HaulPt);
    addPoly([[s.x, s.z], ...track]);
  }
  addPoly(DOCK.path as HaulPt[]);
  // the 2x expansion network (curved, river crossings are bridges) — ends meet the Big Farms / rural roads at tie-ins
  for (const r of EXP_ROADS) if (EXP_PAVED[r.kind] || r.kind === 'farm') addPoly((r.closed ? [...r.pts, r.pts[0]!] : r.pts) as HaulPt[]);

  // Junction welds: nearby nodes (different polylines) within SNAP get an edge.
  const CELL = 8; const buckets = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const [x, z] = nodes[i]!; const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
  }
  const SNAP = 10;
  for (let i = 0; i < nodes.length; i++) {
    const [x, z] = nodes[i]!; const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of buckets.get(`${gx + dx},${gz + dz}`) ?? []) {
        if (j <= i) continue;
        const d = Math.hypot(nodes[j]![0] - x, nodes[j]![1] - z);
        if (d > 0.5 && d <= SNAP) link(i, j);
      }
    }
  }
  return { nodes, adj };
}

function nearestRoadNode(g: HaulGraph, p: HaulPt): { i: number; d: number } {
  let best = 0, bd = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = Math.hypot(g.nodes[i]![0] - p[0], g.nodes[i]![1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: bd };
}

/** Dijkstra over the haul road graph. Returns node index chain inclusive, or null. */
function dijkstra(g: HaulGraph, start: number, goal: number): number[] | null {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  dist[start] = 0;
  // Binary heap of [dist, node]
  const heap: Array<[number, number]> = [[0, start]];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p]![0] <= heap[k]![0]) break;
      const tmp = heap[p]!; heap[p] = heap[k]!; heap[k] = tmp; k = p;
    }
  };
  const pop = (): [number, number] | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        let s = k; const l = k * 2 + 1, r = l + 1;
        if (l < heap.length && heap[l]![0] < heap[s]![0]) s = l;
        if (r < heap.length && heap[r]![0] < heap[s]![0]) s = r;
        if (s === k) break;
        const tmp = heap[k]!; heap[k] = heap[s]!; heap[s] = tmp; k = s;
      }
    }
    return top;
  };
  while (heap.length) {
    const cur = pop()!;
    const [du, u] = cur;
    if (seen[u]) continue;
    seen[u] = 1;
    if (u === goal) break;
    if (du > dist[u]!) continue;
    for (const e of g.adj[u] ?? []) {
      const nd = du + e.w;
      if (nd < dist[e.to]!) { dist[e.to] = nd; prev[e.to] = u; push(nd, e.to); }
    }
  }
  if (prev[goal] < 0 && start !== goal) return null;
  const chain: number[] = [];
  for (let u = goal; ; u = prev[u]!) {
    chain.push(u);
    if (u === start) break;
    if (prev[u] < 0) return null;
  }
  chain.reverse();
  return chain;
}

/**
 * Pathfind along city/rural roads from nearest road node at `from` to nearest at `to`.
 * Off-road endpoints get a short connector leg. Falls back to a straight line if disconnected.
 * Routes are cached per rounded origin/destination pair.
 */
export function roadPath(from: [number, number], to: [number, number]): [number, number][] {
  const g = (HAUL_GRAPH ??= buildHaulRoadGraph());
  const k = routeKey(from, to);
  const hit = HAUL_ROUTE_CACHE.get(k);
  if (hit !== undefined) return hit ? hit.map((p) => [p[0], p[1]] as HaulPt) : [from, to];

  const a = nearestRoadNode(g, from);
  const b = nearestRoadNode(g, to);
  const chain = dijkstra(g, a.i, b.i);
  if (!chain) {
    HAUL_ROUTE_CACHE.set(k, null);
    HAUL_ROUTE_CACHE.set(routeKey(to, from), null);
    const label = `${roundKey(from[0], from[1])}→${roundKey(to[0], to[1])}`;
    if (!haulNoRoadRoutes.includes(label)) haulNoRoadRoutes.push(label);
    return [from, to];
  }
  const path: HaulPt[] = [from];
  for (const i of chain) {
    const p = g.nodes[i]!;
    const last = path[path.length - 1]!;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.2) path.push([p[0], p[1]]);
  }
  const last = path[path.length - 1]!;
  if (Math.hypot(to[0] - last[0], to[1] - last[1]) > 1.2) path.push(to);
  else path[path.length - 1] = to;
  HAUL_ROUTE_CACHE.set(k, path);
  HAUL_ROUTE_CACHE.set(routeKey(to, from), [...path].reverse());
  return path;
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
  const fromHub = haulSiteHub(fromSite); const toHub = haulSiteHub(toSite);
  if (fromHub !== toHub) return null; // never mix city and resort coords on one truck
  if (Math.hypot(from[0] - to[0], from[1] - to[1]) < 4) return null;
  const hub = fromHub;
  // Resort has no city road graph — use a short bent polyline. City/countryside use the road network.
  const path = hub === 'resort'
    ? [from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as [number, number], to]
    : roadPath(from, to);
  const dur = haulDurationMs(path);
  return { id: id ?? `h-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, from, to, path, departAt: now, arriveAt: now + dur, kind, hub };
}

/** Stable farm site key from a plot id like f:3 / cf:12 / farm:f:3. */
export function farmHaulSite(plotId: string): string {
  if (plotId.startsWith('farm:')) return plotId;
  return `farm:${plotId}`;
}

export { plotId };
