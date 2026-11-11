/**
 * Interior floor plans: footprint and room count scale with the house type.
 * Tiles are 1×1; interior walls sit on room edges (they do not consume tiles).
 * Saved furniture from the original 12×10 one-room interiors is remapped into
 * valid rooms and is never deleted.
 */
import { FURN_BY_ID, GRID_D, GRID_W, cells, footprint, type Placed } from './homes.js';

export interface HomeRoom { id: string; name: string; x: number; z: number; w: number; d: number }
/** Opening on a shared interior wall. `dir: 'x'` is a vertical wall at `x` (gap runs in z). */
export interface HomeDoor { x: number; z: number; dir: 'x' | 'z'; width: number }
export interface HomeWindow { x: number; z: number; dir: 'n' | 's' | 'e' | 'w'; width: number }
export interface HomePlan { type: string; w: number; d: number; wallH: number; rooms: HomeRoom[]; doors: HomeDoor[]; windows: HomeWindow[] }

const R = (id: string, name: string, x: number, z: number, w: number, d: number): HomeRoom => ({ id, name, x, z, w, d });

const cover = (w: number, d: number, rooms: HomeRoom[]) => {
  const area = rooms.reduce((s, r) => s + r.w * r.d, 0);
  if (area !== w * d) throw new Error(`home plan ${rooms.map((r) => r.id).join('+')} covers ${area}, expected ${w * d}`);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i]!, b = rooms[j]!;
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z) throw new Error(`overlap ${a.id} ${b.id}`);
  }
  return rooms;
};

/** Mid-edge door between two rooms that share a wall. */
export function doorBetween(a: HomeRoom, b: HomeRoom, width = 2): HomeDoor | null {
  // vertical shared edge
  const xShare = a.x + a.w === b.x || b.x + b.w === a.x;
  const zShare = a.z + a.d === b.z || b.z + b.d === a.z;
  if (xShare) {
    const x = a.x + a.w === b.x ? a.x + a.w : b.x + b.w;
    const z0 = Math.max(a.z, b.z), z1 = Math.min(a.z + a.d, b.z + b.d);
    if (z1 - z0 < width) return null;
    return { x, z: z0 + (z1 - z0) / 2, dir: 'x', width };
  }
  if (zShare) {
    const z = a.z + a.d === b.z ? a.z + a.d : b.z + b.d;
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
    if (x1 - x0 < width) return null;
    return { x: x0 + (x1 - x0) / 2, z, dir: 'z', width };
  }
  return null;
}

const byId = (rooms: HomeRoom[]) => Object.fromEntries(rooms.map((r) => [r.id, r]));
const doorsOf = (rooms: HomeRoom[], pairs: Array<[string, string]>, width = 2) => {
  const m = byId(rooms); const out: HomeDoor[] = [];
  for (const [a, b] of pairs) {
    const d = doorBetween(m[a]!, m[b]!, width); if (!d) throw new Error(`no shared wall ${a}-${b}`);
    out.push(d);
  }
  return out;
};

/** Windows on exterior walls long enough to take one. */
export function defaultWindows(w: number, d: number, rooms: HomeRoom[]): HomeWindow[] {
  const wins: HomeWindow[] = [];
  // north z=0, south z=d, west x=0, east x=w — one window per room face on the perimeter
  for (const r of rooms) {
    if (r.z === 0 && r.w >= 3) wins.push({ x: r.x + r.w / 2, z: 0, dir: 'n', width: Math.min(3, r.w - 1) });
    if (r.z + r.d === d && r.w >= 3) wins.push({ x: r.x + r.w / 2, z: d, dir: 's', width: Math.min(3, r.w - 1) });
    if (r.x === 0 && r.d >= 3) wins.push({ x: 0, z: r.z + r.d / 2, dir: 'w', width: Math.min(3, r.d - 1) });
    if (r.x + r.w === w && r.d >= 3) wins.push({ x: w, z: r.z + r.d / 2, dir: 'e', width: Math.min(3, r.d - 1) });
  }
  return wins;
}

const plan = (type: string, w: number, d: number, rooms: HomeRoom[], pairs: Array<[string, string]>): HomePlan => {
  const rs = cover(w, d, rooms);
  return { type, w, d, wallH: 3.2, rooms: rs, doors: doorsOf(rs, pairs), windows: defaultWindows(w, d, rs) };
};

/** Starter 12×10, four rooms plus a short hall — same footprint as the original one-room interior.
 *  Living stays in the original 0,0 corner so existing sofas and rugs keep their room. */
