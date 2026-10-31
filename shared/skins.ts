/** Chud Hub weapon skins: static catalog (original, procedural — no external art), wear tiers and case odds. */
export type Rarity = 'common' | 'rare' | 'ultra';
export type SkinPattern = 'camo' | 'stripes' | 'carbon' | 'hex' | 'gradient' | 'marble' | 'digital' | 'tiger' | 'splatter' | 'circuit' | 'solid' | 'checker';
export type SkinFx = 'glow' | 'holo' | 'shift' | 'pulse' | 'galaxy' | 'ember' | 'scan';
export type SkinFinish = 'matte' | 'gloss' | 'metal';
/** Weapon ids are strings so later weapons (knife, grenade) can join the catalog without a type change. */
export interface SkinDef { id: string; name: string; weapon: string; rarity: Rarity; pattern: SkinPattern; colors: [string, string, string]; fx?: SkinFx; finish?: SkinFinish }

export const RARITY_COLOR: Record<Rarity, string> = { common: '#7fa3c9', rare: '#b05cff', ultra: '#ffb21a' };
export const RARITY_NAME: Record<Rarity, string> = { common: 'Common', rare: 'Rare', ultra: 'Ultra' };
export const WEAPON_NAME: Record<string, string> = { pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun', sniper: 'Sniper', rocket: 'RPG', ar15: 'AR-15', knife: 'Knife', grenade: 'Grenade' };

type Row = [string, SkinPattern, string, string, string, SkinFx?];
const C: Record<string, Row[]> = {
  pistol: [['Basement Dweller', 'camo', '#4d4a3c', '#6b6650', '#2e2c24'], ['Tendie Gold Lite', 'gradient', '#c9a640', '#8a6d1f', '#3b2f10'], ['Mom\'s Minivan', 'solid', '#8a95a3', '#5f6873', '#2c3036'],
    ['Cheeto Dust', 'splatter', '#ff8a1f', '#d9661a', '#3b2410'], ['Night Shift', 'stripes', '#1f2230', '#3a3f58', '#0c0d12'], ['Grass Untouched', 'digital', '#3f6b35', '#2a4a24', '#6d8f4e']],
  smg: [['Energy Drink Spill', 'splatter', '#9cff3a', '#2a2f22', '#5fbf1f'], ['Bargain Bin', 'checker', '#b8b2a2', '#6f6a5c', '#3a372f'], ['Keyboard Warrior', 'carbon', '#2b2d31', '#1a1b1e', '#4a4e55'],
    ['Swamp Thing', 'camo', '#3a4a2a', '#56663a', '#1f2a16'], ['Discount Chrome', 'gradient', '#c8ccd2', '#7d838b', '#3c4046'], ['Pizza Roll', 'marble', '#d98c3a', '#f2d29a', '#7a3a14']],
  shotgun: [['Garage Sale', 'stripes', '#8c6a43', '#c8a26c', '#3b2a18'], ['Gravy Boat', 'gradient', '#7a4a24', '#4a2a12', '#c27a3c'], ['Couch Lint', 'digital', '#8a8a80', '#6a6a60', '#b0b0a4'],
    ['Lawn Chair', 'checker', '#2f7a5a', '#e8e0c8', '#1a3a2a'], ['Dumpster Fire', 'tiger', '#3a2a1a', '#d9661a', '#1a120a'], ['Brick Wall', 'hex', '#8a3a2a', '#5a2418', '#c26a4a']],
  sniper: [['Overwatch Unpaid', 'camo', '#6b6a5a', '#8f8d77', '#3c3b32'], ['Cold Pizza', 'marble', '#e0c49a', '#b23a2a', '#f2e6cc'], ['Desk Jockey', 'carbon', '#33363c', '#202226', '#55595f'],
    ['Snow Day', 'digital', '#e8eef2', '#9aa6b0', '#5a6670'], ['Rust Bucket', 'splatter', '#7a3f1f', '#a65a2a', '#3a1f10'], ['Tuesday Grey', 'stripes', '#6a6e74', '#4a4e54', '#8a8e94']],
  rocket: [['Lunchbox', 'checker', '#c23a3a', '#e8e0c8', '#5a1a1a'], ['Safety Orange', 'stripes', '#ff7a1a', '#2a2a2a', '#c25a10'], ['Army Surplus', 'camo', '#55603a', '#6f7a4a', '#2f3520'],
    ['Bubble Wrap', 'hex', '#cfe6f2', '#9ac0d6', '#5a8aa6'], ['Fridge Magnet', 'gradient', '#3a7ac2', '#1f4a8a', '#a6d0ff'], ['Mystery Meat', 'marble', '#b06a6a', '#e0b0a0', '#5a2a2a']],
};
const R: Record<string, Row[]> = {
  pistol: [['Chud Royale', 'marble', '#2a1a4a', '#c9a640', '#0c0818'], ['Neon Gremlin', 'circuit', '#0d1a12', '#39ff88', '#0a3a1f'], ['Copium Blue', 'gradient', '#1a4aff', '#00d0ff', '#0a1440'], ['Ratio King', 'tiger', '#1a1a1a', '#ff3a6a', '#4a0a1a']],
  smg: [['Sigma Grindset', 'hex', '#1a1a22', '#ff2a2a', '#3a0a0a'], ['Toxic Waste', 'splatter', '#1a2a0a', '#a6ff00', '#4a6a00'], ['Arcade Carpet', 'checker', '#1a0a3a', '#ff3ad0', '#00e0ff'], ['Vapor Mall', 'gradient', '#ff6ad0', '#6a3aff', '#1a0a3a']],
  shotgun: [['Boomer Bling', 'marble', '#f2e6cc', '#c9a640', '#5a4a1a'], ['Lava Lamp', 'splatter', '#3a0a3a', '#ff6a1a', '#ff2ad0'], ['Cyber Hillbilly', 'circuit', '#1a0a0a', '#ff8a1a', '#3a1a0a'], ['Shark Week', 'tiger', '#1a2a3a', '#e8eef2', '#5a8aa6']],
  sniper: [['Touch Grass Pro', 'camo', '#1a4a1a', '#7aff5a', '#0a2a0a'], ['Glacier Main', 'marble', '#e0f6ff', '#5ac8ff', '#1a4a6a'], ['Midnight Feed', 'carbon', '#0a0a1a', '#3a3aff', '#1a1a4a'], ['Hornet Nest', 'hex', '#1a1a0a', '#ffd21a', '#3a3a0a']],
  rocket: [['Firework Stand', 'stripes', '#c21a1a', '#ffd21a', '#1a3ac2'], ['Big Chungus', 'gradient', '#8a8a9a', '#e0e0f0', '#3a3a4a'], ['Radioactive Rex', 'digital', '#0a1a0a', '#5aff3a', '#1a4a1a'], ['Plasma Pop', 'circuit', '#0a0a2a', '#ff3aff', '#3affff']],
};
const U: Row[] = [
  ['Chudlord Ascended', 'marble', '#1a0a2a', '#ffcc33', '#ff3aff', 'galaxy'],
  ['Prism Gremlin', 'hex', '#101018', '#ffffff', '#80ffff', 'holo'],
  ['Molten Copium', 'tiger', '#1a0500', '#ff5a00', '#ffd21a', 'pulse'],
  ['Void Scope', 'circuit', '#000008', '#00ffd0', '#a03aff', 'glow'],
  ['Mood Ring Boomstick', 'gradient', '#ff3a6a', '#3affb0', '#3a6aff', 'shift'],
];
const U_WEAPON = ['pistol', 'smg', 'shotgun', 'sniper', 'rocket'];

/** Weapons that have a skin set. Add 'knife' / 'ar15' here once those weapons exist (their 55 are generated fresh). */
export const GUN_WEAPONS = ['pistol', 'smg', 'shotgun', 'sniper', 'rocket'] as const;
/** Knife skins are a CS-style special tier (see CASE_ODDS). The set exists now; it only drops once the knife weapon is live. */
export const KNIFE_IN_CASES = true;
export const SKIN_WEAPONS = [...GUN_WEAPONS, 'knife'] as const;
export const PER_WEAPON: Record<Rarity, number> = { common: 30, rare: 20, ultra: 5 };
const PATTERNS: SkinPattern[] = ['camo', 'stripes', 'carbon', 'hex', 'gradient', 'marble', 'digital', 'tiger', 'splatter', 'circuit', 'solid', 'checker'];
const FINISHES: SkinFinish[] = ['matte', 'gloss', 'metal'];
const ALL_FX: SkinFx[] = ['galaxy', 'holo', 'pulse', 'glow', 'shift', 'ember', 'scan'];
// Original Chud-flavoured word lists (no real-game skin names). Names are deduped across the whole catalog.
const ADJ = ['Basement', 'Soggy', 'Turbo', 'Unwashed', 'Discount', 'Feral', 'Crusty', 'Midnight', 'Greasy', 'Lukewarm', 'Certified', 'Budget', 'Rizzless', 'Chonky', 'Haunted', 'Off-Brand',
  'Microwaved', 'Doomscroll', 'Sweaty', 'Unemployed', 'Gas Station', 'Bootleg', 'Mall Cop', 'Suburban', 'Reheated', 'Expired', 'Overclocked', 'Sleepless', 'Grandma\'s', 'Tax Season',
  'Copium', 'Hopium', 'Based', 'Cringe', 'Delulu', 'Goblin', 'Bussin', 'Mid', 'Sus', 'Unhinged', 'Thrift', 'Clearance', 'Parking Lot', 'Corn Maze', 'Laundromat', 'Cul-de-Sac', 'Truck Stop', 'Group Chat'];
const NOUN = ['Gremlin', 'Tendies', 'Hot Pocket', 'Mountain Dew', 'Recliner', 'Fanny Pack', 'Cargo Shorts', 'Crocs', 'Lawnmower', 'Minivan', 'Ramen', 'Nacho', 'Burrito', 'Waffle', 'Pickle', 'Goose',
  'Raccoon', 'Possum', 'Wizard', 'Landlord', 'Intern', 'Main Character', 'NPC', 'Side Quest', 'Patch Notes', 'Loot Goblin', 'Keyboard', 'Mousepad', 'Energy Drink', 'Gamer Chair', 'Hoodie',
  'Dad Joke', 'Group Project', 'Spreadsheet', 'Fax Machine', 'Dial-Up', 'Lava Lamp', 'Beanbag', 'Tamagotchi', 'Lunch Tray', 'Shopping Cart', 'Traffic Cone', 'Porta-Potty', 'Bouncy Castle', 'Kazoo', 'Corndog', 'Meatloaf', 'Casserole'];
const ULTRA_TITLE = ['Ascended', 'Eternal', 'Transcendent', 'Omega', 'Supreme', 'Final Form', 'Unbound', 'Mythic'];

function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (x: string) => { let h = 2166136261; for (const c of x) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const hsl = (h: number, s: number, l: number) => {
  const f = (n: number) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
};
/** Visual identity of a skin on its weapon: pattern + palette bucket + finish. No two skins on one weapon share it. */
export const lookKey = (d: SkinDef) => { const hue = (c: string) => { const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 24) return `g${Math.round(mx / 64)}`; const h = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; return `h${Math.round(h * 2)}`; }; return `${d.pattern}|${d.colors.map(hue).join(',')}|${d.finish ?? 'matte'}`; };

const build = (): SkinDef[] => {
  const out: SkinDef[] = [];
  const names = new Set<string>();
  const add = (w: string, rarity: Rarity, r: Row, i: number) => { names.add(r[0]); out.push({ id: `${rarity[0]}-${w}-${i}`, name: r[0], weapon: w, rarity, pattern: r[1], colors: [r[2], r[3], r[4]], ...(r[5] ? { fx: r[5] } : {}) }); };
  // The original 55 hand-made skins: ids and looks are frozen (players own them).
  for (const [w, rows] of Object.entries(C)) rows.forEach((r, i) => add(w, 'common', r, i));
  for (const [w, rows] of Object.entries(R)) rows.forEach((r, i) => add(w, 'rare', r, i));
  U.forEach((r, i) => add(U_WEAPON[i]!, 'ultra', r, 0));
  // Fill every weapon to exactly 30/20/5 with generated skins (deterministic: same ids/names/looks every build).
  for (const w of SKIN_WEAPONS) {
    const rnd = prng(hashStr(`chud-skins:${w}`));
    const looks = new Set(out.filter((d) => d.weapon === w).map(lookKey));
    const usedFx = new Set(out.filter((d) => d.weapon === w && d.fx).map((d) => d.fx!));
    const fxPool = ALL_FX.filter((f) => !usedFx.has(f)); const rot = SKIN_WEAPONS.indexOf(w) % fxPool.length;
    const fxLeft = [...fxPool.slice(rot), ...fxPool.slice(0, rot)];
    for (const rarity of ['common', 'rare', 'ultra'] as Rarity[]) {
      let i = out.filter((d) => d.weapon === w && d.rarity === rarity).length;
      while (i < PER_WEAPON[rarity]) {
        const pattern = PATTERNS[Math.floor(rnd() * PATTERNS.length)]!;
        const h = rnd() * 360, sat = rarity === 'common' ? 0.15 + rnd() * 0.35 : 0.55 + rnd() * 0.45;
        const colors: [string, string, string] = rarity === 'common'
          ? [hsl(h, sat, 0.25 + rnd() * 0.25), hsl((h + 20 + rnd() * 40) % 360, sat, 0.35 + rnd() * 0.25), hsl(h, sat * 0.6, 0.12 + rnd() * 0.12)]
          : [hsl(h, sat, 0.08 + rnd() * 0.12), hsl((h + 90 + rnd() * 180) % 360, sat, 0.5 + rnd() * 0.15), hsl((h + 30 + rnd() * 60) % 360, sat, 0.3 + rnd() * 0.3)];
        const finish = FINISHES[Math.floor(rnd() * FINISHES.length)]!;
        const fx = rarity === 'ultra' ? fxLeft.shift() : undefined;
        if (rarity === 'ultra' && !fx) throw new Error('not enough ultra effects');
        const noun = NOUN[Math.floor(rnd() * NOUN.length)]!;
        const name = rarity === 'ultra' ? `${noun} ${ULTRA_TITLE[Math.floor(rnd() * ULTRA_TITLE.length)]}` : `${ADJ[Math.floor(rnd() * ADJ.length)]} ${noun}`;
        const d: SkinDef = { id: `${rarity[0]}-${w}-${i}`, name, weapon: w, rarity, pattern, colors, finish, ...(fx ? { fx } : {}) };
        const lk = lookKey(d);
        if (names.has(name) || looks.has(lk)) { if (fx) fxLeft.unshift(fx); continue; }
        names.add(name); looks.add(lk); out.push(d); i++;
      }
    }
  }
  return out;
};

export const SKINS: SkinDef[] = build();
export const SKIN_BY_ID = new Map(SKINS.map((s) => [s.id, s]));

/** Unboxing odds (must sum to 1). Cases drop from Arena matches; opening one uses a case + a key. */
/** Two-step roll: pick a group (gun tier or the knife tier), then for knives a knife rarity. Overall knife Common ≈ gun Ultra. */
export const CASE_ODDS = {
  gun: { common: 0.78, rare: 0.18, ultra: 0.02 } as Record<Rarity, number>,
  knife: 0.02,
  knifeTier: { common: 0.8, rare: 0.175, ultra: 0.025 } as Record<Rarity, number>,
} as const;
/** Flat table of every outcome's overall chance (for the "Odds" button and tests). */
export const CASE_ODDS_TABLE: { group: 'gun' | 'knife'; rarity: Rarity; p: number }[] = [
  ...(['common', 'rare', 'ultra'] as Rarity[]).map((r) => ({ group: 'gun' as const, rarity: r, p: CASE_ODDS.gun[r] })),
  ...(['common', 'rare', 'ultra'] as Rarity[]).map((r) => ({ group: 'knife' as const, rarity: r, p: CASE_ODDS.knife * CASE_ODDS.knifeTier[r] })),
];
export const isKnife = (d: Pick<SkinDef, 'weapon'> | undefined) => d?.weapon === 'knife';
/** Display name: knives get the gold ★. */
export const skinName = (d: SkinDef) => (isKnife(d) ? `★ ${d.name}` : d.name);
/** Every signed-in human who took part in an Arena match gets one drop: 50% case, 50% key. */
export const DROP_CASE_CHANCE = 0.5;
/** Minimum participation for a drop: this long in the match, or at least one kill or death. */
export const DROP_MIN_MS = 60_000;
export type ItemKind = 'skin' | 'case' | 'key';
export const CASE_NAME = 'Chud Case';
export const KEY_NAME = 'Chud Key';

const pickTier = (r: number, t: Record<Rarity, number>): Rarity => (r < t.ultra ? 'ultra' : r < t.ultra + t.rare ? 'rare' : 'common');
const POOLS = new Map<string, SkinDef[]>();
const pool = (knife: boolean, rarity: Rarity) => { const k = `${knife}:${rarity}`; let p = POOLS.get(k); if (!p) POOLS.set(k, (p = SKINS.filter((s) => isKnife(s) === knife && s.rarity === rarity))); return p; };
/** Roll a case: group (gun tiers 78/18/2 or knife 2%), knife rarity 80/17.5/2.5, then uniform within. While knives are not live, the knife branch rerolls. */
export function rollSkin(rng: () => number, knives = KNIFE_IN_CASES): SkinDef {
  for (;;) {
    const r = rng();
    if (r < CASE_ODDS.knife) { if (!knives) continue; const p = pool(true, pickTier(rng(), CASE_ODDS.knifeTier)); return p[Math.min(p.length - 1, Math.floor(rng() * p.length))]!; }
    const g = r - CASE_ODDS.knife; // position within the gun 98%
    const t = CASE_ODDS.gun; const rarity: Rarity = g < t.ultra ? 'ultra' : g < t.ultra + t.rare ? 'rare' : 'common';
    const p = pool(false, rarity); return p[Math.min(p.length - 1, Math.floor(rng() * p.length))]!;
  }
}

export const WEARS = [
  { max: 0.07, name: 'Factory New', short: 'FN' }, { max: 0.15, name: 'Minimal Wear', short: 'MW' }, { max: 0.38, name: 'Field-Tested', short: 'FT' },
  { max: 0.45, name: 'Well-Worn', short: 'WW' }, { max: 1, name: 'Battle-Scarred', short: 'BS' },
] as const;
export const wearOf = (float: number) => WEARS.find((w) => float < w.max) ?? WEARS[WEARS.length - 1]!;

/** An owned item as the client sees it (cases/keys have skin '' and float 0). */
export interface SkinItem { id: string; kind: ItemKind; skin: string; float: number; seed: number; at: number; source: string; equipped: boolean; locked?: boolean }
/** Compact token sent in Arena state so others render your skin: "skinId:seed:float". */
export const skinToken = (i: Pick<SkinItem, 'skin' | 'seed' | 'float'>) => `${i.skin}:${i.seed}:${i.float.toFixed(4)}`;
export function parseToken(t: unknown): { skin: SkinDef; seed: number; float: number } | null {
  if (typeof t !== 'string') return null;
  const [id, s, f] = t.split(':');
  const skin = SKIN_BY_ID.get(id ?? '');
  const seed = Number(s), float = Number(f);
  return skin && Number.isFinite(seed) && Number.isFinite(float) ? { skin, seed, float } : null;
}
