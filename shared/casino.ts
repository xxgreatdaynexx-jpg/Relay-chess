/** Shared casino types (play money only). */
export type Suit = 'S' | 'H' | 'D' | 'C';
export interface CasinoCard {
  id: string;
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

export type BJOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'dealer-blackjack';

export interface BJHandView {
  cards: CasinoCard[];
  bet: number;
  doubled: boolean;
  done: boolean;
  outcome: BJOutcome | null;
  /** Net chips for this hand after settling. */
  net: number;
}

export interface BJSeatView {
  seat: number;
  name: string;
  bet: number;
  hands: BJHandView[];
  active: number | null;
  chips: number;
}

export interface BJTableView {
  id: string;
  phase: 'waiting' | 'betting' | 'playing' | 'dealer' | 'settled';
  /** When the current phase or turn ends (server ms). */
  deadline: number | null;
  serverNow: number;
  dealer: CasinoCard[];
  seats: BJSeatView[];
  /** Seat whose turn it is. */
  turn: number | null;
  you: number | null;
  maxSeats: number;
}

export interface CasinoStanding {
  /** QA test account (only ever sent to signed-in QA viewers). */
  qa?: boolean;
  name: string;
  chips: number;
  netWon: number;
  hands: number;
  spins: number;
  biggestWin: number;
}

export function cardValue(rank: number): number {
  return rank === 1 ? 11 : Math.min(rank, 10);
}

export function handValue(cards: { rank: number; faceUp?: boolean }[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.faceUp === false) continue;
    total += cardValue(c.rank);
    if (c.rank === 1) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards: { rank: number }[]) => cards.length === 2 && handValue(cards).total === 21;

/* ---------------- Roulette ---------------- */

export type RouletteKind =
  | 'straight' | 'split' | 'street' | 'corner' | 'line'
  | 'dozen' | 'column' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high';

export interface RouletteBet {
  kind: RouletteKind;
  /** Covered numbers (inside bets) or the index for dozen/column (1–3). */
  numbers: number[];
  amount: number;
}

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
/** European wheel order, clockwise from 0. */
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const CHIP_VALUES = [5, 25, 100, 500];
export const MAX_ROULETTE_STAKE = 10_000;

const INSIDE_SIZE: Partial<Record<RouletteKind, number>> = { straight: 1, split: 2, street: 3, corner: 4, line: 6 };

/** Payout odds (X to 1). */
export function payoutOdds(kind: RouletteKind): number {
  switch (kind) {
    case 'straight': return 35;
    case 'split': return 17;
    case 'street': return 11;
    case 'corner': return 8;
    case 'line': return 5;
    case 'dozen':
    case 'column': return 2;
    default: return 1;
  }
}

const row = (n: number) => Math.ceil(n / 3); // 1..12
const col = (n: number) => ((n - 1) % 3) + 1; // 1..3

/** Normalizes and validates a bet's geometry. Returns sorted numbers or null when invalid. */
export function validateRouletteBet(bet: unknown): RouletteBet | null {
  if (!bet || typeof bet !== 'object') return null;
  const b = bet as Record<string, unknown>;
  const kind = b.kind as RouletteKind;
  const amount = b.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_ROULETTE_STAKE) return null;
  if (!Array.isArray(b.numbers) || b.numbers.some((n) => typeof n !== 'number' || !Number.isInteger(n))) return null;
  const nums = [...new Set(b.numbers as number[])].sort((x, y) => x - y);
  const size = INSIDE_SIZE[kind];
  if (size !== undefined) {
    if (nums.length !== size || nums.some((n) => n < 0 || n > 36)) return null;
    if (!insideOk(kind, nums)) return null;
    return { kind, numbers: nums, amount };
  }
  if (kind === 'dozen' || kind === 'column') {
    if (nums.length !== 1 || nums[0]! < 1 || nums[0]! > 3) return null;
    return { kind, numbers: nums, amount };
  }
  if (['red', 'black', 'odd', 'even', 'low', 'high'].includes(kind)) {
    if (nums.length !== 0) return null;
    return { kind, numbers: [], amount };
  }
  return null;
}

function insideOk(kind: RouletteKind, n: number[]): boolean {
  const hasZero = n[0] === 0;
  switch (kind) {
    case 'straight':
      return true;
    case 'split': {
      const [a, b] = n as [number, number];
      if (hasZero) return b >= 1 && b <= 3;
      return (b - a === 1 && row(a) === row(b)) || b - a === 3;
    }
    case 'street': {
      if (hasZero) return (n[1] === 1 && n[2] === 2) || (n[1] === 2 && n[2] === 3);
      return col(n[0]!) === 1 && n[1] === n[0]! + 1 && n[2] === n[0]! + 2;
    }
    case 'corner': {
      if (hasZero) return n[1] === 1 && n[2] === 2 && n[3] === 3; // "first four"
      const a = n[0]!;
      return col(a) !== 3 && n[1] === a + 1 && n[2] === a + 3 && n[3] === a + 4;
    }
    case 'line': {
      const a = n[0]!;
      if (hasZero || col(a) !== 1 || a > 31) return false;
      return n.every((x, i) => x === a + i);
    }
    default:
      return false;
  }
}

export function betWins(bet: RouletteBet, result: number): boolean {
  switch (bet.kind) {
    case 'dozen': return result > 0 && Math.ceil(result / 12) === bet.numbers[0];
    case 'column': return result > 0 && col(result) === bet.numbers[0];
    case 'red': return RED.has(result);
    case 'black': return result > 0 && !RED.has(result);
    case 'odd': return result > 0 && result % 2 === 1;
    case 'even': return result > 0 && result % 2 === 0;
    case 'low': return result >= 1 && result <= 18;
    case 'high': return result >= 19;
    default: return bet.numbers.includes(result);
  }
}

/** Chips returned for a bet (stake + winnings, or 0). */
export function betReturn(bet: RouletteBet, result: number): number {
  return betWins(bet, result) ? bet.amount * (payoutOdds(bet.kind) + 1) : 0;
}

export const betKey = (b: { kind: string; numbers: number[] }) => `${b.kind}:${b.numbers.join('-')}`;

export interface RouletteView {
  phase: 'betting' | 'spinning' | 'result';
  deadline: number;
  serverNow: number;
  spinId: number;
  /** Set once the ball has landed (and during spinning so the wheel can animate to it). */
  result: number | null;
  history: number[];
  players: { name: string; bets: RouletteBet[]; total: number; net: number | null }[];
  yourChips: number | null;
}
