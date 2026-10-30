/** Video poker (Jacks or Better) and slots: pure rules shared by server and client. Play money only. */
import type { CasinoCard } from './casino.js';

export const POKER_MIN_BET = 1;
export const POKER_MAX_BET = 500;
export const SLOTS_MIN_BET = 1;
export const SLOTS_MAX_BET = 200;

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

// ---- Slots ----
export const SLOT_SYMBOLS = ['cherry', 'lemon', 'bell', 'star', 'seven', 'gem'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
export const SLOT_EMOJI: Record<SlotSymbol, string> = { cherry: '🍒', lemon: '🍋', bell: '🔔', star: '⭐', seven: '7️⃣', gem: '💎' };
/** Weights per reel (out of 32 stops). */
export const SLOT_WEIGHTS: Record<SlotSymbol, number> = { cherry: 10, lemon: 8, bell: 6, star: 4, seven: 3, gem: 1 };
/** Three of a kind pays (return multiple). */
export const SLOT_TRIPLE: Record<SlotSymbol, number> = { cherry: 5, lemon: 12, bell: 25, star: 50, seven: 120, gem: 1000 };
export const SLOT_TWO_CHERRY = 1;
export const SLOT_ONE_CHERRY = 0;

export function slotMultiplier(reels: SlotSymbol[]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOT_TRIPLE[a!];
  const cherries = reels.filter((s) => s === 'cherry').length;
  if (cherries === 2) return SLOT_TWO_CHERRY;
  if (cherries === 1 && a === 'cherry') return SLOT_ONE_CHERRY;
  return 0;
}

export function pickSymbol(r: number): SlotSymbol {
  const total = Object.values(SLOT_WEIGHTS).reduce((x, y) => x + y, 0);
  let t = r * total;
  for (const s of SLOT_SYMBOLS) {
    t -= SLOT_WEIGHTS[s];
    if (t < 0) return s;
  }
  return SLOT_SYMBOLS[0];
}

/** Exact expected return per chip staked. */
export function slotsRtp(): number {
  const total = Object.values(SLOT_WEIGHTS).reduce((x, y) => x + y, 0);
  let ev = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
    ev += (SLOT_WEIGHTS[a] * SLOT_WEIGHTS[b] * SLOT_WEIGHTS[c]) / total ** 3 * slotMultiplier([a, b, c]);
  }
  return ev;
}
