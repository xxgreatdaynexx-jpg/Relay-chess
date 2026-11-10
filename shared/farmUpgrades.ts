/**
 * Farm upgrades (request #6): per-plot, owner-bound improvements bought with chips. Pure chip sinks: paid through the
 * atomic wallet + ledger ('farm_upgrade'), priced per tile (base chips, scaled by the price index on the server), and
 * extra crops from Fertilizer pay the normal sell price (no extra markup).
 * Upgrades belong to the owner who bought them; a new owner of the plot starts from scratch.
 */
export type FarmUpgradeKind = 'sprinkler' | 'fertilizer' | 'greenhouse';
export interface FarmUpgradeDef { id: FarmUpgradeKind; label: string; emoji: string; blurb: string; perTile: number[]; effect: (lvl: number) => string }
export const MAX_UPGRADE_LEVEL = 3;
export const FARM_UPGRADES: FarmUpgradeDef[] = [
  { id: 'sprinkler', label: 'Sprinklers', emoji: '💦', blurb: 'Crops grow faster', perTile: [40, 90, 200], effect: (l) => `${l * 10}% faster growth` },
  { id: 'fertilizer', label: 'Fertilizer', emoji: '🧪', blurb: 'Bigger harvest yield', perTile: [50, 120, 260], effect: (l) => `+${l * 10}% crop yield` },
  { id: 'greenhouse', label: 'Greenhouse', emoji: '🏡', blurb: 'Ripe crops last longer', perTile: [25, 60, 140], effect: (l) => `Crops stay ripe ${2 + l}× their grow time` },
];
export const upgradeDef = (k: unknown) => FARM_UPGRADES.find((u) => u.id === k);
export type FarmUpgradeLevels = Record<FarmUpgradeKind, number>;
export const NO_UPGRADES: FarmUpgradeLevels = { sprinkler: 0, fertilizer: 0, greenhouse: 0 };
const lv = (n: number) => Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(n || 0)));
/** Base-chip price of the NEXT level (current level `cur`) for a plot with `tiles` tiles; null at max. Minimum 500. */
export function upgradePrice(kind: FarmUpgradeKind, cur: number, tiles: number): number | null {
  const d = upgradeDef(kind); if (!d || cur >= MAX_UPGRADE_LEVEL || cur < 0) return null;
  return Math.max(500, Math.round((d.perTile[cur]! * tiles) / 50) * 50);
}
/** Grow-time multiplier from Sprinklers (1 = no change). Stacks multiplicatively with the Farming skill perk, floored at 0.5. */
export const sprinklerGrowMul = (l: number) => 1 - 0.1 * lv(l);
export const MIN_GROW_MUL = 0.5;
export const combinedGrowMul = (skillMul: number, sprinkler: number) => Math.max(MIN_GROW_MUL, skillMul * sprinklerGrowMul(sprinkler));
/** Fractional yield bonus from Fertilizer: +10% / +20% / +30% more crops at levels 1–3 (pt2093u). Same strength as the old profit %). */
export const fertilizerYieldBonus = (l: number) => 0.1 * lv(l);
/**
 * Crops harvested from one planted tile given a fractional yield bonus.
 * Floor + a stable fractional chance derived from `salt` (tile nonce) so a failed/retried harvest cannot re-roll the bonus.
 */
export function yieldQty(bonus: number, salt: string): number {
  const y = 1 + Math.max(0, Number.isFinite(bonus) ? bonus : 0);
  const whole = Math.floor(y + 1e-12);
  const frac = y - whole;
  if (frac <= 1e-12) return Math.max(1, whole);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < salt.length; i++) { h ^= salt.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const u = (h % 10_000) / 10_000;
  return whole + (u < frac ? 1 : 0);
}
/** @deprecated Use fertilizerYieldBonus; kept only so old imports fail loudly in review — prefer yield. */
export const fertilizerProfitMul = (l: number) => 1 + fertilizerYieldBonus(l);
/** Wither factor with a Greenhouse (base 2). */
export const greenhouseWither = (base: number, l: number) => base + lv(l);
