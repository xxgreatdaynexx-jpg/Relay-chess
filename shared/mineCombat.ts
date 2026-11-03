/**
 * Mine combat (Millionaire Update #13): creatures on floor 3+, weapons and armor from the Weapon Store.
 * Server-authoritative: the server moves creatures, checks every attack (reach, line of sight, weapon cooldown)
 * and applies damage both ways. Pure numbers here so the client and tests share them.
 */
import { MAX_FLOOR } from './mineFloors.js';

export type MobKind = 'slime' | 'bat' | 'crab' | 'golem' | 'wraith';
export interface MobDef { kind: MobKind; name: string; minFloor: number; hp: number; dmg: number; speed: number; attackMs: number; radius: number; z: number; color: string; xp: number }
export const MOBS: Record<MobKind, MobDef> = {
  slime:  { kind: 'slime',  name: 'Cave Slime',   minFloor: 3,  hp: 30,  dmg: 6,  speed: 1.6, attackMs: 1200, radius: 0.45, z: 0.4, color: '#5ad04a', xp: 4 },
  bat:    { kind: 'bat',    name: 'Shaft Bat',    minFloor: 8,  hp: 22,  dmg: 8,  speed: 3.0, attackMs: 1000, radius: 0.35, z: 1.6, color: '#4a3a5a', xp: 6 },
  crab:   { kind: 'crab',   name: 'Rock Crab',    minFloor: 14, hp: 75,  dmg: 12, speed: 1.8, attackMs: 1300, radius: 0.5,  z: 0.4, color: '#8a7a6a', xp: 10 },
  golem:  { kind: 'golem',  name: 'Magma Golem',  minFloor: 22, hp: 160, dmg: 22, speed: 1.4, attackMs: 1600, radius: 0.7,  z: 1.0, color: '#d0502a', xp: 18 },
  wraith: { kind: 'wraith', name: 'Abyss Wraith', minFloor: 31, hp: 120, dmg: 28, speed: 2.8, attackMs: 1100, radius: 0.45, z: 1.3, color: '#a070ff', xp: 25 },
};
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
export const mobCount = (floor: number) => (floor < MOB_FLOOR_MIN ? 0 : Math.min(12, 2 + Math.floor(floor / 3)));
/** Kind for spawn slot i on a floor: weighted toward the newest creature unlocked there. r in [0,1). */
export function mobKindFor(floor: number, r: number): MobKind {
  const open = MOB_ORDER.filter((k) => MOBS[k].minFloor <= floor);
  const w = open.map((_, i) => i + 1); const tot = w.reduce((a, b) => a + b, 0);
  let t = r * tot; for (let i = 0; i < open.length; i++) { t -= w[i]; if (t <= 0) return open[i]; }
  return open[open.length - 1];
}
/** Ore pieces a kill drops (rolled from the floor's ore mix): 1 + 1 per 10 floors. */
export const lootCount = (floor: number) => 1 + Math.floor(Math.min(MAX_FLOOR, floor) / 10);

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
