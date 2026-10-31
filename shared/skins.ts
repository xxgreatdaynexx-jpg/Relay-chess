/** Chud Hub weapon skins: static catalog (original, procedural — no external art), wear tiers and case odds. */
export type Rarity = 'common' | 'rare' | 'ultra';
export type SkinPattern = 'camo' | 'stripes' | 'carbon' | 'hex' | 'gradient' | 'marble' | 'digital' | 'tiger' | 'splatter' | 'circuit' | 'solid' | 'checker';
export type SkinFx = 'glow' | 'holo' | 'shift' | 'pulse' | 'galaxy';
/** Weapon ids are strings so later weapons (knife, grenade) can join the catalog without a type change. */
export interface SkinDef { id: string; name: string; weapon: string; rarity: Rarity; pattern: SkinPattern; colors: [string, string, string]; fx?: SkinFx }

export const RARITY_COLOR: Record<Rarity, string> = { common: '#7fa3c9', rare: '#b05cff', ultra: '#ffb21a' };
export const RARITY_NAME: Record<Rarity, string> = { common: 'Common', rare: 'Rare', ultra: 'Ultra' };
export const WEAPON_NAME: Record<string, string> = { pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun', sniper: 'Sniper', rocket: 'RPG', knife: 'Knife', grenade: 'Grenade' };

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

const build = (): SkinDef[] => {
  const out: SkinDef[] = [];
  const add = (w: string, rarity: Rarity, r: Row, i: number) => out.push({ id: `${rarity[0]}-${w}-${i}`, name: r[0], weapon: w, rarity, pattern: r[1], colors: [r[2], r[3], r[4]], ...(r[5] ? { fx: r[5] } : {}) });
  for (const [w, rows] of Object.entries(C)) rows.forEach((r, i) => add(w, 'common', r, i));
  for (const [w, rows] of Object.entries(R)) rows.forEach((r, i) => add(w, 'rare', r, i));
  U.forEach((r, i) => add(U_WEAPON[i]!, 'ultra', r, 0));
  return out;
};
export const SKINS: SkinDef[] = build();
export const SKIN_BY_ID = new Map(SKINS.map((s) => [s.id, s]));

/** Unboxing odds (must sum to 1). Cases drop from Arena matches; opening one uses a case + a key. */
export const CASE_ODDS: Record<Rarity, number> = { common: 0.79, rare: 0.19, ultra: 0.02 };
/** Every signed-in human who took part in an Arena match gets one drop: 50% case, 50% key. */
export const DROP_CASE_CHANCE = 0.5;
/** Minimum participation for a drop: this long in the match, or at least one kill or death. */
export const DROP_MIN_MS = 60_000;
export type ItemKind = 'skin' | 'case' | 'key';
export const CASE_NAME = 'Chud Case';
export const KEY_NAME = 'Chud Key';

/** Pick a rarity then a skin from two uniform [0,1) rolls. */
export function rollSkin(r1: number, r2: number): SkinDef {
  const rarity: Rarity = r1 < CASE_ODDS.ultra ? 'ultra' : r1 < CASE_ODDS.ultra + CASE_ODDS.rare ? 'rare' : 'common';
  const pool = SKINS.filter((s) => s.rarity === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(r2 * pool.length))]!;
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
