/** Multiplayer No-Limit Texas Hold'em tables (5/10 blinds). Chips come from the casino bank at buy-in and go back on leaving. */
import type { CasinoCard } from '../shared/casino.js';
import {
  bestHand, HE_BIG, HE_MAX_BUYIN, HE_MIN_BUYIN, HE_NEXT_HAND_MS, HE_SEATS, HE_SMALL, HE_TURN_MS,
  equity, type HEAction, type HEPhase, type HESeatView, type HESpectateView, type HEView, type HEWinner,
} from '../shared/holdem.js';
import { makeShoe } from './blackjack.js';
import type { CasinoBank } from './casino-store.js';
import { secureRand } from './video-poker.js';

interface Seat {
  name: string;
  stack: number;
  hole: CasinoCard[];
  bet: number; // this street
  total: number; // this hand
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  inHand: boolean;
  leaving: boolean;
  timeouts: number;
  startStack: number;
  lastAction?: string;
}

const key = (n: string) => n.toLowerCase();

export class HoldemTable {
  seats: (Seat | null)[] = Array(HE_SEATS).fill(null);
  phase: HEPhase = 'waiting';
  board: CasinoCard[] = [];
  deck: CasinoCard[] = [];
  button = -1;
  toAct: number | null = null;
  deadline: number | null = null;
  currentBet = 0;
  minRaise = HE_BIG;
  winners: HEWinner[] = [];
  revealed = new Set<number>();
  handNo = 0;
  nextHandAt: number | null = null;

  constructor(readonly id: string, private readonly bank: CasinoBank, private readonly rand: () => number = secureRand, private readonly deckFn?: () => CasinoCard[]) {}

  seatOf(name: string): number {
    return this.seats.findIndex((s) => s && key(s.name) === key(name));
  }
  get seated(): number { return this.seats.filter(Boolean).length; }

  sit(name: string, buyIn: number, now: number): number {
    if (this.seatOf(name) >= 0) throw new Error('You are already at this table.');
    if (!Number.isInteger(buyIn) || buyIn < HE_MIN_BUYIN || buyIn > HE_MAX_BUYIN) throw new Error(`Buy in for ${HE_MIN_BUYIN}–${HE_MAX_BUYIN} chips.`);
    const i = this.seats.findIndex((s) => !s);
    if (i < 0) throw new Error('Table is full.');
    this.bank.debit(name, buyIn, 'holdem');
    this.seats[i] = { name, stack: buyIn, hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, inHand: false, leaving: false, timeouts: 0, startStack: buyIn };
    this.maybeSchedule(now);
    return i;
  }

  /** Stand up. Mid-hand you fold now and cash out when the hand ends. */
  leave(name: string, now: number): void {
    const i = this.seatOf(name);
    if (i < 0) return;
    const s = this.seats[i]!;
    if (s.inHand && this.inPlay()) {
      s.leaving = true;
      if (!s.folded) this.fold(i, now, 'left');
      return;
    }
    this.cashOut(i);
  }

  private cashOut(i: number): void {
    const s = this.seats[i]!;
    if (s.stack > 0) this.bank.refund(s.name, s.stack, 'holdem');
    this.seats[i] = null;
  }

  inPlay(): boolean { return ['preflop', 'flop', 'turn', 'river'].includes(this.phase); }

  private maybeSchedule(now: number): void {
    if (this.inPlay() || this.nextHandAt) return;
    if (this.seats.filter((s) => s && s.stack > 0).length >= 2) this.nextHandAt = now + (this.handNo === 0 ? 1500 : HE_NEXT_HAND_MS);
  }

  private next(from: number, ok: (s: Seat) => boolean): number {
    for (let k = 1; k <= HE_SEATS; k++) {
      const i = (from + k) % HE_SEATS;
      const s = this.seats[i];
      if (s && ok(s)) return i;
    }
    return -1;
  }

