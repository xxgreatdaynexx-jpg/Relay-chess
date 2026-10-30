/** Shared multiplayer European roulette wheel (play money). One wheel for everyone, spinning on a fixed cycle. */
import { betKey, betReturn, validateRouletteBet, type RouletteBet, type RouletteView } from '../shared/casino.js';
import type { CasinoBank } from './casino-store.js';

export const ROULETTE_BET_MS = 25_000;
export const ROULETTE_SPIN_MS = 6_000;
export const ROULETTE_RESULT_MS = 5_000;
export const MAX_TOTAL_STAKE = 20_000;

interface Player {
  name: string;
  bets: RouletteBet[];
  net: number | null;
}

export class RouletteWheel {
  phase: RouletteView['phase'] = 'betting';
  deadline: number;
  spinId = 1;
  result: number | null = null;
  history: number[] = [];
  private players = new Map<string, Player>();
  /** Last spin's bets per player, for Rebet. */
  private last = new Map<string, RouletteBet[]>();

  constructor(private readonly bank: CasinoBank, now: number, private readonly rand: () => number = Math.random) {
    this.deadline = now + ROULETTE_BET_MS;
  }

  private player(name: string): Player {
    const k = name.trim().toLowerCase();
    let p = this.players.get(k);
    if (!p) {
      p = { name: name.trim(), bets: [], net: null };
      this.players.set(k, p);
    }
    return p;
  }

  /** Adds chips to a spot (merging with an existing bet on the same spot). */
  placeBet(name: string, raw: unknown): RouletteBet[] {
    if (this.phase !== 'betting') throw new Error('No more bets.');
    const bet = validateRouletteBet(raw);
    if (!bet) throw new Error('Invalid bet.');
    const p = this.player(name);
    const total = p.bets.reduce((n, b) => n + b.amount, 0);
    if (total + bet.amount > MAX_TOTAL_STAKE) throw new Error(`Max ${MAX_TOTAL_STAKE} per spin.`);
    this.bank.debit(name, bet.amount);
    const same = p.bets.find((b) => betKey(b) === betKey(bet));
    if (same) same.amount += bet.amount;
    else p.bets.push(bet);
    return p.bets;
  }

  clear(name: string): void {
    if (this.phase !== 'betting') throw new Error('No more bets.');
    const p = this.player(name);
    const total = p.bets.reduce((n, b) => n + b.amount, 0);
    if (total) this.bank.refund(name, total);
    p.bets = [];
  }

  rebet(name: string): RouletteBet[] {
    const prev = this.last.get(name.trim().toLowerCase());
    if (!prev?.length) throw new Error('No previous bets.');
    const need = prev.reduce((n, b) => n + b.amount, 0);
    if (need > this.bank.account(name).chips) throw new Error('Not enough chips to rebet.');
    for (const b of prev) this.placeBet(name, b);
    return this.player(name).bets;
  }

  tick(now: number): boolean {
    if (now < this.deadline) return false;
    if (this.phase === 'betting') {
      this.result = Math.floor(this.rand() * 37);
      this.phase = 'spinning';
      this.deadline = now + ROULETTE_SPIN_MS;
    } else if (this.phase === 'spinning') {
      this.land(this.result!);
      this.phase = 'result';
      this.deadline = now + ROULETTE_RESULT_MS;
    } else {
      this.phase = 'betting';
      this.spinId += 1;
      this.result = null;
      for (const [k, p] of this.players) {
        if (p.bets.length) this.last.set(k, p.bets.map((b) => ({ ...b, numbers: [...b.numbers] })));
      }
      this.players.clear();
      this.deadline = now + ROULETTE_BET_MS;
    }
    return true;
  }

  private land(n: number): void {
    this.history = [n, ...this.history].slice(0, 10);
    for (const p of this.players.values()) {
      if (!p.bets.length) continue;
      const stake = p.bets.reduce((s, b) => s + b.amount, 0);
      const back = p.bets.reduce((s, b) => s + betReturn(b, n), 0);
      p.net = back - stake;
      this.bank.settle(p.name, back, p.net, 'spin');
    }
  }

  view(you: string | null, now: number): RouletteView {
    return {
      phase: this.phase,
      deadline: this.deadline,
      serverNow: now,
      spinId: this.spinId,
      result: this.phase === 'betting' ? null : this.result,
      history: this.history,
      players: [...this.players.values()]
        .filter((p) => p.bets.length)
        .map((p) => ({ name: p.name, bets: p.bets, total: p.bets.reduce((s, b) => s + b.amount, 0), net: this.phase === 'result' ? p.net : null })),
      yourChips: you ? this.bank.account(you).chips : null,
    };
  }
}
