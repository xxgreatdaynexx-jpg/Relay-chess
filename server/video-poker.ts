/** Jacks or Better video poker against the house, one hand per player at a time. */
import { randomInt } from 'node:crypto';
import { evaluatePoker, POKER_LABELS, POKER_MAX_BET, POKER_MIN_BET, POKER_PAYS, type PokerView } from '../shared/casino-games.js';
import type { CasinoCard } from '../shared/casino.js';
import { makeShoe } from './blackjack.js';
import type { CasinoBank } from './casino-store.js';

export const secureRand = () => randomInt(0, 2 ** 31) / 2 ** 31;

interface Hand { deck: CasinoCard[]; cards: CasinoCard[]; bet: number }

export class VideoPoker {
  private hands = new Map<string, Hand>();
  private last = new Map<string, PokerView['result'] & { cards: CasinoCard[]; bet: number }>();
  constructor(private readonly bank: CasinoBank, private readonly rand: () => number = secureRand) {}

  private key = (name: string) => name.toLowerCase();

  deal(name: string, bet: number, deck?: CasinoCard[]): PokerView {
    if (this.hands.has(this.key(name))) throw new Error('Finish this hand first: pick cards to hold, then Draw.');
    if (!Number.isInteger(bet) || bet < POKER_MIN_BET || bet > POKER_MAX_BET) throw new Error(`Bet ${POKER_MIN_BET}–${POKER_MAX_BET} chips.`);
    this.bank.debit(name, bet);
    const d = deck ?? makeShoe(this.rand, 1);
    const cards = d.splice(0, 5);
    this.hands.set(this.key(name), { deck: d, cards, bet });
    this.last.delete(this.key(name));
    return this.view(name);
  }

  draw(name: string, hold: unknown): PokerView {
    const h = this.hands.get(this.key(name));
    if (!h) throw new Error('Deal a hand first.');
    const keep = Array.isArray(hold) ? hold.slice(0, 5).map(Boolean) : [];
    h.cards = h.cards.map((c, i) => (keep[i] ? c : h.deck.shift()!));
    const hand = evaluatePoker(h.cards);
    const returned = h.bet * POKER_PAYS[hand];
    const net = returned - h.bet;
    this.bank.settle(name, returned, net, 'hand');
    this.hands.delete(this.key(name));
    this.last.set(this.key(name), { hand, label: POKER_LABELS[hand], returned, net, cards: h.cards, bet: h.bet });
    return this.view(name);
  }

  view(name: string): PokerView {
    const chips = this.bank.account(name).chips;
    const h = this.hands.get(this.key(name));
    if (h) return { phase: 'dealt', cards: h.cards, bet: h.bet, chips };
    const l = this.last.get(this.key(name));
    if (l) return { phase: 'idle', cards: l.cards, bet: l.bet, chips, result: { hand: l.hand, label: l.label, returned: l.returned, net: l.net } };
    return { phase: 'idle', cards: [], bet: 0, chips };
  }
}

