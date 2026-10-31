/** Server-authoritative multiplayer blackjack (play money). 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2. */
import { handValue, isBlackjack, type BJHandView, type BJOutcome, type BJTableView, type CasinoCard, type Suit } from '../shared/casino.js';
import type { CasinoBank } from './casino-store.js';

export const MAX_SEATS = 5;
export const BET_MS = 15_000;
export const TURN_MS = 20_000;
export const SETTLE_MS = 6_000;
export const MIN_BET = 5;
export const MAX_BET = 5_000;
const DECKS = 6;
const RESHUFFLE_AT = 78;
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export function makeShoe(rand: () => number, decks = DECKS): CasinoCard[] {
  const shoe: CasinoCard[] = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) shoe.push({ id: `${d}${suit}${rank}`, suit, rank, faceUp: true });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j]!, shoe[i]!];
  }
  return shoe;
}

interface Hand {
  cards: CasinoCard[];
  bet: number;
  doubled: boolean;
  done: boolean;
  fromSplit: boolean;
  outcome: BJOutcome | null;
  net: number;
}

interface Seat {
  name: string;
  bet: number;
  hands: Hand[];
  active: number | null;
  leaving: boolean;
}

export type BJAction = 'hit' | 'stand' | 'double' | 'split';

export function settleHand(hand: { cards: CasinoCard[]; fromSplit?: boolean }, dealer: CasinoCard[]): BJOutcome {
  const p = handValue(hand.cards).total;
  const d = handValue(dealer.map((c) => ({ ...c, faceUp: true }))).total;
  const pbj = !hand.fromSplit && isBlackjack(hand.cards);
  const dbj = isBlackjack(dealer);
  if (p > 21) return 'bust';
  if (pbj && dbj) return 'push';
  if (pbj) return 'blackjack';
  if (dbj) return 'dealer-blackjack';
  if (d > 21 || p > d) return 'win';
  if (p === d) return 'push';
  return 'lose';
}

/** Net chip change for a settled hand. */
export function netFor(outcome: BJOutcome, bet: number): number {
  switch (outcome) {
    case 'blackjack': return Math.floor(bet * 1.5);
    case 'win': return bet;
    case 'push': return 0;
    default: return -bet;
  }
}

export class BlackjackTable {
  phase: BJTableView['phase'] = 'waiting';
  deadline: number | null = null;
  dealer: CasinoCard[] = [];
  seats: (Seat | null)[] = Array.from({ length: MAX_SEATS }, () => null);
  turn: number | null = null;
  private shoe: CasinoCard[];

  constructor(readonly id: string, private readonly bank: CasinoBank, private readonly rand: () => number = Math.random) {
    this.shoe = makeShoe(rand);
  }

  seatOf(name: string): number | null {
    const k = name.trim().toLowerCase();
    const i = this.seats.findIndex((s) => s && s.name.toLowerCase() === k);
    return i < 0 ? null : i;
  }

  get freeSeats(): number {
    return this.seats.filter((s) => !s || s.leaving).length;
  }

  get occupied(): number {
    return this.seats.filter((s) => s && !s.leaving).length;
  }

  sit(name: string, now: number): number {
    const existing = this.seatOf(name);
    if (existing !== null) {
      this.seats[existing]!.leaving = false;
      return existing;
    }
    const i = this.seats.findIndex((s) => !s);
    if (i < 0) throw new Error('Table is full.');
    this.seats[i] = { name: name.trim(), bet: 0, hands: [], active: null, leaving: false };
    this.bank.account(name);
    if (this.phase === 'waiting') this.startBetting(now);
    return i;
  }

  leave(name: string, now: number): void {
    const i = this.seatOf(name);
    if (i === null) return;
    const s = this.seats[i]!;
    if (this.phase === 'playing' && s.hands.length) {
      // Hands in play stand automatically; seat is freed after the round.
      s.leaving = true;
      for (const h of s.hands) h.done = true;
      if (this.turn === i) this.advance(now);
      return;
    }
    if (this.phase === 'betting' && s.bet > 0) this.bank.refund(s.name, s.bet, 'blackjack');
    this.seats[i] = null;
    if (this.occupied === 0 && this.phase === 'betting') this.toWaiting();
  }

