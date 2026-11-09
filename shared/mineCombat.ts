/**
 * Mine combat (Millionaire Update #13): creatures on floor 3+, weapons and armor from the Weapon Store.
 * Server-authoritative: the server moves creatures, checks every attack (reach, line of sight, weapon cooldown)
 * and applies damage both ways. Pure numbers here so the client and tests share them.
 */
import { MAX_FLOOR } from './mineFloors.js';
import type { CaveId } from './mines.js';

export type MobKind = 'slime' | 'bat' | 'crab' | 'golem' | 'wraith' | 'boss';
export interface MobDef { kind: MobKind; name: string; minFloor: number; hp: number; dmg: number; speed: number; attackMs: number; radius: number; z: number; color: string; xp: number }
export const MOBS: Record<MobKind, MobDef> = {
  slime:  { kind: 'slime',  name: 'Cave Slime',   minFloor: 3,  hp: 30,  dmg: 6,  speed: 1.6, attackMs: 1200, radius: 0.45, z: 0.4, color: '#5ad04a', xp: 4 },
  bat:    { kind: 'bat',    name: 'Shaft Bat',    minFloor: 8,  hp: 22,  dmg: 8,  speed: 3.0, attackMs: 1000, radius: 0.35, z: 1.6, color: '#4a3a5a', xp: 6 },
  crab:   { kind: 'crab',   name: 'Rock Crab',    minFloor: 14, hp: 75,  dmg: 12, speed: 1.8, attackMs: 1300, radius: 0.5,  z: 0.4, color: '#8a7a6a', xp: 10 },
  golem:  { kind: 'golem',  name: 'Magma Golem',  minFloor: 22, hp: 160, dmg: 22, speed: 1.4, attackMs: 1600, radius: 0.7,  z: 1.0, color: '#d0502a', xp: 18 },
  wraith: { kind: 'wraith', name: 'Abyss Wraith', minFloor: 31, hp: 120, dmg: 28, speed: 2.8, attackMs: 1100, radius: 0.45, z: 1.3, color: '#a070ff', xp: 25 },
  // Nov 4: one boss per floor on the deepest floors (BOSS_FLOOR+), same stats in every mine.
  boss:   { kind: 'boss',   name: 'Deep Boss',    minFloor: 37, hp: 520, dmg: 34, speed: 1.5, attackMs: 1500, radius: 0.9,  z: 1.4, color: '#ff3a2a', xp: 80 },
};
export const BOSS_FLOOR = 37;
/** Kind for spawn slot i: slot 0 on the deepest floors is the mine's boss, otherwise the tiered pick. */
export const mobKindAt = (floor: number, slot: number, r: number): MobKind => (floor >= BOSS_FLOOR && slot === 0 ? 'boss' : mobKindFor(floor, r));

/**
 * Themed creatures (Nov 4): every mine dresses the same stat tiers (MOBS: HP/damage/speed per depth are identical in
 * every mine) in its own creatures. `model` picks the procedural rig in client/src/lib/mines3d.ts.
 */
