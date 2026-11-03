/**
 * Fishing upgrades (request #28, chessguy2): bait tiers and fly tiers bought at the dock, like the mines' pickaxes.
 * Owned forever (Postgres fish_gear), one bait and one fly equipped at a time. Pure chip sinks: bought through the
 * atomic wallet + ledger ('fish_gear'), priced in base chips (× price index on the server). Effects, applied server-side
 * when you cast:
 *  - bait shifts the rarity roll toward rarer fish (stacks with the Fishing perk; total luck capped at MAX_BAIT_LUCK),
 *    so better bait means fewer boots and more of the tiny rare-fish percentages.
 *  - flies make bites come faster (bite-time multiplier) but the fish fights harder (reel difficulty added).
 * Rod skins are cosmetic and come from Chud Cases (weapon 'rod' in shared/skins.ts).
 */
export type FishGearKind = 'bait' | 'fly';
export interface FishGearDef { id: string; kind: FishGearKind; name: string; tier: number; price: number; luck: number; biteMul: number; diffAdd: number; emoji: string; blurb: string }
export const FISH_BAITS: FishGearDef[] = [
  { id: 'worm', kind: 'bait', name: 'Garden Worm', tier: 0, price: 0, luck: 0, biteMul: 1, diffAdd: 0, emoji: '🪱', blurb: 'The free starter bait.' },
  { id: 'cricket', kind: 'bait', name: 'Cricket', tier: 1, price: 3_000, luck: 0.04, biteMul: 1, diffAdd: 0, emoji: '🦗', blurb: 'Rarer fish +4% (fewer boots).' },
  { id: 'minnow', kind: 'bait', name: 'Live Minnow', tier: 2, price: 12_000, luck: 0.08, biteMul: 1, diffAdd: 0, emoji: '🐟', blurb: 'Rarer fish +8%.' },
  { id: 'glowcrawler', kind: 'bait', name: 'Glow Crawler', tier: 3, price: 40_000, luck: 0.12, biteMul: 1, diffAdd: 0, emoji: '✨', blurb: 'Rarer fish +12%.' },
  { id: 'golden_lure', kind: 'bait', name: 'Golden Lure', tier: 4, price: 120_000, luck: 0.18, biteMul: 1, diffAdd: 0, emoji: '🏅', blurb: 'Rarer fish +18%. Legends love shiny things.' },
];
export const FISH_FLIES: FishGearDef[] = [
  { id: 'no_fly', kind: 'fly', name: 'Plain Hook', tier: 0, price: 0, luck: 0, biteMul: 1, diffAdd: 0, emoji: '🪝', blurb: 'No fly. Normal bites, normal fight.' },
  { id: 'dry_fly', kind: 'fly', name: 'Dry Fly', tier: 1, price: 5_000, luck: 0, biteMul: 0.85, diffAdd: 0.04, emoji: '🪰', blurb: 'Bites 15% faster, fish fight a bit harder.' },
  { id: 'streamer', kind: 'fly', name: 'Streamer', tier: 2, price: 20_000, luck: 0, biteMul: 0.7, diffAdd: 0.08, emoji: '🎏', blurb: 'Bites 30% faster, harder reel.' },
  { id: 'popper', kind: 'fly', name: 'Popper', tier: 3, price: 60_000, luck: 0, biteMul: 0.55, diffAdd: 0.12, emoji: '🎯', blurb: 'Bites 45% faster, much harder reel.' },
];
export const FISH_GEAR = [...FISH_BAITS, ...FISH_FLIES];
export const DEFAULT_BAIT = 'worm', DEFAULT_FLY = 'no_fly';
/** Total rarity luck (Fishing perk + bait) never exceeds this share of the remaining roll. */
export const MAX_BAIT_LUCK = 0.25;
export const gearDef = (id: unknown) => FISH_GEAR.find((g) => g.id === id);
export const isFishGear = (id: unknown): id is string => !!gearDef(id);
export const gearTiers = (kind: FishGearKind) => (kind === 'bait' ? FISH_BAITS : FISH_FLIES);
export const defaultGear = (kind: FishGearKind) => (kind === 'bait' ? DEFAULT_BAIT : DEFAULT_FLY);
/** Gear unlocks in order within its kind: you need the previous tier first. */
export const canBuyGear = (owned: readonly string[], id: string) => {
  const d = gearDef(id); if (!d || d.tier === 0 || owned.includes(id)) return false;
  return d.tier === 1 || owned.includes(gearTiers(d.kind)[d.tier - 1]!.id);
};
/** Rarity roll with the bait's luck on top of the perk-adjusted roll (same shape as fishingLuckRoll). */
export const baitLuckRoll = (u: number, baseRolled: number, bait: unknown) => {
  const extra = gearDef(bait)?.luck ?? 0; if (!extra) return baseRolled; const perk = u >= 1 ? 0 : (baseRolled - u) / (1 - u);
  const total = Math.min(MAX_BAIT_LUCK, Math.max(perk, 0) + extra);
  return Math.min(0.999999, u + (1 - u) * total);
};
export interface FishGearView { owned: string[]; bait: string; fly: string; prices: Record<string, number>; rodSkin?: string | null }