  bet(name: string, amount: number, now: number): void {
    if (this.phase !== 'betting') throw new Error('Betting is closed.');
    const i = this.seatOf(name);
    if (i === null) throw new Error('Take a seat first.');
    const s = this.seats[i]!;
    if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) throw new Error(`Bets are ${MIN_BET}–${MAX_BET}.`);
    // Changing the bet: refund old, take new.
    if (s.bet > 0) this.bank.refund(s.name, s.bet, 'blackjack');
    s.bet = 0;
    this.bank.debit(s.name, amount, 'blackjack');
    s.bet = amount;
    if (this.seats.every((x) => !x || x.leaving || x.bet > 0)) this.deal(now);
  }

  act(name: string, action: BJAction, now: number): void {
    if (this.phase !== 'playing') throw new Error('No hand in play.');
    const i = this.seatOf(name);
    if (i === null || i !== this.turn) throw new Error('Not your turn.');
    const s = this.seats[i]!;
    const h = s.hands[s.active ?? 0]!;
    switch (action) {
      case 'hit': {
        h.cards.push(this.draw());
        if (handValue(h.cards).total >= 21) h.done = true;
        break;
      }
      case 'stand':
        h.done = true;
        break;
      case 'double': {
        if (h.cards.length !== 2) throw new Error('Double only on two cards.');
        this.bank.debit(s.name, h.bet, 'blackjack');
        h.bet *= 2;
        h.doubled = true;
        h.cards.push(this.draw());
        h.done = true;
        break;
      }
      case 'split': {
        if (!canSplit(h, s.hands.length)) throw new Error('Cannot split this hand.');
        this.bank.debit(s.name, h.bet, 'blackjack');
        const second = h.cards.pop()!;
        const aces = second.rank === 1;
        h.fromSplit = true;
        h.cards.push(this.draw());
        const h2: Hand = { cards: [second, this.draw()], bet: h.bet, doubled: false, done: false, fromSplit: true, outcome: null, net: 0 };
        s.hands.splice((s.active ?? 0) + 1, 0, h2);
        if (aces) h.done = h2.done = true; // split aces get one card each
        else {
          if (handValue(h.cards).total === 21) h.done = true;
          if (handValue(h2.cards).total === 21) h2.done = true;
        }
        break;
      }
      default:
        throw new Error('Unknown action.');
    }
    this.advance(now);
  }

  /** Drives timers. Returns true when the view changed. */
  tick(now: number): boolean {
    if (this.deadline === null || now < this.deadline) return false;
    if (this.phase === 'betting') {
      if (this.seats.some((s) => s && s.bet > 0)) this.deal(now);
      else if (this.occupied > 0) this.startBetting(now);
      else this.toWaiting();
      return true;
    }
    if (this.phase === 'playing' && this.turn !== null) {
      const s = this.seats[this.turn]!;
      s.hands[s.active ?? 0]!.done = true; // auto-stand on timeout
      this.advance(now);
      return true;
    }
    if (this.phase === 'settled') {
      this.nextRound(now);
      return true;
    }
    return false;
  }

  view(you: string | null, now: number): BJTableView {
    const reveal = this.phase === 'settled' || this.phase === 'dealer';
    return {
      id: this.id,
      phase: this.phase,
      deadline: this.deadline,
      serverNow: now,
      dealer: this.dealer.map((c, i) => (i === 1 && !reveal ? { id: 'hole', suit: 'S', rank: 1, faceUp: false } : { ...c, faceUp: true })),
      seats: this.seats.flatMap((s, seat) =>
        s
          ? [{
              seat,
              name: s.name,
              bet: s.bet,
              active: s.active,
              chips: this.bank.account(s.name).chips,
              hands: s.hands.map((h): BJHandView => ({ cards: h.cards, bet: h.bet, doubled: h.doubled, done: h.done, outcome: h.outcome, net: h.net })),
            }]
          : [],
      ),
      turn: this.turn,
      you: you ? this.seatOf(you) : null,
      maxSeats: MAX_SEATS,
    };
  }

  private draw(): CasinoCard {
    if (this.shoe.length === 0) this.shoe = makeShoe(this.rand);
    return { ...this.shoe.pop()!, faceUp: true };
  }

  private toWaiting(): void {
    this.phase = 'waiting';
    this.deadline = null;
    this.turn = null;
    this.dealer = [];
  }

  private startBetting(now: number): void {
    this.phase = 'betting';
    this.deadline = now + BET_MS;
    this.turn = null;
  }

  private deal(now: number): void {
    if (this.shoe.length < RESHUFFLE_AT) this.shoe = makeShoe(this.rand);
    const players = this.seats.filter((s): s is Seat => !!s && s.bet > 0);
    for (const s of this.seats) if (s && s.bet === 0) s.hands = [];
    for (const s of players) s.hands = [{ cards: [], bet: s.bet, doubled: false, done: false, fromSplit: false, outcome: null, net: 0 }];
    this.dealer = [];
    for (let r = 0; r < 2; r++) {
      for (const s of players) s.hands[0]!.cards.push(this.draw());
      this.dealer.push(this.draw());
    }
    this.phase = 'playing';
    for (const s of players) {
      s.active = 0;
      if (isBlackjack(s.hands[0]!.cards)) s.hands[0]!.done = true;
    }
    if (isBlackjack(this.dealer)) {
      // Dealer peeks: round ends immediately.
      for (const s of players) for (const h of s.hands) h.done = true;
    }
    this.turn = null;
    this.advance(now);
  }

  /** Moves to the next unfinished hand, or plays the dealer. */
  private advance(now: number): void {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (!s) continue;
      const idx = s.hands.findIndex((h) => !h.done);
      if (idx >= 0) {
        const changed = this.turn !== i || s.active !== idx;
        s.active = idx;
        this.turn = i;
        if (changed || this.deadline === null || this.phase !== 'playing') this.deadline = now + TURN_MS;
        else this.deadline = now + TURN_MS;
        return;
      }
      s.active = null;
    }
    this.turn = null;
    this.playDealer(now);
  }

  private playDealer(now: number): void {
    const live = this.seats.some((s) => s?.hands.some((h) => handValue(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.fromSplit)));
    if (live && !isBlackjack(this.dealer)) {
      while (handValue(this.dealer).total < 17) this.dealer.push(this.draw());
    }
    for (const s of this.seats) {
      if (!s || !s.hands.length) continue;
      for (const h of s.hands) {
        h.outcome = settleHand(h, this.dealer);
        h.net = netFor(h.outcome, h.bet);
        this.bank.settle(s.name, h.bet + h.net, h.net, 'hand', 'blackjack');
      }
    }
    this.phase = 'settled';
    this.deadline = now + SETTLE_MS;
  }

  private nextRound(now: number): void {
    this.dealer = [];
    this.seats = this.seats.map((s) => (s && !s.leaving ? { ...s, bet: 0, hands: [], active: null } : null));
    if (this.occupied > 0) this.startBetting(now);
    else this.toWaiting();
  }
}