export type MobModel = 'blob' | 'bat' | 'golem' | 'wraith' | 'wolf' | 'elemental' | 'yeti' | 'slug' | 'imp' | 'crab' | 'eel' | 'jelly' | 'kraken' | 'drillbot' | 'gaswraith';
export interface MobSkin { name: string; model: MobModel; color: string; accent: string; scale: number }
const K = (name: string, model: MobModel, color: string, accent: string, scale = 1): MobSkin => ({ name, model, color, accent, scale });
export const MOB_SKINS: Record<CaveId, Record<MobKind, MobSkin>> = {
  mine: {
    slime: K('Cave Slime', 'blob', '#5ad04a', '#1e6a14'), bat: K('Shaft Bat', 'bat', '#4a3a5a', '#2a2030'),
    crab: K('Pebble Golem', 'golem', '#8a8580', '#c9b48a', 0.7), golem: K('Rock Golem', 'golem', '#7a726a', '#ffd070'),
    wraith: K('Vampire Bat', 'bat', '#6a1a2a', '#2a0810', 1.6), boss: K('Granite Colossus', 'golem', '#9a948c', '#ff7040', 1.9),
  },
  frost: {
    slime: K('Frost Pup', 'wolf', '#cfe4f0', '#7aa0b8', 0.7), bat: K('Ice Wisp', 'elemental', '#bfeaff', '#4ab8ff', 0.7),
    crab: K('Frost Wolf', 'wolf', '#e8f2f8', '#5a7a90'), golem: K('Yeti', 'yeti', '#f4f8fb', '#4a6a80'),
    wraith: K('Ice Elemental', 'elemental', '#8fd8ff', '#ffffff'), boss: K('Yeti King', 'yeti', '#ffffff', '#3ac0ff', 1.7),
  },
  magma: {
    slime: K('Lava Slug', 'slug', '#ff6a1a', '#3a1608'), bat: K('Fire Imp', 'imp', '#d8301a', '#ffd040'),
    crab: K('Cinder Slug', 'slug', '#2a1a14', '#ff8a20', 1.3), golem: K('Magma Golem', 'golem', '#d0502a', '#ffb040'),
    wraith: K('Imp Warlock', 'imp', '#7a1010', '#ff40a0', 1.35), boss: K('Magma Titan', 'golem', '#4a1a10', '#ffcc30', 1.9),
  },
  coral: {
    slime: K('Moon Jellyfish', 'jelly', '#ff8ad8', '#ffffff'), bat: K('Reef Eel', 'eel', '#3a8a5a', '#e8e060'),
    crab: K('Coral Crab', 'crab', '#e8603a', '#7a2a14'), golem: K('Giant Spider Crab', 'crab', '#b0402a', '#f0d0a0', 1.5),
    wraith: K('Abyssal Eel', 'eel', '#202a50', '#40f0ff', 1.4), boss: K('The Kraken', 'kraken', '#7a2a6a', '#ffcc40', 1.6),
  },
  fortmc: {
    slime: K('Oil Sludge Blob', 'blob', '#14100c', '#6a4a20'), bat: K('Survey Drone', 'drillbot', '#f2b630', '#2a2a2e', 0.6),
    crab: K('Rogue Drill Bot', 'drillbot', '#e8a020', '#3a3a40'), golem: K('Sludge Hulk', 'blob', '#2a2016', '#c0a040', 1.7),
    wraith: K('Gas Wraith', 'gaswraith', '#9ad050', '#e8ff80'), boss: K('The Mega Driller', 'drillbot', '#c03020', '#ffd040', 1.9),
  },
  // Stone Quarry has no hostiles (mobCount 0); skins exist so CaveId records stay exhaustive.
  quarry: {
    slime: K('Dust Mite', 'blob', '#b0a090', '#6a6050'), bat: K('Pebble Bat', 'bat', '#8a8070', '#4a4030'),
    crab: K('Gravel Crab', 'crab', '#a09888', '#5a5040'), golem: K('Quarry Golem', 'golem', '#9a948c', '#c9b48a'),
    wraith: K('Silica Wisp', 'elemental', '#d8d0c0', '#ffffff'), boss: K('Bedrock Titan', 'golem', '#7a746c', '#d0c8b0', 1.8),
  },
};
export const mobSkin = (cave: CaveId, kind: MobKind): MobSkin => MOB_SKINS[cave]?.[kind] ?? MOB_SKINS.mine[kind];
export const MOB_ORDER: MobKind[] = ['slime', 'bat', 'crab', 'golem', 'wraith'];
export const MOB_FLOOR_MIN = 3;
export const MOB_RESPAWN_MS = 90_000;
export const MOB_AGGRO = 10;      // units: notices you within this (with line of sight)
export const MOB_REACH = 1.3;     // centre-to-player distance for a creature's hit
/** Creatures never enter the lift: it's the safe zone (x below this). */
export const SAFE_X = 8.5;
/** Stats grow 6% per floor past the creature's first floor. */
export const mobScale = (kind: MobKind, floor: number) => 1 + 0.06 * Math.max(0, floor - MOBS[kind].minFloor);
export const mobHp = (kind: MobKind, floor: number) => Math.round(MOBS[kind].hp * mobScale(kind, floor));
export const mobDmg = (kind: MobKind, floor: number) => Math.round(MOBS[kind].dmg * mobScale(kind, floor));
/** Kind for spawn slot i on a floor: weighted toward the newest creature unlocked there. r in [0,1). */
export function mobKindFor(floor: number, r: number): MobKind {
  const open = MOB_ORDER.filter((k) => MOBS[k].minFloor <= floor);
  const w = open.map((_, i) => i + 1); const tot = w.reduce((a, b) => a + b, 0);
  let t = r * tot; for (let i = 0; i < open.length; i++) { t -= w[i]; if (t <= 0) return open[i]; }
  return open[open.length - 1];
}
/** Ore pieces a kill drops (rolled from the floor's ore mix).
 *  Depth-scaled enemy drops (Conner): 1 on floors 1–5, then +1 every 5 floors (floor 40 → 8).
 *  Early floors are unchanged vs the old 1-per-10 curve through floor 10; deeper floors scale up.
 *  Soft cap 12. Kind bonus: golem/wraith +25% (ceil), boss +50% (ceil). */
export const lootCount = (floor: number) => {
  const f = Math.min(MAX_FLOOR, Math.max(1, Math.floor(Number(floor) || 1)));
  return 1 + Math.floor((f - 1) / 5);
};
export const lootCountFor = (kind: MobKind, floor: number) => {
  const n = lootCount(floor);
  if (kind === 'boss') return Math.min(12, n + Math.ceil(n / 2));
  if (kind === 'golem' || kind === 'wraith') return Math.min(12, n + Math.ceil(n / 4));
  return n;
};
/** Depth fed to oreFor for kill loot: starts at the historic 3, then +1 per 10 floors (richer deep rolls, no early nerf). */
export const lootOreDepth = (floor: number) => 3 + Math.floor((Math.min(MAX_FLOOR, Math.max(1, Math.floor(Number(floor) || 1))) - 1) / 10);
/** No creatures in the Stone Quarry (manual stone only). */
export const mobCount = (floor: number, cave?: CaveId) => {
  if (cave === 'quarry') return 0;
  return floor < MOB_FLOOR_MIN ? 0 : Math.min(12, 2 + Math.floor(floor / 3));
};