const STARTER = (type: string): HomePlan => plan(type, 12, 10, [
  R('living', 'Living', 0, 0, 7, 6),
  R('kitchen', 'Kitchen', 7, 0, 5, 6),
  R('hall', 'Hall', 0, 6, 3, 4),
  R('bedroom', 'Bedroom', 3, 6, 5, 4),
  R('bath', 'Bath', 8, 6, 4, 4),
], [['living', 'kitchen'], ['living', 'hall'], ['hall', 'bedroom'], ['bedroom', 'bath']]);

const MID = (type: string): HomePlan => plan(type, 16, 12, [
  R('living', 'Living', 0, 0, 8, 7),
  R('kitchen', 'Kitchen', 8, 0, 4, 7),
  R('dining', 'Dining', 12, 0, 4, 7),
  R('bedroom', 'Bedroom', 8, 7, 8, 5),
  R('bath', 'Bath', 4, 7, 4, 5),
  R('foyer', 'Foyer', 0, 7, 4, 5),
], [['living', 'kitchen'], ['kitchen', 'dining'], ['living', 'foyer'], ['foyer', 'bath'], ['bath', 'bedroom'], ['dining', 'bedroom']]);

const LUXE = (type: string): HomePlan => plan(type, 18, 14, [
  R('living', 'Living', 0, 0, 8, 8),
  R('dining', 'Dining', 8, 0, 5, 5),
  R('kitchen', 'Kitchen', 13, 0, 5, 5),
  R('office', 'Office', 8, 5, 5, 3),
  R('bed1', 'Bedroom', 13, 5, 5, 5),
  R('bath1', 'Bath', 8, 8, 5, 3),
  R('foyer', 'Foyer', 0, 8, 8, 6),
  R('bed2', 'Bedroom', 8, 11, 5, 3),
  R('bath2', 'Bath', 13, 10, 5, 4),
], [
  ['living', 'dining'], ['dining', 'kitchen'], ['dining', 'office'], ['office', 'bed1'],
  ['kitchen', 'bed1'], ['living', 'foyer'], ['foyer', 'bath1'], ['bath1', 'bed2'],
  ['foyer', 'bed2'], ['bed1', 'bath2'], ['bed2', 'bath2'],
]);


const GRAND = (type: string): HomePlan => plan(type, 22, 16, [
  R('living', 'Living', 0, 0, 9, 8),
  R('dining', 'Dining', 9, 0, 6, 5),
  R('kitchen', 'Kitchen', 15, 0, 7, 5),
  R('office', 'Office', 9, 5, 6, 4),
  R('lounge', 'Lounge', 15, 5, 7, 4),
  R('library', 'Library', 0, 8, 9, 4),
  R('bath1', 'Bath', 9, 9, 6, 3),
  R('bed1', 'Main bedroom', 15, 9, 7, 4),
  R('foyer', 'Foyer', 0, 12, 9, 4),
  R('bed2', 'Bedroom', 9, 12, 6, 4),
  R('bath2', 'Bath', 15, 13, 4, 3),
  R('bed3', 'Bedroom', 19, 13, 3, 3),
], [
  ['living', 'dining'], ['dining', 'kitchen'], ['dining', 'office'], ['kitchen', 'lounge'], ['office', 'lounge'],
  ['living', 'library'], ['library', 'foyer'], ['office', 'bath1'], ['bath1', 'bed2'],
  ['lounge', 'bed1'], ['bed1', 'bath2'], ['foyer', 'bed2'], ['bed2', 'bath2'], ['bath2', 'bed3'], ['bed1', 'bed3'],
]);

const PLANS: Record<string, () => HomePlan> = {
  house: () => STARTER('house'),
  rowhouse: () => STARTER('rowhouse'),
  apartment: () => STARTER('apartment'),
  beachhouse: () => STARTER('beachhouse'),
  condo: () => MID('condo'),
  villa: () => MID('villa'),
  tower: () => MID('tower'),
  hotel: () => LUXE('hotel'),
  penthouse: () => LUXE('penthouse'),
  isleestate: () => LUXE('isleestate'),
  mansion: () => GRAND('mansion'),
  highrise: () => GRAND('highrise'),
};

export const HOME_PLAN_TYPES = Object.keys(PLANS);

export function homePlan(type: string | undefined | null): HomePlan {
  const t = type && PLANS[type] ? type : 'house';
  return PLANS[t]!();
}

