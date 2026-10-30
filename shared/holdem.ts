/** No-Limit Texas Hold'em: shared constants, view types and hand evaluation. Play money only. */
import type { CasinoCard } from './casino.js';

export const HE_SEATS = 6;
export const HE_SMALL = 5;
export const HE_BIG = 10;
export const HE_MIN_BUYIN = 100;
export const HE_MAX_BUYIN = 1000;
export const HE_TURN_MS = 25000;
export const HE_NEXT_HAND_MS = 4000;

export type HEPhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type HEAction = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface HESeatView {
  seat: number;
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  cards: (CasinoCard | null)[]; // null = face-down card someone else holds
  lastAction?: string;
  you: boolean;
}

export interface HEWinner { name: string; amount: number; hand: string }

export interface HEView {
  id: string;
  phase: HEPhase;
  seats: (HESeatView | null)[];
  board: CasinoCard[];
  pot: number;
  button: number;
  toAct: number | null;
  deadline: number | null;
  currentBet: number;
  minRaiseTo: number;
  you: number | null;
  /** What the viewer may do right now. */
  options: { fold: boolean; check: boolean; call: number; raise: boolean; minRaiseTo: number; maxRaiseTo: number } | null;
  winners: HEWinner[];
  handNo: number;
  nextHandAt: number | null;
  serverNow: number;
  /** Spectators watching this table. */
  watchers?: number;
}

const CATS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

type C = Pick<CasinoCard, 'rank' | 'suit'>;
const hi = (r: number) => (r === 1 ? 14 : r);

/** Score exactly five cards. Higher number wins; equal numbers split. */
export function score5(cards: C[]): number {
  const rs = cards.map((c) => hi(c.rank)).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (rs[0]! - rs[4]! === 4) straightHigh = rs[0]!;
    else if (rs.join() === '14,5,4,3,2') straightHigh = 5;
  }
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  let cat: number;
  let kick: number[];
  if (straightHigh && flush) { cat = 8; kick = [straightHigh]; }
  else if (shape === '41') { cat = 7; kick = groups.map((g) => g[0]); }
  else if (shape === '32') { cat = 6; kick = groups.map((g) => g[0]); }
  else if (flush) { cat = 5; kick = rs; }
  else if (straightHigh) { cat = 4; kick = [straightHigh]; }
  else if (shape === '311') { cat = 3; kick = groups.map((g) => g[0]); }
  else if (shape === '221') { cat = 2; kick = groups.map((g) => g[0]); }
  else if (shape === '2111') { cat = 1; kick = groups.map((g) => g[0]); }
  else { cat = 0; kick = rs; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (kick[i] ?? 0);
  return s;
}

/** Best five of up to seven cards. */
export function bestHand(cards: C[]): { score: number; label: string } {
  let best = -1;
  const pick = (start: number, chosen: C[]) => {
    if (chosen.length === 5) { const v = score5(chosen); if (v > best) best = v; return; }
    for (let i = start; i <= cards.length - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]!]);
  };
  pick(0, []);
  return { score: best, label: CATS[Math.floor(best / 15 ** 5)]! };
}

/** Default delay on the spectator feed (hidden cards and actions), so watchers can't relay live info to a seat. */
export const HE_SPECTATE_DELAY_MS = 2_000;

/** Spectator view: every live hand face up, plus win odds. */
export interface HESpectateView extends HEView {
  spectator: true;
  delayMs: number;
  watchers: number;
  /** Win chance (0–1, split pots shared) by seat for players still in the hand. */
  odds: Record<number, number>;
}

const SUITS_ALL = ['S', 'H', 'D', 'C'] as const;

/** Monte Carlo (or exact on the river) equity for each hand against the others. */
export function equity(hands: C[][], board: C[], iters = 400, rand: () => number = Math.random): number[] {
  const n = hands.length;
  const win = Array(n).fill(0) as number[];
  if (n === 0) return win;
  if (n === 1) return [1];
  const used = new Set([...hands.flat(), ...board].map((c) => `${c.suit}${c.rank}`));
  const deck: C[] = [];
  for (const suit of SUITS_ALL) for (let rank = 1; rank <= 13; rank++) if (!used.has(`${suit}${rank}`)) deck.push({ suit, rank } as C);
  const need = 5 - board.length;
  const runs = need === 0 ? 1 : iters;
  for (let it = 0; it < runs; it++) {
    const d = deck.slice();
    const b = board.slice();
    for (let k = 0; k < need; k++) { const j = k + Math.floor(rand() * (d.length - k)); [d[k], d[j]] = [d[j]!, d[k]!]; b.push(d[k]!); }
    const sc = hands.map((h) => bestHand([...h, ...b]).score);
    const top = Math.max(...sc);
    const ws = sc.filter((s) => s === top).length;
    sc.forEach((s, i) => { if (s === top) win[i] += 1 / ws; });
  }
  return win.map((w) => w / runs);
}
