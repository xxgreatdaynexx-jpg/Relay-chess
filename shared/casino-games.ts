/** Video poker (Jacks or Better): pure rules shared by server and client. Play money only. */
import type { CasinoCard } from './casino.js';

export const POKER_MIN_BET = 1;
export const POKER_MAX_BET = 500;

export type PokerHand = 'royal' | 'straight-flush' | 'four' | 'full-house' | 'flush' | 'straight' | 'three' | 'two-pair' | 'jacks' | 'nothing';

/** Return multiple of the stake (1 = stake back). 9/6 Jacks or Better. */
export const POKER_PAYS: Record<PokerHand, number> = {
  royal: 800, 'straight-flush': 50, four: 25, 'full-house': 9, flush: 6, straight: 4, three: 3, 'two-pair': 2, jacks: 1, nothing: 0,
};
export const POKER_LABELS: Record<PokerHand, string> = {
  royal: 'Royal flush', 'straight-flush': 'Straight flush', four: 'Four of a kind', 'full-house': 'Full house', flush: 'Flush', straight: 'Straight', three: 'Three of a kind', 'two-pair': 'Two pair', jacks: 'Jacks or better', nothing: 'No win',
};

export function evaluatePoker(cards: Pick<CasinoCard, 'rank' | 'suit'>[]): PokerHand {
  if (cards.length !== 5) throw new Error('Need five cards.');
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const groups = [...counts.values()].sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const royalRanks = ranks.join() === '1,10,11,12,13';
  const straight = counts.size === 5 && (ranks[4]! - ranks[0]! === 4 || royalRanks);
  if (straight && flush) return royalRanks ? 'royal' : 'straight-flush';
  if (groups[0] === 4) return 'four';
  if (groups[0] === 3 && groups[1] === 2) return 'full-house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (groups[0] === 3) return 'three';
  if (groups[0] === 2 && groups[1] === 2) return 'two-pair';
  if (groups[0] === 2) {
    const pair = [...counts].find(([, n]) => n === 2)![0];
    if (pair === 1 || pair >= 11) return 'jacks';
  }
  return 'nothing';
}

export interface PokerView {
  phase: 'idle' | 'dealt';
  cards: CasinoCard[];
  bet: number;
  result?: { hand: PokerHand; label: string; returned: number; net: number };
  chips: number;
}

