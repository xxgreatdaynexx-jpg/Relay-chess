/**
 * High-stakes casino tables (Billionaire Update). Same games and house rules as the classic tables; only the
 * min/max bets change. A player picks a tier and sits at a table of that tier.
 */
export type BjStakesId = 'classic' | 'high' | 'whale';
export interface BjStakes { id: BjStakesId; label: string; min: number; max: number; bets: number[] }
export const BJ_STAKES: readonly BjStakes[] = [
  { id: 'classic', label: 'Classic', min: 1, max: 5_000, bets: [1, 5, 25, 50, 100, 500, 1_000, 5_000] },
  { id: 'high', label: 'High Stakes', min: 1_000, max: 100_000, bets: [1_000, 5_000, 10_000, 25_000, 50_000, 100_000] },
  { id: 'whale', label: 'Whale', min: 10_000, max: 1_000_000, bets: [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] },
];
export const bjStakes = (id: unknown): BjStakes => BJ_STAKES.find((x) => x.id === id) ?? BJ_STAKES[0]!;

export type RlStakesId = 'classic' | 'high';
export interface RlStakes { id: RlStakesId; label: string; maxChip: number; maxSpin: number; chips: number[] }
export const RL_STAKES: readonly RlStakes[] = [
  { id: 'classic', label: 'Classic', maxChip: 10_000, maxSpin: 20_000, chips: [1, 5, 25, 50, 100, 500, 1_000] },
  { id: 'high', label: 'High Limit', maxChip: 250_000, maxSpin: 1_000_000, chips: [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000] },
];
export const rlStakes = (id: unknown): RlStakes => RL_STAKES.find((x) => x.id === id) ?? RL_STAKES[0]!;

export type VpStakesId = 'classic' | 'high';
export interface VpStakes { id: VpStakesId; label: string; min: number; max: number; bets: number[] }
export const VP_STAKES: readonly VpStakes[] = [
  { id: 'classic', label: 'Classic', min: 1, max: 500, bets: [5, 10, 25, 50, 100, 500] },
  { id: 'high', label: 'High Stakes', min: 100, max: 50_000, bets: [100, 500, 1_000, 5_000, 10_000, 25_000, 50_000] },
];
export const vpStakes = (id: unknown): VpStakes => VP_STAKES.find((x) => x.id === id) ?? VP_STAKES[0]!;
