/** Auto-sell chest: withdraw waiting items back to factory storage (partial, capacity, race with the auto-sale, cap unchanged). */
import { beforeEach, describe, expect, it } from 'vitest';
import { FactoryWorld, resetFactory } from '../server/factory';
import { MinesWorld, resetMines } from '../server/mines';
import { getBank, resetBank } from '../server/casino-store';
import { playerKey } from '../server/skins';
import { dayKey, HOUSE_DAILY_BASE, MAX_BANKED_STACK } from '../shared/mines';
import { CHEST_SELL_CAP, chestHeld, type Ent } from '../shared/factory';

let w: MinesWorld; let f: FactoryWorld; let n = 0;
const rich = (a: string, chips: number) => getBank().transfer(a, chips - getBank().account(a).chips, { game: 'test' });
beforeEach(() => { resetBank(); w = resetMines(); f = resetFactory(); });
const NOW = 1_700_000_000_000;
const qty = (a: string, k: string) => w.packOf(a).get(k)?.qty ?? 0;

/** Factory with one auto-sell chest (nothing feeding it) holding `ib`. capUsed: today's house cap already spent. */
function setup(ib: Record<string, number>, capUsed = true) {
  const A = `QA-ChestTake-${++n}`;
  rich(A, 5000); f.expand(A, NOW); f.buy(A, 'chest_sell', 1, NOW);
  if (capUsed) w.daily.set(playerKey(A), { day: dayKey(NOW), gross: HOUSE_DAILY_BASE, paid: HOUSE_DAILY_BASE });
  f.place(A, [{ k: 'chest_sell', x: 5, y: 5, d: 0 }], NOW);
  const chest = f.get(A, NOW)!.ents.find((e) => e.k === 'chest_sell')! as Ent;
  chest.ib = { ...ib };
  return { A, chest };
}