export function canSplit(h: { cards: CasinoCard[] }, handCount: number): boolean {
  return h.cards.length === 2 && handCount < 4 && Math.min(h.cards[0]!.rank, 10) === Math.min(h.cards[1]!.rank, 10);
}

/** All tables; players are auto-assigned to the first table with a free seat. */
export class BlackjackCasino {
  tables: BlackjackTable[] = [];
  private seq = 0;
  constructor(private readonly bank: CasinoBank, private readonly rand: () => number = Math.random) {}

  tableOf(name: string): BlackjackTable | null {
    return this.tables.find((t) => t.seatOf(name) !== null) ?? null;
  }

  join(name: string, now: number): BlackjackTable {
    const at = this.tableOf(name);
    if (at) {
      at.sit(name, now);
      return at;
    }
    let t = this.tables.find((x) => x.seats.some((s) => !s));
    if (!t) {
      t = new BlackjackTable(`T${++this.seq}`, this.bank, this.rand);
      this.tables.push(t);
    }
    t.sit(name, now);
    return t;
  }

  leave(name: string, now: number): BlackjackTable | null {
    const t = this.tableOf(name);
    if (!t) return null;
    t.leave(name, now);
    return t;
  }

  /** Returns tables whose view changed; drops empty idle tables beyond the first. */
  tick(now: number): BlackjackTable[] {
    const changed = this.tables.filter((t) => t.tick(now));
    this.tables = this.tables.filter((t, i) => i === 0 || t.phase !== 'waiting' || t.occupied > 0);
    return changed;
  }
}