export const roomAt = (plan: HomePlan, x: number, z: number): HomeRoom | undefined =>
  plan.rooms.find((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);

export function itemRoom(plan: HomePlan, p: Placed): HomeRoom | null {
  const cs = cells(p); if (!cs.length) return null;
  const rooms = new Set(cs.map((c) => { const [x, z] = c.split(',').map(Number); return roomAt(plan, x!, z!)?.id; }));
  if (rooms.size !== 1 || rooms.has(undefined)) return null;
  const id = [...rooms][0]!;
  return plan.rooms.find((r) => r.id === id) ?? null;
}

export function fitsPlan(plan: HomePlan, items: Placed[], p: Placed, skipUid?: string): boolean {
  const f = FURN_BY_ID.get(p.f); if (!f) return false;
  const { w, d } = footprint(f, p.r);
  if (p.x < 0 || p.z < 0 || p.x + w > plan.w || p.z + d > plan.d) return false;
  if (!itemRoom(plan, p)) return false;
  const mine = new Set(cells(p)); const flat = f.h < 0.1;
  for (const o of items) {
    if (o.uid === skipUid) continue; const of = FURN_BY_ID.get(o.f); if (!of || (of.h < 0.1) !== flat) continue;
    if (cells(o).some((c) => mine.has(c))) return false;
  }
  return true;
}

/** Move an item into the nearest valid tile in a room; never drop it. */
export function migrateItems(type: string | undefined, items: Placed[]): Placed[] {
  const plan = homePlan(type);
  const out: Placed[] = [];
  for (const it of items) {
    if (fitsPlan(plan, out, it)) { out.push(it); continue; }
    const f = FURN_BY_ID.get(it.f);
    if (!f) { out.push(it); continue; }
    const { w, d } = footprint(f, it.r);
    // Prefer scaling from the original 12×10 room into the new plan, then a spiral around the mapped cell.
    const mx = Math.max(0, Math.min(plan.w - w, Math.round(it.x * (plan.w / GRID_W))));
    const mz = Math.max(0, Math.min(plan.d - d, Math.round(it.z * (plan.d / GRID_D))));
    const tryAt = (x: number, z: number, r: number) => {
      const q = { ...it, x, z, r }; return fitsPlan(plan, out, q) ? q : null;
    };
    let found: Placed | null = tryAt(mx, mz, it.r);
    for (let rad = 1; !found && rad <= Math.max(plan.w, plan.d); rad++) {
      for (let dx = -rad; dx <= rad && !found; dx++) for (const dz of [-rad, rad]) {
        found = tryAt(mx + dx, mz + dz, it.r); if (found) break;
      }
      for (let dz = -rad + 1; dz <= rad - 1 && !found; dz++) for (const dx of [-rad, rad]) {
        found = tryAt(mx + dx, mz + dz, it.r);
      }
    }
    if (!found) {
      for (const r of [0, 1, 2, 3]) {
        for (const room of plan.rooms) {
          for (let x = room.x; x <= room.x + room.w - 1 && !found; x++) {
            for (let z = room.z; z <= room.z + room.d - 1 && !found; z++) found = tryAt(x, z, r);
          }
        }
      }
    }
    out.push(found ?? { ...it, x: Math.max(0, Math.min(plan.w - w, mx)), z: Math.max(0, Math.min(plan.d - d, mz)) });
  }
  return out;
}

const doorOpen = (plan: HomePlan, x: number, z: number) => {
  for (const d of plan.doors) {
    if (d.dir === 'x' && Math.abs(x - d.x) < 0.28 && Math.abs(z - d.z) <= d.width / 2) return true;
    if (d.dir === 'z' && Math.abs(z - d.z) < 0.28 && Math.abs(x - d.x) <= d.width / 2) return true;
  }
  return false;
};

/** Interior wall at this point? Used to block walking (doorways stay open). */
export function hitsInteriorWall(plan: HomePlan, x: number, z: number, rad = 0.22): boolean {
  for (const r of plan.rooms) {
    const edges: Array<['x' | 'z', number, number, number]> = [
      ['x', r.x, r.z, r.z + r.d], ['x', r.x + r.w, r.z, r.z + r.d],
      ['z', r.z, r.x, r.x + r.w], ['z', r.z + r.d, r.x, r.x + r.w],
    ];
    for (const [dir, at, a0, a1] of edges) {
      // skip outer shell — those are solid exterior walls handled by the bounds clamp
      if (dir === 'x' && (at === 0 || at === plan.w)) continue;
      if (dir === 'z' && (at === 0 || at === plan.d)) continue;
      if (dir === 'x') {
        if (Math.abs(x - at) < rad && z >= a0 - rad && z <= a1 + rad && !doorOpen(plan, at, z)) return true;
      } else if (Math.abs(z - at) < rad && x >= a0 - rad && x <= a1 + rad && !doorOpen(plan, x, at)) return true;
    }
  }
  return false;
}

export function clampInPlan(plan: HomePlan, x: number, z: number): { x: number; z: number } {
  const nx = Math.min(plan.w - 0.3, Math.max(0.3, x));
  const nz = Math.min(plan.d - 0.3, Math.max(0.3, z));
  if (!hitsInteriorWall(plan, nx, nz)) return { x: nx, z: nz };
  // slide back to the last open axis (walking into a wall)
  if (!hitsInteriorWall(plan, x, nz) && x >= 0.3 && x <= plan.w - 0.3) return { x, z: nz };
  if (!hitsInteriorWall(plan, nx, z) && z >= 0.3 && z <= plan.d - 0.3) return { x: nx, z };
  // already on a wall (spawn or a shove): nudge to the nearest open tile
  for (const s of [0.3, 0.45, 0.6, 0.9, 1.2, 1.6]) {
    for (const [dx, dz] of [[s, 0], [-s, 0], [0, s], [0, -s], [s, s], [-s, s], [s, -s], [-s, -s]] as Array<[number, number]>) {
      const qx = Math.min(plan.w - 0.3, Math.max(0.3, nx + dx));
      const qz = Math.min(plan.d - 0.3, Math.max(0.3, nz + dz));
      if (!hitsInteriorWall(plan, qx, qz)) return { x: qx, z: qz };
    }
  }
  return { x: nx, z: nz };
}

export interface WallSeg { x0: number; z0: number; x1: number; z1: number }

/** Front door on the south wall of the foyer (or the widest south-facing room). */
export function frontDoor(plan: HomePlan): HomeDoor {
  const prefer = ['foyer', 'hall'];
  const south = plan.rooms.filter((r) => r.z + r.d === plan.d).sort((a, b) => {
    const ia = prefer.indexOf(a.id), ib = prefer.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return b.w - a.w;
  })[0] ?? plan.rooms[0]!;
  return { x: south.x + south.w / 2, z: plan.d, dir: 'z', width: Math.min(2.4, Math.max(1.6, south.w - 0.8)) };
}

export function spawnPos(plan: HomePlan): { x: number; z: number } {
  const r = plan.rooms.find((x) => x.id === 'foyer') ?? plan.rooms.find((x) => x.id === 'hall') ?? plan.rooms.find((x) => x.id === 'living') ?? plan.rooms[0]!;
  return { x: r.x + r.w * 0.5, z: r.z + r.d * 0.72 };
}

export function wallSegments(plan: HomePlan): WallSeg[] {
  type Seg = WallSeg;
  const raw: Seg[] = [];
  const add = (x0: number, z0: number, x1: number, z1: number) => {
    if (x0 === x1 && z0 === z1) return;
    if (x0 > x1 || (x0 === x1 && z0 > z1)) raw.push({ x0: x1, z0: z1, x1: x0, z1: z0 });
    else raw.push({ x0, z0, x1, z1 });
  };
  for (const r of plan.rooms) {
    add(r.x, r.z, r.x + r.w, r.z);
    add(r.x, r.z + r.d, r.x + r.w, r.z + r.d);
    add(r.x, r.z, r.x, r.z + r.d);
    add(r.x + r.w, r.z, r.x + r.w, r.z + r.d);
  }
  const seen = new Set<string>();
  const uniq: Seg[] = [];
  for (const s of raw) {
    const k = `${s.x0},${s.z0},${s.x1},${s.z1}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
  }
  const doors = [...plan.doors, frontDoor(plan)];
  const cut = (s: Seg): Seg[] => {
    const vertical = s.x0 === s.x1;
    const hits: Array<[number, number]> = [];
    for (const d of doors) {
      if (vertical && d.dir === 'x' && Math.abs(d.x - s.x0) < 1e-6) {
        const a = d.z - d.width / 2, b = d.z + d.width / 2;
        if (b > s.z0 && a < s.z1) hits.push([Math.max(s.z0, a), Math.min(s.z1, b)]);
      }
      if (!vertical && d.dir === 'z' && Math.abs(d.z - s.z0) < 1e-6) {
        const a = d.x - d.width / 2, b = d.x + d.width / 2;
        if (b > s.x0 && a < s.x1) hits.push([Math.max(s.x0, a), Math.min(s.x1, b)]);
      }
    }
    if (!hits.length) return [s];
    hits.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const h of hits) {
      const last = merged[merged.length - 1];
      if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
      else merged.push([h[0], h[1]]);
    }
    const out: Seg[] = [];
    let cur = vertical ? s.z0 : s.x0;
    const end = vertical ? s.z1 : s.x1;
    for (const [a, b] of merged) {
      if (a - cur > 0.04) {
        if (vertical) out.push({ x0: s.x0, z0: cur, x1: s.x1, z1: a });
        else out.push({ x0: cur, z0: s.z0, x1: a, z1: s.z1 });
      }
      cur = Math.max(cur, b);
    }
    if (end - cur > 0.04) {
      if (vertical) out.push({ x0: s.x0, z0: cur, x1: s.x1, z1: end });
      else out.push({ x0: cur, z0: s.z0, x1: end, z1: s.z1 });
    }
    return out;
  };
  return uniq.flatMap(cut);
}
