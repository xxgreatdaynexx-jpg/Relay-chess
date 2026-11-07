// Chud City Warehouse "Sell to house" (Dayne 2026-11-04): instant sale to the game at the house price (price index +
// daily tiers), ledgered (game 'mines'), idempotent per client request id; auto-sell arrivals use the same house sale.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getBank, resetBank } from '../server/casino-store';
import { MinesWorld, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { payoutFor } from '../shared/mines';

const N = 'QA-Cole-Visit';
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('Sell to house (mines_sell with a request id)', () => {
  let w: MinesWorld;
  beforeEach(() => { resetBank(); w = resetMines(); setPriceIndexForTest(1.37); });
  const give = (qty: number) => { w.join('a', N, 0); w.add(w.miners.get('a')!, [{ type: 'ore', id: 'gold', qty }]); w.leave('a', 10); };
  const chips = () => getBank().account(N).chips;
  const left = () => w.storage(N).find((s) => s.id === 'gold')?.qty ?? 0;

  it('pays the house price at the price index (same tiers as the Factory desk) and takes only that many', () => {
    give(10); const c0 = chips();
    const r = w.sellOnce(N, 1000, 'ore:gold', 4, 'req-aaaaaaaa');
    expect(r.paid).toBe(Math.floor(payoutFor(4 * 15, 0, 100_000) * 1.37)); expect(r.replay).toBeUndefined();
    expect(chips() - c0).toBe(r.paid); expect(left()).toBe(6);
  });
  it('a replayed request id never sells twice; a new id sells again', () => {
    give(10); const c0 = chips();
    const a = w.sellOnce(N, 1000, 'ore:gold', 4, 'req-bbbbbbbb');
    const b = w.sellOnce(N, 1001, 'ore:gold', 4, 'req-bbbbbbbb');
    expect(b).toMatchObject({ paid: a.paid, replay: true }); expect(left()).toBe(6); expect(chips() - c0).toBe(a.paid);
    w.sellOnce(N, 1002, 'ore:gold', 4, 'req-cccccccc'); expect(left()).toBe(2);
  });
  it('ids are per player and validated; no id behaves like a plain sell', () => {
    give(10);
    w.sellOnce(N, 1000, 'ore:gold', 1, 'bad id!'); w.sellOnce(N, 1001, 'ore:gold', 1, 'bad id!'); expect(left()).toBe(8); // invalid id: not cached
    w.sellOnce(N, 1002, 'ore:gold', 1); expect(left()).toBe(7);
    expect(() => w.sellOnce(null, 1003, 'ore:gold', 1, 'req-dddddddd')).toThrow(/Sign in/);
    expect(() => w.sellOnce(N, 1004, 'ore:gold', 99, 'req-eeeeeeee')).toThrow(); expect(left()).toBe(7);
  });
});

describe('wiring', () => {
  it('the socket uses sellOnce with the rid and keeps the Chud City market gate', () => {
    const m = src('server/mines.ts');
    // truck logistics: the house buys only what is AT the Warehouse (per-location stock), through the one sale path
    expect(m).toMatch(/socket\.on\('mines_sell'[\s\S]{0,400}isAtResort\(account\(\)\) \|\| isAtFortMc\(account\(\)\)[\s\S]{0,1200}getLocStore\(\)\.at\(a, WAREHOUSE\)[\s\S]{0,1500}getLocMoves\(\)\.sell\(a, /);
    expect(m).toMatch(/selling\.has\(rid\)/);
  });
  it('auto-sell / ship & sell arrivals of ore, gems and bars land in the Warehouse and sell to the house', () => {
    expect(src('server/warehouse.ts')).toMatch(/async arrived[\s\S]*ls\.adjust\(s\.ownerName, \[\{ loc: WAREHOUSE, item, delta: s\.qty \}\][\s\S]*getLocMoves\(\)\.sell\(s\.ownerName, \{ item, qty: s\.qty \}\)/);
  });
  it('the Warehouse shows a Sell to house action for every stored item, next to Sell on Market, and the map opens it', () => {
    const r = src('client/src/components/ResourceSell.tsx'); const h = src('client/src/components/HouseSell.tsx');
    expect(r).toMatch(/data-testid="res-house">🏦 Sell to house/); expect(r).toMatch(/data-testid="res-sell">Sell on Market/);
    expect(r).toMatch(/<HouseSell [^>]*testid="msell-house-sell"/);
    expect(h).toMatch(/emit\('mines_sell', \{ ore: `\$\{type\}:\$\{id\}`, qty: n, rid: rid\(\) \}/);
    expect(src('client/src/components/WorldMap.tsx')).toMatch(/case 'warehouse': window\.dispatchEvent\(new Event\('open-resource-inventory'\)\)/);
  });
});
