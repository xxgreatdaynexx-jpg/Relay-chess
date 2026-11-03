/**
 * Enterable, customizable homes (Millionaire Update, pt1459u).
 * Every residential property you own has an interior: a GRID_W × GRID_D tile room. Furniture is bought at the Furniture
 * Store (a city landmark) into your furniture inventory, then placed / moved / rotated / removed on the grid in build mode.
 * Placed furniture stays yours: it only "uses" a copy from your inventory while it sits in a home you currently own.
 * Wall and floor styles are bought once and then usable in every home.
 */
export const GRID_W = 12;
export const GRID_D = 10;
export const MAX_ITEMS = 80;
export const MAX_VISITORS = 12;
export const CHAT_MAX = 160;
export const MAX_INVITES = 30;
export const MAX_BUY_QTY = 20;

/** Property types that are homes (have an interior). Commercial lots, farms and landmarks don't. */
export const HOME_TYPES = new Set(['house', 'rowhouse', 'apartment', 'tower', 'beachhouse', 'condo', 'villa', 'hotel']);
export const isHomeProperty = (p: { kind: string; type: string } | undefined | null) => !!p && p.kind === 'building' && HOME_TYPES.has(p.type);

export type FurnCat = 'seating' | 'tables' | 'beds' | 'storage' | 'lighting' | 'decor' | 'plants' | 'electronics' | 'kitchen' | 'luxury';
export const FURN_CATS: { id: FurnCat; label: string; icon: string }[] = [
  { id: 'seating', label: 'Seating', icon: '🛋️' }, { id: 'tables', label: 'Tables', icon: '🪑' }, { id: 'beds', label: 'Beds', icon: '🛏️' },
  { id: 'storage', label: 'Storage', icon: '🗄️' }, { id: 'lighting', label: 'Lighting', icon: '💡' }, { id: 'decor', label: 'Decor', icon: '🖼️' },
  { id: 'plants', label: 'Plants', icon: '🪴' }, { id: 'electronics', label: 'Electronics', icon: '📺' }, { id: 'kitchen', label: 'Kitchen', icon: '🍳' },
  { id: 'luxury', label: 'Luxury', icon: '💎' },
];

/** shape drives the 3D model (client/src/lib/homeModels.ts); w × d is the footprint in tiles at rotation 0; h is height in tiles. */
export interface Furniture { id: string; name: string; cat: FurnCat; price: number; w: number; d: number; h: number; color: number; accent: number; shape: string; icon: string }
const F = (id: string, name: string, cat: FurnCat, price: number, w: number, d: number, h: number, color: number, accent: number, shape: string, icon: string): Furniture => ({ id, name, cat, price, w, d, h, color, accent, shape, icon });
/** Base prices (scaled by the daily price index like every other store). */
export const FURNITURE: Furniture[] = [
  F('stool', 'Bar stool', 'seating', 150, 1, 1, 0.8, 0x8a5a36, 0x2b2b2b, 'stool', '🪑'),
  F('armchair', 'Armchair', 'seating', 600, 1, 1, 0.9, 0x5a7bd6, 0x3b2a1e, 'chair', '💺'),
  F('sofa', 'Sofa', 'seating', 1_400, 3, 1, 0.9, 0x8a3a3a, 0x3b2a1e, 'sofa', '🛋️'),
  F('sectional', 'Leather sectional', 'seating', 4_500, 3, 2, 0.9, 0x2a1d16, 0xc9a24a, 'sectional', '🛋️'),
  F('dining', 'Dining table', 'tables', 900, 2, 1, 0.7, 0x9a6b3e, 0x6b4526, 'table', '🍽️'),
  F('coffee', 'Coffee table', 'tables', 350, 2, 1, 0.4, 0x6b4526, 0xd8d2c0, 'lowtable', '☕'),
  F('desk', 'Office desk', 'tables', 800, 2, 1, 0.75, 0xd8d2c0, 0x333333, 'desk', '🖥️'),
  F('bed', 'Single bed', 'beds', 700, 1, 2, 0.6, 0xe8e2d0, 0x5a7bd6, 'bed', '🛏️'),
  F('kingbed', 'King bed', 'beds', 2_800, 2, 2, 0.7, 0xf4efe4, 0x7a2a4a, 'bed', '🛏️'),
  F('dresser', 'Dresser', 'storage', 650, 2, 1, 1, 0x7a5232, 0xc9a24a, 'cabinet', '🗄️'),
  F('bookshelf', 'Bookshelf', 'storage', 500, 2, 1, 2, 0x6b4526, 0xb8402a, 'shelf', '📚'),
  F('lamp', 'Floor lamp', 'lighting', 200, 1, 1, 1.6, 0x2b2b2b, 0xffe6a0, 'lamp', '💡'),
  F('chandelier', 'Crystal chandelier', 'lighting', 6_000, 1, 1, 2.6, 0xf2e6c0, 0xdff6ff, 'chandelier', '✨'),
  F('rug', 'Area rug', 'decor', 300, 3, 2, 0.05, 0x9a3b3b, 0xe0c080, 'rug', '🟥'),
  F('painting', 'Framed painting', 'decor', 450, 1, 1, 1.6, 0x3b2a1e, 0x4fa3d9, 'painting', '🖼️'),
  F('statue', 'Gold chud statue', 'decor', 12_000, 1, 1, 1.8, 0xd4af37, 0x8a6a1a, 'statue', '🗿'),
  F('plant', 'Potted plant', 'plants', 120, 1, 1, 1, 0x3fae55, 0x8a5a36, 'plant', '🪴'),
  F('palm', 'Indoor palm', 'plants', 400, 1, 1, 1.9, 0x2e8b45, 0xb08350, 'palm', '🌴'),
  F('tv', 'Big-screen TV', 'electronics', 1_800, 2, 1, 1.2, 0x111111, 0x3a6ad9, 'tv', '📺'),
  F('pc', 'Gaming PC setup', 'electronics', 3_200, 2, 1, 1.2, 0x1a1a24, 0xff3cac, 'pc', '🖥️'),
  F('arcade', 'Arcade cabinet', 'electronics', 2_500, 1, 1, 1.8, 0x3a2a7a, 0x7cf0ff, 'arcade', '🕹️'),
  F('fridge', 'Fridge', 'kitchen', 1_100, 1, 1, 1.9, 0xd8dde4, 0x888888, 'fridge', '🧊'),
  F('stove', 'Stove', 'kitchen', 900, 1, 1, 0.9, 0x2b2b2b, 0xd8dde4, 'stove', '🍳'),
  F('counter', 'Kitchen counter', 'kitchen', 500, 2, 1, 0.9, 0xe8e2d0, 0x6b4526, 'counter', '🧂'),
  F('piano', 'Grand piano', 'luxury', 25_000, 2, 2, 1, 0x111111, 0xf4efe4, 'piano', '🎹'),
  F('hottub', 'Hot tub', 'luxury', 18_000, 2, 2, 0.8, 0x7a5232, 0x4fc3d9, 'hottub', '♨️'),
  F('aquarium', 'Aquarium', 'luxury', 9_000, 2, 1, 1.4, 0x222222, 0x4fc3d9, 'aquarium', '🐠'),
  F('goldvault', 'Chip vault', 'luxury', 50_000, 1, 1, 2, 0x555a66, 0xd4af37, 'vault', '🏦'),
];
export const FURN_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));

