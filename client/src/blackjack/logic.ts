/** Pure blackjack logic (play money only). 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2. */
import type { Card, Suit } from '@/solitaire/logic';
export type { Card };

export const DECKS = 6;
export const RESHUFFLE_AT = 78; // reshuffle when fewer than ~1.5 decks remain
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export type Phase = 'betting' | 'player' | 'done';
export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'dealer-blackjack';
export interface BJState {
  shoe: Card[];
  player: Card[];
  dealer: Card[]; // dealer[1] is the hole card (faceUp false until reveal)
  bet: number;
  chips: number;
  phase: Phase;
  doubled: boolean;
  outcome: Outcome | null;
  payout: number; // net chips change for the last hand
}

export function makeShoe(rand: () => number = Math.random, decks = DECKS): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) shoe.push({ id: `${d}${suit}${rank}`, suit, rank, faceUp: true });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export function cardValue(rank: number): number {
  return rank === 1 ? 11 : Math.min(rank, 10);
}

/** Best total and whether it is soft (an ace still counted as 11). */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 1) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards: Card[]) => cards.length === 2 && handValue(cards).total === 21;

export function newState(chips = 1000, rand: () => number = Math.random): BJState {
  return { shoe: makeShoe(rand), player: [], dealer: [], bet: 0, chips, phase: 'betting', doubled: false, outcome: null, payout: 0 };
}

function take(s: BJState, faceUp = true): Card {
  const c = s.shoe.pop()!;
  return { ...c, faceUp };
}

/** Dealer draws until 17+, standing on soft 17. Returns new dealer hand. */
export function dealerPlay(dealer: Card[], draw: () => Card): Card[] {
  const hand = dealer.map((c) => ({ ...c, faceUp: true }));
  while (handValue(hand).total < 17) hand.push(draw());
  return hand;
}

/** Net chip change for a settled hand given the (already doubled) bet. */
export function payoutFor(outcome: Outcome, bet: number): number {
  switch (outcome) {
    case 'blackjack': return Math.floor(bet * 1.5);
    case 'win': return bet;
    case 'push': return 0;
    default: return -bet;
  }
}

export function settle(player: Card[], dealer: Card[]): Outcome {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  const pbj = isBlackjack(player);
  const dbj = isBlackjack(dealer);
  if (p > 21) return 'bust';
  if (pbj && dbj) return 'push';
  if (pbj) return 'blackjack';
  if (dbj) return 'dealer-blackjack';
  if (d > 21 || p > d) return 'win';
  if (p === d) return 'push';
  return 'lose';
}

function clone(s: BJState): BJState {
  return { ...s, shoe: [...s.shoe], player: [...s.player], dealer: [...s.dealer] };
}

function finish(n: BJState, dealerDraws: boolean): BJState {
  if (dealerDraws) n.dealer = dealerPlay(n.dealer, () => take(n));
  else n.dealer = n.dealer.map((c) => ({ ...c, faceUp: true }));
  n.outcome = settle(n.player, n.dealer);
  n.payout = payoutFor(n.outcome, n.bet);
  n.chips += n.bet + n.payout; // bet was escrowed at deal
  n.phase = 'done';
  return n;
}

export function deal(s: BJState, bet: number, rand: () => number = Math.random): BJState | null {
  if (s.phase === 'player' || bet <= 0 || bet > s.chips || !Number.isInteger(bet)) return null;
  const n = clone(s);
  if (n.shoe.length < RESHUFFLE_AT) n.shoe = makeShoe(rand);
  n.bet = bet;
  n.chips -= bet;
  n.doubled = false;
  n.outcome = null;
  n.payout = 0;
  const p1 = take(n), d1 = take(n), p2 = take(n), d2 = take(n, false);
  n.player = [p1, p2];
  n.dealer = [d1, d2];
  n.phase = 'player';
  if (isBlackjack(n.player) || isBlackjack(n.dealer)) return finish(n, false);
  return n;
}

export function hit(s: BJState): BJState | null {
  if (s.phase !== 'player') return null;
  const n = clone(s);
  n.player.push(take(n));
  const t = handValue(n.player).total;
  if (t > 21) return finish(n, false);
  if (t === 21) return finish(n, true);
  return n;
}

export function stand(s: BJState): BJState | null {
  if (s.phase !== 'player') return null;
  return finish(clone(s), true);
}

export const canDouble = (s: BJState) => s.phase === 'player' && s.player.length === 2 && s.chips >= s.bet;

export function double(s: BJState): BJState | null {
  if (!canDouble(s)) return null;
  const n = clone(s);
  n.chips -= n.bet;
  n.bet *= 2;
  n.doubled = true;
  n.player.push(take(n));
  return finish(n, handValue(n.player).total <= 21);
}

export function isValidBJ(x: unknown): x is BJState {
  const s = x as BJState;
  return !!s && Array.isArray(s.shoe) && Array.isArray(s.player) && Array.isArray(s.dealer) && typeof s.chips === 'number' && ['betting', 'player', 'done'].includes(s.phase);
}
