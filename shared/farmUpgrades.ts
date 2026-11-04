/**
 * Farm upgrades (request #6): per-plot, owner-bound improvements bought with chips. Pure chip sinks: paid through the
 * atomic wallet + ledger ('farm_upgrade'), priced per tile (base chips, scaled by the price index on the server), and
 * they never bypass the daily farm cap. Fertilizer moved out (#27): it is now a consumable that raises yield (shared/farmWork.ts).
 * Upgrades belong to the owner who bought them; a new owner of the plot starts from scratch.
 */
export type FarmUpgradeKind = 'sprinkler' | 'greenhouse';
export interface FarmUpgradeDef { id: FarmUpgradeKind; label: string; emoji: string; blurb: string; perTile: number[]; effect: (lvl: number) => string }
export const MAX_UPGRADE_LEVEL = 3;
export const FARM_UPGRADES: FarmUpgradeDef[] = [
  { id: 'sprinkler', label: 'Sprinklers', emoji: '💦', blurb: 'Crops grow faster', perTile: [40, 90, 200], effect: (l) => `${l * 10}% faster growth` },
  { id: 'greenhouse', label: 'Greenhouse', emoji: '🏡', blurb: 'Ripe crops last longer', perTile: [25, 60, 140], effect: (l) => `Crops stay ripe ${2 + l}× their grow time` },
];
export const upgradeDef = (k: unknown) => FARM_UPGRADES.find((u) => u.id === k);
export type FarmUpgradeLevels = Record<FarmUpgradeKind, number>;
export const NO_UPGRADES: FarmUpgradeLevels = { sprinkler: 0, greenhouse: 0 };
const lv = (n: number) => Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(n || 0)));
/** Base-chip price of the NEXT level (current level `cur`) for a plot with `tiles` tiles; null at max. Minimum 500. */
export function upgradePrice(kind: FarmUpgradeKind, cur: number, tiles: number): number | null {
  const d = upgradeDef(kind); if (!d || cur >= MAX_UPGRADE_LEVEL || cur < 0) return null;
  return Math.max(500, Math.round((d.perTile[cur]! * tiles) / 50) * 50);
}
/** Grow-time multiplier from Sprinklers (1 = no change). Stacks multiplicatively with the Farming skill perk, floored at 0.5. */
export const sprinklerGrowMul = (l: number) => 1 - 0.1 * lv(l);
export const MIN_GROW_MUL = 0.5;
export const combinedGrowMul = (skillMul: number, sprinkler: number, extra = 1) => Math.max(MIN_GROW_MUL, skillMul * sprinklerGrowMul(sprinkler) * extra);
/** Wither factor with a Greenhouse (base 2). */
export const greenhouseWither = (base: number, l: number) => base + lv(l);