  startHand(now: number): void {
    this.nextHandAt = null;
    const ready = this.seats.filter((s) => s && s.stack > 0).length;
    if (ready < 2) { this.phase = 'waiting'; return; }
    this.handNo += 1;
    this.board = [];
    this.winners = [];
    this.revealed.clear();
    this.deck = this.deckFn ? this.deckFn() : makeShoe(this.rand, 1);
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, inHand: s.stack > 0, startStack: s.stack, lastAction: undefined });
    }
    this.button = this.next(this.button, (s) => s.inHand);
    const heads = ready === 2;
    const sb = heads ? this.button : this.next(this.button, (s) => s.inHand);
    const bb = this.next(sb, (s) => s.inHand);
    for (let r = 0; r < 2; r++) {
      let i = sb;
      do { this.seats[i]!.hole.push(this.draw()); i = this.next(i, (s) => s.inHand); } while (i !== sb);
    }
    this.phase = 'preflop';
    this.post(sb, HE_SMALL, 'SB');
    this.post(bb, HE_BIG, 'BB');
    this.currentBet = HE_BIG;
    this.minRaise = HE_BIG;
    this.setTurn(this.next(bb, (s) => s.inHand && !s.folded && !s.allIn), now);
    if (this.toAct === null || this.roundDone()) this.advance(now);
  }

  private draw(): CasinoCard { return { ...this.deck.shift()!, faceUp: true }; }

  private post(i: number, amount: number, label: string): void {
    const s = this.seats[i]!;
    const a = Math.min(amount, s.stack);
    s.stack -= a; s.bet += a; s.total += a;
    if (s.stack === 0) s.allIn = true;
    s.lastAction = label;
  }

  private setTurn(i: number, now: number): void {
    this.toAct = i < 0 ? null : i;
    this.deadline = i < 0 ? null : now + HE_TURN_MS;
  }

  private live(): number[] { return this.seats.flatMap((s, i) => (s && s.inHand && !s.folded ? [i] : [])); }

  private roundDone(): boolean {
    const canAct = this.live().map((i) => this.seats[i]!).filter((s) => !s.allIn);
    // Nobody left who could act against a bet.
    if (canAct.length === 0) return true;
    if (canAct.length === 1 && canAct[0]!.bet >= this.currentBet) return true;
    return canAct.every((s) => s.acted && s.bet === this.currentBet);
  }

  options(i: number) {
    const s = this.seats[i];
    if (!s || this.toAct !== i || !this.inPlay()) return null;
    const call = Math.min(this.currentBet - s.bet, s.stack);
    const maxTo = s.bet + s.stack;
    const minTo = Math.min(this.currentBet + this.minRaise, maxTo);
    const others = this.live().filter((j) => j !== i && !this.seats[j]!.allIn).length;
    return { fold: true, check: call === 0, call, raise: !s.acted && maxTo > this.currentBet && others > 0, minRaiseTo: minTo, maxRaiseTo: maxTo };
  }

  act(name: string, action: HEAction, amount: number, now: number): void {
    const i = this.seatOf(name);
    if (i < 0) throw new Error('Take a seat first.');
    if (this.toAct !== i || !this.inPlay()) throw new Error('Not your turn.');
    const s = this.seats[i]!;
    const o = this.options(i)!;
    s.timeouts = 0;
    if (action === 'fold') return this.fold(i, now, 'Fold');
    if (action === 'check') {
      if (!o.check) throw new Error('You must call, raise or fold.');
      s.acted = true; s.lastAction = 'Check';
    } else if (action === 'call') {
      if (o.call === 0) throw new Error('Nothing to call. Check instead.');
      this.put(s, o.call);
      s.acted = true; s.lastAction = s.allIn ? 'All-in' : `Call ${o.call}`;
    } else if (action === 'raise' || action === 'allin') {
      const to = action === 'allin' ? o.maxRaiseTo : amount;
      if (action === 'allin' && !o.raise) {
        // All-in that only calls.
        if (o.call === 0) throw new Error('Nothing to bet into.');
        this.put(s, o.call); s.acted = true; s.lastAction = 'All-in';
        return this.after(now);
      }
      if (!o.raise) throw new Error('You cannot raise here.');
      if (!Number.isInteger(to) || to > o.maxRaiseTo) throw new Error(`Raise to at most ${o.maxRaiseTo}.`);
      if (to < o.minRaiseTo) throw new Error(`Raise to at least ${o.minRaiseTo}.`);
      const raiseBy = to - this.currentBet;
      this.put(s, to - s.bet);
      const full = raiseBy >= this.minRaise;
      if (full) {
        this.minRaise = raiseBy;
        for (const [j, x] of this.seats.entries()) if (x && j !== i) x.acted = false;
      }
      this.currentBet = to;
      s.acted = true;
      s.lastAction = s.allIn ? 'All-in' : `${this.currentBet === raiseBy ? 'Bet' : 'Raise to'} ${to}`;
    } else throw new Error('Unknown action.');
    this.after(now);
  }

  private put(s: Seat, a: number): void {
    s.stack -= a; s.bet += a; s.total += a;
    if (s.stack === 0) s.allIn = true;
  }

  private fold(i: number, now: number, label: string): void {
    const s = this.seats[i]!;
    s.folded = true; s.acted = true; s.lastAction = label === 'left' ? 'Left' : label;
    if (this.toAct === i || this.live().length <= 1) this.after(now);
  }

  private after(now: number): void {
    const live = this.live();
    if (live.length === 1) return this.finish(now, false);
    if (this.roundDone()) return this.advance(now);
    this.setTurn(this.next(this.toAct ?? this.button, (s) => s.inHand && !s.folded && !s.allIn), now);
  }

  private advance(now: number): void {
    while (true) {
      for (const s of this.seats) if (s) { s.bet = 0; s.acted = false; }
      this.currentBet = 0;
      this.minRaise = HE_BIG;
      if (this.phase === 'preflop') { this.phase = 'flop'; this.board.push(this.draw(), this.draw(), this.draw()); }
      else if (this.phase === 'flop') { this.phase = 'turn'; this.board.push(this.draw()); }
      else if (this.phase === 'turn') { this.phase = 'river'; this.board.push(this.draw()); }
      else return this.finish(now, true);
      for (const s of this.seats) if (s && s.inHand && !s.folded && !s.allIn) s.lastAction = undefined;
      const canAct = this.live().filter((i) => !this.seats[i]!.allIn);
      if (canAct.length >= 2) {
        this.setTurn(this.next(this.button, (s) => s.inHand && !s.folded && !s.allIn), now);
        return;
      }
      // Everyone (or all but one) is all-in: run the board out.
    }
  }

  /** Split the pot into main and side pots by contribution level. */
  static pots(contribs: { seat: number; total: number; live: boolean }[]): { amount: number; eligible: number[] }[] {
    const levels = [...new Set(contribs.filter((c) => c.live && c.total > 0).map((c) => c.total))].sort((a, b) => a - b);
    const pots: { amount: number; eligible: number[] }[] = [];
    let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      for (const c of contribs) amount += Math.max(0, Math.min(c.total, lvl) - prev);
      const eligible = contribs.filter((c) => c.live && c.total >= lvl).map((c) => c.seat);
      if (amount > 0) pots.push({ amount, eligible });
      prev = lvl;
    }
    // Chips put in above the top live level (folded players only) go to the last pot.
    let extra = 0;
    for (const c of contribs) extra += Math.max(0, c.total - prev);
    if (extra > 0 && pots.length) pots[pots.length - 1]!.amount += extra;
    return pots;
  }

  private finish(now: number, showdown: boolean): void {
    const live = this.live();
    const contribs = this.seats.flatMap((s, i) => (s && s.inHand ? [{ seat: i, total: s.total, live: !s.folded }] : []));
    const won = new Map<number, number>();
    const labels = new Map<number, string>();
    if (!showdown || live.length === 1) {
      const total = contribs.reduce((a, c) => a + c.total, 0);
      won.set(live[0]!, total);
    } else {
      const scores = new Map<number, number>();
      for (const i of live) {
        const b = bestHand([...this.seats[i]!.hole, ...this.board]);
        scores.set(i, b.score); labels.set(i, b.label);
        this.revealed.add(i);
      }
      for (const pot of HoldemTable.pots(contribs)) {
        const top = Math.max(...pot.eligible.map((i) => scores.get(i)!));
        const ws = pot.eligible.filter((i) => scores.get(i) === top);
        // Odd chips go to the first winner left of the button.
        ws.sort((a, b) => ((a - this.button - 1 + HE_SEATS) % HE_SEATS) - ((b - this.button - 1 + HE_SEATS) % HE_SEATS));
        const share = Math.floor(pot.amount / ws.length);
        let odd = pot.amount - share * ws.length;
        for (const w of ws) { won.set(w, (won.get(w) ?? 0) + share + (odd > 0 ? 1 : 0)); if (odd > 0) odd--; }
      }
    }
    this.winners = [];
    for (const [i, amt] of won) {
      const s = this.seats[i]!;
      s.stack += amt;
      this.winners.push({ name: s.name, amount: amt, hand: labels.get(i) ?? 'Everyone else folded' });
    }
    for (const [i, s] of this.seats.entries()) {
      if (!s || !s.inHand) continue;
      const net = s.stack - s.startStack;
      this.bank.settle(s.name, 0, net, 'hand', 'holdem');
      s.inHand = s.leaving ? false : s.inHand;
      if (s.leaving || s.stack === 0) this.cashOut(i);
    }
    this.phase = 'showdown';
    this.toAct = null;
    this.deadline = null;
    this.nextHandAt = null;
    this.maybeSchedule(now);
  }

  /** Returns true when the view changed. */
  tick(now: number): boolean {
    if (this.inPlay() && this.deadline && now >= this.deadline && this.toAct !== null) {
      const i = this.toAct;
      const s = this.seats[i]!;
      s.timeouts += 1;
      const o = this.options(i)!;
      if (o.check) { s.acted = true; s.lastAction = 'Check (timer)'; this.after(now); }
      else this.fold(i, now, 'Fold (timer)');
      if (s.timeouts >= 2) this.leave(s.name, now);
      return true;
    }
    if (!this.inPlay() && this.nextHandAt === null) this.maybeSchedule(now);
    if (!this.inPlay() && this.nextHandAt && now >= this.nextHandAt) { this.startHand(now); return true; }
    return false;
  }

  view(name: string | null, now = Date.now()): HEView {
    const me = name ? this.seatOf(name) : -1;
    const seats = this.seats.map((s, i): HESeatView | null => {
      if (!s) return null;
      const show = i === me || (this.phase === 'showdown' && this.revealed.has(i));
      return {
        seat: i, name: s.name, stack: s.stack, bet: s.bet, folded: s.folded, allIn: s.allIn, inHand: s.inHand,
        cards: s.inHand ? s.hole.map((c) => (show ? c : null)) : [], lastAction: s.lastAction, you: i === me,
      };
    });
    const pot = this.seats.reduce((a, s) => a + (s && s.inHand ? s.total : 0), 0);
    return {
      id: this.id, phase: this.phase, seats, board: this.board, pot: this.inPlay() ? pot : 0, button: this.button,
      toAct: this.toAct, deadline: this.deadline, currentBet: this.currentBet, minRaiseTo: this.currentBet + this.minRaise,
      you: me >= 0 ? me : null, options: me >= 0 ? this.options(me) : null, winners: this.winners, handNo: this.handNo, nextHandAt: this.nextHandAt, serverNow: now,
    };
  }
}

