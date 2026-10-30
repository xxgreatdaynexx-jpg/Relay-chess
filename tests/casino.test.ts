import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import { BlackjackCasino, BlackjackTable, BET_MS, TURN_MS, SETTLE_MS, netFor, settleHand } from '../server/blackjack.js';
import { CasinoBank, PgCasinoStore } from '../server/casino-store.js';
import type { CasinoCard } from '../shared/casino.js';

const c = (rank: number, suit: CasinoCard['suit'] = 'S'): CasinoCard => ({ id: `${suit}${rank}${Math.random()}`, suit, rank, faceUp: true });

/** Rig the shoe: cards are popped from the end, so pass them in deal order. */
function rig(t: BlackjackTable, order: number[]) {
  (t as unknown as { shoe: CasinoCard[] }).shoe = [...Array(100).fill(0).map(() => c(2)), ...order.map((r) => c(r)).reverse()];
}

describe('blackjack rules', () => {
  it('settles outcomes and payouts', () => {
    expect(settleHand({ cards: [c(1), c(13)] }, [c(10), c(9)])).toBe('blackjack');
    expect(netFor('blackjack', 10)).toBe(15);
    expect(settleHand({ cards: [c(1), c(13)], fromSplit: true }, [c(10), c(9)])).toBe('win');
    expect(settleHand({ cards: [c(10), c(9)] }, [c(10), c(9)])).toBe('push');
    expect(settleHand({ cards: [c(10), c(5), c(9)] }, [c(10), c(9)])).toBe('bust');
    expect(settleHand({ cards: [c(10), c(8)] }, [c(10), c(6), c(10)])).toBe('win');
    expect(settleHand({ cards: [c(10), c(8)] }, [c(1), c(10)])).toBe('dealer-blackjack');
    expect(netFor('lose', 10)).toBe(-10);
    expect(netFor('push', 10)).toBe(0);
  });

  it('runs a two-player round: betting, turns, timeout auto-stand, dealer S17, payouts', () => {
    const bank = new CasinoBank();
    const casino = new BlackjackCasino(bank);
    const t = casino.join('Ada', 0);
    expect(casino.join('Bo', 0)).toBe(t);
    expect(t.phase).toBe('betting');
    t.bet('Ada', 100, 1);
    expect(t.phase).toBe('betting');
    // deal order: Ada, Bo, dealer up, Ada, Bo, dealer hole, then draws
    rig(t, [10, 9, 10, 6, 8, 7, 5]);
    t.bet('Bo', 50, 2); // everyone bet -> deals now
    expect(t.phase).toBe('playing');
    expect(t.turn).toBe(0);
    expect(t.view('Ada', 2).dealer[1]!.faceUp).toBe(false);
    t.act('Ada', 'stand', 3); // Ada 16
    expect(t.turn).toBe(1);
    expect(() => t.act('Ada', 'hit', 4)).toThrow();
    casino.tick(3 + TURN_MS); // Bo (17) times out -> stands; dealer 17 stands, wait dealer has 10+7=17
    expect(t.phase).toBe('settled');
    const v = t.view(null, 0);
    expect(v.seats[0]!.hands[0]!.outcome).toBe('lose');
    expect(v.seats[1]!.hands[0]!.outcome).toBe('push');
    expect(bank.account('Ada').chips).toBe(900);
    expect(bank.account('Bo').chips).toBe(1000);
    casino.tick(3 + TURN_MS + SETTLE_MS);
    expect(t.phase).toBe('betting');
  });

  it('doubles and splits', () => {
    const bank = new CasinoBank();
    const t = new BlackjackTable('X', bank);
    t.sit('Ada', 0);
    // Ada 8,8 ; dealer 10, 7 ; split draws 3 then 10 ; double on 8+3 draws 10
    rig(t, [8, 10, 8, 7, 3, 10, 10]);
    t.bet('Ada', 100, 1);
    t.act('Ada', 'split', 2);
    expect(t.seats[0]!.hands).toHaveLength(2);
    expect(bank.account('Ada').chips).toBe(800);
    t.act('Ada', 'double', 3); // 8+3+10 = 21
    t.act('Ada', 'stand', 4); // 8+10 = 18 vs 17
    expect(t.phase).toBe('settled');
    expect(t.seats[0]!.hands.map((h) => h.net)).toEqual([200, 100]);
    expect(bank.account('Ada').chips).toBe(1300);
    expect(bank.account('Ada').hands).toBe(2);
  });

  it('restarts betting when nobody bets and drops to waiting when empty', () => {
    const t = new BlackjackTable('X', new CasinoBank());
    t.sit('Ada', 0);
    t.tick(BET_MS);
    expect(t.phase).toBe('betting');
    t.leave('Ada', BET_MS + 1);
    expect(t.phase).toBe('waiting');
  });

  it('auto-assigns a new table when one is full', () => {
    const casino = new BlackjackCasino(new CasinoBank());
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const tables = names.map((n) => casino.join(n, 0));
    expect(new Set(tables.map((x) => x.id)).size).toBe(2);
  });

  it('rejects bets beyond the balance and resets only when broke', () => {
    const bank = new CasinoBank();
    const t = new BlackjackTable('X', bank);
    t.sit('Ada', 0);
    expect(() => t.bet('Ada', 2000, 1)).toThrow();
    expect(() => bank.reset('Ada')).toThrow();
    bank.debit('Ada', 998);
    expect(bank.reset('Ada').chips).toBe(1000);
  });
});

describe('casino postgres store', () => {
  it('migrates idempotently, persists and reloads, and leaves the chess table alone', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const bank = new CasinoBank();
    const store = new PgCasinoStore(pool);
    await store.init();
    expect(await bank.attach(store)).toBe(true);
    bank.debit('Ada', 100);
    bank.settle('Ada', 250, 150, 'hand');
    bank.debit('Bo', 50);
    bank.settle('Bo', 0, -50, 'spin');
    await bank.flush();
    const again = new CasinoBank();
    await again.attach(new PgCasinoStore(pool));
    expect(again.standings()).toEqual([
      { key: 'ada', name: 'Ada', chips: 1150, hands: 1, spins: 0, netWon: 150, biggestWin: 150 },
      { key: 'bo', name: 'Bo', chips: 950, hands: 0, spins: 1, netWon: -50, biggestWin: 0 },
    ]);
    const tables = db.public.many("SELECT table_name FROM information_schema.tables WHERE table_schema='public'").map((r) => r.table_name);
    expect(tables).toEqual(['casino_players']);
  });

  it('falls back to memory when the store fails', async () => {
    const bank = new CasinoBank();
    const ok = await bank.attach({ init: async () => { throw new Error('down'); }, loadAll: async () => [], save: async () => {} });
    expect(ok).toBe(false);
    bank.debit('Ada', 5);
    expect(bank.account('Ada').chips).toBe(995);
  });
});