export interface Style { id: string; name: string; price: number; color: number; accent: number }
export const WALL_STYLES: Style[] = [
  { id: 'plaster', name: 'White plaster', price: 0, color: 0xe9e4d8, accent: 0xcfc8b8 },
  { id: 'sage', name: 'Sage paint', price: 400, color: 0x9fb59a, accent: 0x7e9479 },
  { id: 'navy', name: 'Navy paint', price: 400, color: 0x2c3e66, accent: 0x1e2c4a },
  { id: 'brick', name: 'Exposed brick', price: 1_500, color: 0x9a5a3c, accent: 0x7a4028 },
  { id: 'wood', name: 'Wood panelling', price: 2_000, color: 0x8a5a36, accent: 0x6b4526 },
  { id: 'marble', name: 'Marble', price: 8_000, color: 0xeeeae2, accent: 0xc9c2b4 },
  { id: 'gold', name: 'Gold leaf', price: 30_000, color: 0xd4af37, accent: 0xa8841f },
];
export const FLOOR_STYLES: Style[] = [
  { id: 'laminate', name: 'Laminate', price: 0, color: 0xb59466, accent: 0x9a7a50 },
  { id: 'carpet', name: 'Grey carpet', price: 500, color: 0x8a8d94, accent: 0x7a7d84 },
  { id: 'tile', name: 'Checker tile', price: 900, color: 0xf0f0f0, accent: 0x2b2b2b },
  { id: 'oak', name: 'Oak hardwood', price: 2_500, color: 0xa8763e, accent: 0x8a5e2e },
  { id: 'marble', name: 'Marble floor', price: 9_000, color: 0xf2efe8, accent: 0xd0c8b8 },
  { id: 'gold', name: 'Gold tile', price: 35_000, color: 0xe2c25a, accent: 0xb89530 },
];
export const WALL_BY_ID = new Map(WALL_STYLES.map((s) => [s.id, s]));
export const FLOOR_BY_ID = new Map(FLOOR_STYLES.map((s) => [s.id, s]));
/** Inventory keys: furniture id, or 'wall:<id>' / 'floor:<id>' for a style (owned once). */
export const styleKey = (kind: 'wall' | 'floor', id: string) => `${kind}:${id}`;
export function shopItem(key: string): { key: string; name: string; price: number; once: boolean } | null {
  const f = FURN_BY_ID.get(key); if (f) return { key, name: f.name, price: f.price, once: false };
  const [k, id] = key.split(':'); const s = k === 'wall' ? WALL_BY_ID.get(id ?? '') : k === 'floor' ? FLOOR_BY_ID.get(id ?? '') : undefined;
  return s ? { key, name: `${s.name} (${k})`, price: s.price, once: true } : null;
}