/** Broadcast view for non-seated spectators: every live hand face up, with win odds. Only send this through HoldemSpectators. */
export function spectateView(t: HoldemTable, now: number, delayMs: number, rand: () => number = Math.random): HESpectateView {
  const base = t.view(null, now);
  const live: number[] = [];
  const seats = base.seats.map((sv, i) => {
    const s = t.seats[i];
    if (!sv || !s) return sv;
    if (s.inHand && !s.folded && s.hole.length) live.push(i);
    return { ...sv, cards: s.inHand ? s.hole.map((c) => ({ ...c })) : [] };
  });
  const odds: Record<number, number> = {};
  if (t.inPlay() && live.length >= 2) {
    const eq = equity(live.map((i) => t.seats[i]!.hole), t.board, 300, rand);
    live.forEach((i, k) => { odds[i] = Math.round(eq[k]! * 1000) / 1000; });
  } else if (live.length === 1) odds[live[0]!] = 1;
  return { ...base, seats, you: null, options: null, spectator: true, delayMs, watchers: 0, odds };
}

/** All the tables. New players fill the busiest table with an open seat. */
export class HoldemRoom {
  tables: HoldemTable[] = [];
  private n = 0;
  constructor(private readonly bank: CasinoBank, private readonly rand: () => number = secureRand) {}

  tableOf(name: string): HoldemTable | null {
    return this.tables.find((t) => t.seatOf(name) >= 0) ?? null;
  }

  sit(name: string, buyIn: number, now: number): HoldemTable {
    const cur = this.tableOf(name);
    if (cur) return cur;
    const open = this.tables.filter((t) => t.seated < HE_SEATS).sort((a, b) => b.seated - a.seated)[0];
    const t = open ?? new HoldemTable(`T${++this.n}`, this.bank, this.rand);
    if (!open) this.tables.push(t);
    t.sit(name, buyIn, now);
    return t;
  }

  leave(name: string, now: number): HoldemTable | null {
    const t = this.tableOf(name);
    if (!t) return null;
    t.leave(name, now);
    this.prune();
    return t;
  }

  prune(): void {
    this.tables = this.tables.filter((t) => t.seated > 0 || this.tables.length === 1);
  }

  tick(now: number): HoldemTable[] {
    const changed = this.tables.filter((t) => t.tick(now));
    return changed;
  }
}