// ---- player
export const PLAYER_BASE_HP = 100;
export const REGEN_AFTER_MS = 6000; // out of combat this long → regen
export const REGEN_PER_S = 2;
/** Dying: you drop this share (rounded up) of every carried stack. Banked items, chips and gear are never lost. */
export const DEATH_LOSS = 0.5;
export const lostOnDeath = (qty: number) => Math.ceil(qty * DEATH_LOSS);

// ---- Weapon Store (owned forever, one weapon + one armor equipped). Prices in base chips × daily price index.
export type WeaponId = 'rusty_sword' | 'copper_sword' | 'iron_sword' | 'steel_claymore' | 'crystal_blade' | 'diamond_saber';
export type ArmorId = 'none' | 'leather_vest' | 'iron_helm' | 'chainmail' | 'crystal_plate';
export interface WeaponDef { id: WeaponId; name: string; icon: string; tier: number; price: number; dmg: number; ms: number; reach: number }
export interface ArmorDef { id: ArmorId; name: string; icon: string; tier: number; price: number; hp: number; def: number }
export const WEAPONS: WeaponDef[] = [
  { id: 'rusty_sword',    name: 'Rusty Sword',    icon: '🗡️', tier: 0, price: 0,       dmg: 10, ms: 550, reach: 2.4 },
  { id: 'copper_sword',   name: 'Copper Sword',   icon: '🗡️', tier: 1, price: 4_000,   dmg: 16, ms: 500, reach: 2.4 },
  { id: 'iron_sword',     name: 'Iron Sword',     icon: '⚔️', tier: 2, price: 15_000,  dmg: 26, ms: 500, reach: 2.5 },
  { id: 'steel_claymore', name: 'Steel Claymore', icon: '⚔️', tier: 3, price: 40_000,  dmg: 42, ms: 650, reach: 2.9 },
  { id: 'crystal_blade',  name: 'Crystal Blade',  icon: '🔮', tier: 4, price: 100_000, dmg: 60, ms: 450, reach: 2.6 },
  { id: 'diamond_saber',  name: 'Diamond Saber',  icon: '💎', tier: 5, price: 250_000, dmg: 90, ms: 420, reach: 2.7 },
];
export const ARMORS: ArmorDef[] = [
  { id: 'none',          name: 'No Armor',      icon: '👕', tier: 0, price: 0,       hp: 0,   def: 0 },
  { id: 'leather_vest',  name: 'Leather Vest',  icon: '🦺', tier: 1, price: 3_000,   hp: 30,  def: 0.05 },
  { id: 'iron_helm',     name: 'Iron Helm',     icon: '⛑️', tier: 2, price: 12_000,  hp: 60,  def: 0.1 },
  { id: 'chainmail',     name: 'Chainmail',     icon: '🛡️', tier: 3, price: 35_000,  hp: 100, def: 0.15 },
  { id: 'crystal_plate', name: 'Crystal Plate', icon: '💠', tier: 4, price: 120_000, hp: 160, def: 0.25 },
];
export const weaponDef = (id: unknown): WeaponDef => WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
export const armorDef = (id: unknown): ArmorDef => ARMORS.find((a) => a.id === id) ?? ARMORS[0];
export const isWeapon = (id: unknown): id is WeaponId => WEAPONS.some((w) => w.id === id);
export const isArmor = (id: unknown): id is ArmorId => ARMORS.some((a) => a.id === id);
export const maxHpOf = (armor: ArmorId) => PLAYER_BASE_HP + armorDef(armor).hp;
/** Damage a creature hit does through armor (at least 1). */
export const hitThrough = (dmg: number, armor: ArmorId) => Math.max(1, Math.round(dmg * (1 - armorDef(armor).def)));
/** Buy in order within each list (like mining tools): you need the previous tier first. */
export function canBuyGear(kind: 'weapon' | 'armor', id: string, owned: string[]): boolean {
  const list: Array<{ id: string; tier: number }> = kind === 'weapon' ? WEAPONS : ARMORS;
  const d = list.find((x) => x.id === id); if (!d || d.tier === 0 || owned.includes(id)) return false;
  const prev = list.find((x) => x.tier === d.tier - 1)!;
  return prev.tier === 0 || owned.includes(prev.id);
}
export interface GearView { owned: string[]; weapon: WeaponId; armor: ArmorId; prices: Record<string, number>; deepest: number; signedIn: boolean }