export type HomeAccess = 'open' | 'invite' | 'locked';
export const ACCESS_LABEL: Record<HomeAccess, string> = { open: 'Open to everyone', invite: 'Invite list only', locked: 'Locked (just you)' };
export interface Placed { uid: string; f: string; x: number; z: number; r: number }
export interface HomeLayout { wall: string; floor: string; items: Placed[] }
export const EMPTY_LAYOUT: HomeLayout = { wall: 'plaster', floor: 'laminate', items: [] };

/** Footprint (w, d) after rotation r (quarter turns). */
export const footprint = (f: Furniture, r: number) => (r % 2 ? { w: f.d, d: f.w } : { w: f.w, d: f.d });
/** Tiles an item covers. Flat items (rugs) don't block anything. */
export const cells = (p: Placed): string[] => {
  const f = FURN_BY_ID.get(p.f); if (!f) return []; const { w, d } = footprint(f, p.r); const out: string[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push(`${p.x + i},${p.z + j}`);
  return out;
};
const isFlat = (f: Furniture) => f.h < 0.1;

/** Can `p` go here, ignoring `skipUid` (the item being moved)? */
export function fits(items: Placed[], p: Placed, skipUid?: string): boolean {
  const f = FURN_BY_ID.get(p.f); if (!f) return false; const { w, d } = footprint(f, p.r);
  if (p.x < 0 || p.z < 0 || p.x + w > GRID_W || p.z + d > GRID_D) return false;
  const mine = new Set(cells(p)); const flat = isFlat(f);
  for (const o of items) {
    if (o.uid === skipUid) continue; const of = FURN_BY_ID.get(o.f); if (!of || isFlat(of) !== flat) continue;
    if (cells(o).some((c) => mine.has(c))) return false;
  }
  return true;
}

/** Validate a layout a client sent: shape, bounds, overlaps, styles owned, furniture counts ≤ what the owner can place. */
export function validateLayout(raw: unknown, available: Map<string, number>, ownsStyle: (key: string) => boolean): { ok: true; layout: HomeLayout } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Bad layout.' };
  const r = raw as Record<string, unknown>;
  const wall = typeof r.wall === 'string' && WALL_BY_ID.has(r.wall) ? r.wall : null; const floor = typeof r.floor === 'string' && FLOOR_BY_ID.has(r.floor) ? r.floor : null;
  if (!wall || !floor) return { ok: false, error: 'Unknown wall or floor style.' };
  if (WALL_BY_ID.get(wall)!.price > 0 && !ownsStyle(styleKey('wall', wall))) return { ok: false, error: 'Buy that wall style at the Furniture Store first.' };
  if (FLOOR_BY_ID.get(floor)!.price > 0 && !ownsStyle(styleKey('floor', floor))) return { ok: false, error: 'Buy that floor style at the Furniture Store first.' };
  if (!Array.isArray(r.items) || r.items.length > MAX_ITEMS) return { ok: false, error: `A home holds up to ${MAX_ITEMS} items.` };
  const items: Placed[] = []; const used = new Map<string, number>(); const uids = new Set<string>();
  for (const it of r.items as unknown[]) {
    const o = (it ?? {}) as Record<string, unknown>;
    const p: Placed = { uid: String(o.uid ?? '').slice(0, 40), f: String(o.f ?? ''), x: Number(o.x), z: Number(o.z), r: Number(o.r) };
    if (!p.uid || uids.has(p.uid) || !FURN_BY_ID.has(p.f) || ![p.x, p.z, p.r].every(Number.isInteger) || p.r < 0 || p.r > 3) return { ok: false, error: 'Bad furniture entry.' };
    if (!fits(items, p)) return { ok: false, error: `${FURN_BY_ID.get(p.f)!.name} doesn't fit there.` };
    used.set(p.f, (used.get(p.f) ?? 0) + 1);
    if (used.get(p.f)! > (available.get(p.f) ?? 0)) return { ok: false, error: `You don't have another ${FURN_BY_ID.get(p.f)!.name}. Buy one at the Furniture Store.` };
    uids.add(p.uid); items.push(p);
  }
  return { ok: true, layout: { wall, floor, items } };
}

/** Clamp an avatar position to the room (tile units, floats). */
export const clampPos = (x: unknown, z: unknown): { x: number; z: number } | null => {
  const a = Number(x), b = Number(z); if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { x: Math.min(GRID_W - 0.3, Math.max(0.3, a)), z: Math.min(GRID_D - 0.3, Math.max(0.3, b)) };
};
export const canVisit = (access: HomeAccess, invites: string[], owner: string, visitor: string) => {
  const v = visitor.trim().toLowerCase(); if (v === owner.trim().toLowerCase()) return true;
  return access === 'open' || (access === 'invite' && invites.includes(v));
};