describe('auto-sell chest withdraw', () => {
  it('partial withdraw moves exactly that many to storage and leaves the rest', () => {
    const { A, chest } = setup({ 'ore:iron': 10, 'bar:iron_bar': 3 });
    const r = f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 4 }, NOW);
    expect(r.moved).toEqual([['ore:iron', 4]]); expect(r.full).toBe(false);
    expect(chest.ib).toEqual({ 'ore:iron': 6, 'bar:iron_bar': 3 });
    expect(qty(A, 'ore:iron')).toBe(4);
    // all of one item, then everything
    f.withdraw(A, { id: chest.id, item: 'ore:iron' }, NOW);
    expect(chest.ib?.['ore:iron']).toBeUndefined(); expect(qty(A, 'ore:iron')).toBe(10);
    f.withdraw(A, { id: chest.id }, NOW);
    expect(chestHeld(chest)).toBe(0); expect(qty(A, 'bar:iron_bar')).toBe(3);
    expect(() => f.withdraw(A, { id: chest.id }, NOW)).toThrow(/empty/);
  });

  it('asking for more than the chest holds takes only what is there (no duplication)', () => {
    const { A, chest } = setup({ 'ore:iron': 5 });
    f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 999 }, NOW);
    expect(qty(A, 'ore:iron')).toBe(5); expect(chestHeld(chest)).toBe(0);
  });

  it('respects the storage cap: only what fits moves, the rest stays in the chest', () => {
    const { A, chest } = setup({ 'ore:iron': 10 });
    w.packOf(A).set('ore:iron', { type: 'ore', id: 'iron', qty: MAX_BANKED_STACK - 3 });
    const r = f.withdraw(A, { id: chest.id }, NOW);
    expect(r.moved).toEqual([['ore:iron', 3]]); expect(r.full).toBe(true);
    expect(qty(A, 'ore:iron')).toBe(MAX_BANKED_STACK); expect(chest.ib).toEqual({ 'ore:iron': 7 });
    expect(() => f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 1 }, NOW)).toThrow(/storage is full/);
    expect(qty(A, 'ore:iron')).toBe(MAX_BANKED_STACK); expect(chest.ib).toEqual({ 'ore:iron': 7 });
  });

  it('refuses bad input and non-chests without changing anything', () => {
    const { A, chest } = setup({ 'ore:iron': 4 });
    expect(() => f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 0 }, NOW)).toThrow();
    expect(() => f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 1.5 }, NOW)).toThrow();
    expect(() => f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: -3 }, NOW)).toThrow();
    expect(() => f.withdraw(A, { id: chest.id, qty: 2 }, NOW)).toThrow(/which item/);
    expect(() => f.withdraw(A, { id: chest.id, item: 'ore:gold' }, NOW)).toThrow(/None of that/);
    expect(() => f.withdraw(A, { id: 9999 }, NOW)).toThrow(/not there/);
    const other = f.get(A, NOW)!.ents.find((e) => e.k !== 'chest_sell');
    if (other) expect(() => f.withdraw(A, { id: other.id }, NOW)).toThrow(/not there/);
    expect(() => f.withdraw(null, { id: chest.id }, NOW)).toThrow();
    expect(chest.ib).toEqual({ 'ore:iron': 4 }); expect(qty(A, 'ore:iron')).toBe(0);
  });

  it('does not touch the daily house cap or the chest cap', () => {
    expect(CHEST_SELL_CAP).toBe(MAX_BANKED_STACK);
    const { A, chest } = setup({ 'ore:iron': 10 });
    const d0 = { ...w.daily.get(playerKey(A))! }; const q0 = w.quoteItems(A, NOW, [{ type: 'ore', id: 'iron', qty: 10 }]);
    const c0 = getBank().account(A).chips;
    f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 6 }, NOW);
    expect(w.daily.get(playerKey(A))).toEqual(d0);
    const q1 = w.quoteItems(A, NOW, [{ type: 'ore', id: 'iron', qty: 10 }]);
    expect(q1.capBase).toBe(q0.capBase); expect(q1.paid).toBe(q0.paid); expect(q1.already).toBe(q0.already);
    expect(getBank().account(A).chips).toBe(c0); // withdrawing never pays anything
  });

  it('while a rollover auto-sale is committing, withdraw is refused; afterwards items are conserved exactly', async () => {
    const { A, chest } = setup({ 'ore:iron': 10 }, false);
    // Slow store: every save waits until we release it, so the auto-sale stays in flight.
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    (w as unknown as { store: unknown }).store = { save: async () => { await gate; return []; }, txCommitted: async () => true };
    const c0 = getBank().account(A).chips;
    f.get(A, NOW + 1000); // day has room: the chest's contents start selling (taken out of the chest now)
    const inFlight = chestHeld(chest);
    expect(inFlight).toBeLessThan(10);
    expect(() => f.withdraw(A, { id: chest.id }, NOW + 1000)).toThrow(/selling right now/);
    expect(qty(A, 'ore:iron')).toBe(0);
    release(); await f.waitAutoSell(A);
    const sold = 10 - chestHeld(chest);
    expect(getBank().account(A).chips).toBeGreaterThan(c0);
    if (chestHeld(chest) > 0) { f.withdraw(A, { id: chest.id }, NOW + 2000); }
    expect(qty(A, 'ore:iron') + chestHeld(chest) + sold).toBe(10);
  });

  it('with the cap spent, a later sale only sells what is still in the chest after a withdraw', async () => {
    const { A, chest } = setup({ 'ore:iron': 10 });
    f.withdraw(A, { id: chest.id, item: 'ore:iron', qty: 7 }, NOW);
    // next day: cap resets, the sweep sells what is left (3), never the withdrawn 7
    const next = NOW + 86_400_000; const c0 = getBank().account(A).chips;
    f.get(A, next); await f.waitAutoSell(A); f.get(A, next); await f.waitAutoSell(A);
    expect(chestHeld(chest)).toBe(0); expect(qty(A, 'ore:iron')).toBe(7);
    expect(getBank().account(A).chips).toBeGreaterThan(c0);
  });
});
