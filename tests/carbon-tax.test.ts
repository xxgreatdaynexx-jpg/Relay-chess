import { beforeEach, describe, expect, it } from 'vitest';
import { LEVERS, LEVER_IDS, clampLever, leverText } from '../shared/city';
import { FRECIPES, recipeCoal, advance, newState, TICK_MS, type FState, type Storage } from '../shared/factory';
import { resetFactory } from '../server/factory';
import { getBank, resetBank } from '../server/casino-store';
import { resetMines, type MinesWorld } from '../server/mines';
import { collectCarbonTax, carbonUnpaid, carbonRate, resetCarbonTax } from '../server/carbon-tax';
import { setCityRates, cityCarbonTaxRate, type CityRates } from '../server/city-rates';
import { UNITS } from '../shared/fortmc';

const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
const bal = (n: string) => getBank().account(n).chips;
const mem = (init: Record<string, number>): Storage & { m: Record<string, number> } => { const m = { ...init }; return { m, get: (k) => m[k] ?? 0, add: (k, d) => { m[k] = (m[k] ?? 0) + d; } }; };

function ironLine(): FState {
  const s = newState(3, 0);
  let id = 0; const e = (k: any, x: number, y: number, d: any, extra: object = {}) => s.ents.push({ id: ++id, k, x, y, d, ...extra });
  e('chest_in', 0, 0, 0, { f: 'ore:iron' }); e('chest_in', 0, 1, 0, { f: 'ore:coal' });
  e('belt', 1, 0, 0); e('belt', 1, 1, 0);
  e('smelter', 2, 0, 0, { r: 's_iron' });
  e('belt', 4, 0, 0); e('chest_out', 5, 0, 0);
  s.seq = id; return s;
}

describe('carbon tax rules', () => {
  it('is a mayor lever from 0 to 10 chips per coal, default 1, with chips unit text', () => {
    expect(LEVER_IDS).toContain('carbon_tax');
    expect(LEVERS.carbon_tax.base).toBe(1);
    expect(LEVERS.carbon_tax.min).toBe(0);
    expect(LEVERS.carbon_tax.max).toBe(10);
    expect(LEVERS.carbon_tax.step).toBe(1);
    expect(clampLever('carbon_tax', 11)).toBe(10);
    expect(clampLever('carbon_tax', -2)).toBe(0);
    expect(leverText('carbon_tax', 1)).toBe('1 chip / coal');
    expect(leverText('carbon_tax', 0)).toBe('0 chips / coal');
    expect(leverText('carbon_tax', 3)).toBe('3 chips / coal');
  });
  it('only factory smelter recipes burn coal; Fort turbines burn natural gas, not coal', () => {
    const burning = FRECIPES.filter((r) => recipeCoal(r) > 0);
    expect(burning.length).toBeGreaterThan(8);
    expect(burning.every((r) => r.machine === 'smelter')).toBe(true);
    expect(recipeCoal(FRECIPES.find((r) => r.id === 's_iron')!)).toBe(1);
    expect(recipeCoal(FRECIPES.find((r) => r.id === 's_gold')!)).toBe(2);
    expect(recipeCoal(FRECIPES.find((r) => r.id === 's_steel')!)).toBe(2);
    expect(UNITS.turbine.input).toBe('natgas');
    expect(UNITS.turbine.desc.toLowerCase()).toMatch(/natural gas/);
    expect(UNITS.turbine.desc.toLowerCase()).not.toMatch(/coal/);
  });
  it('advance reports coal consumed when a smelter starts a craft', () => {
    const s = ironLine(); const st = mem({ 'ore:iron': 3, 'ore:coal': 1 });
    let coal = 0;
    advance(s, st, 30_000, undefined, (n) => { coal += n; });
    expect(coal).toBe(1);
  });
});

describe('carbon tax collection', () => {
  beforeEach(() => { resetBank(); resetCarbonTax(); setCityRates(null); });
  it('defaults to 1 chip per coal and credits nothing when City Hall is offline (tax still charged)', () => {
    expect(cityCarbonTaxRate()).toBe(1);
    expect(carbonRate()).toBe(1);
    rich('Ann', 100);
    const r = collectCarbonTax('Ann', 4);
    expect(r).toEqual({ charged: 4, unpaid: 0, rate: 1, coal: 4 });
    expect(bal('Ann')).toBe(96);
    expect(carbonUnpaid('Ann')).toBe(0);
  });
  it('uses the live lever rate when City Hall is up', () => {
    const fake = (v: number): CityRates => ({ lever: (id) => id === 'carbon_tax' ? v : 0, policyMul: () => 1, perk: () => 0 });
    setCityRates(fake(3));
    rich('Ann', 50);
    expect(collectCarbonTax('Ann', 2)).toMatchObject({ charged: 6, unpaid: 0, rate: 3 });
    expect(bal('Ann')).toBe(44);
    setCityRates(null);
  });
  it('does not stop the bill: shortfall becomes unpaid and is collected later', () => {
    rich('Ann', 2);
    const first = collectCarbonTax('Ann', 5); // 5 chips due, can pay 2
    expect(first.charged).toBe(2);
    expect(first.unpaid).toBe(3);
    expect(bal('Ann')).toBe(0);
    expect(carbonUnpaid('Ann')).toBe(3);
    rich('Ann', 10);
    const next = collectCarbonTax('Ann', 0);
    expect(next.charged).toBe(3);
    expect(next.unpaid).toBe(0);
    expect(bal('Ann')).toBe(7);
  });
});

describe('factory world charges carbon tax when coal is burned, including catch-up', () => {
  let w: MinesWorld;
  beforeEach(() => { resetBank(); w = resetMines(); resetFactory(); resetCarbonTax(); setCityRates(null); });
  it('debits the owner when smelters consume coal and still finishes the bars if they cannot pay', () => {
    const f = resetFactory();
    const A = 'Ann-Fab'; rich(A, 5000);
    f.expand(A, 0);
    const p = w.packOf(A); p.set('ore:iron', { type: 'ore', id: 'iron', qty: 6 }); p.set('ore:coal', { type: 'ore', id: 'coal', qty: 2 });
    f.place(A, [{ k: 'chest_in', x: 0, y: 0, d: 0, f: 'ore:iron' }, { k: 'chest_in', x: 0, y: 1, d: 0, f: 'ore:coal' }, { k: 'belt', x: 1, y: 0, d: 0 }, { k: 'belt', x: 1, y: 1, d: 0 }, { k: 'smelter', x: 2, y: 0, d: 0, r: 's_iron' }, { k: 'belt', x: 4, y: 0, d: 0 }, { k: 'chest_out', x: 5, y: 0, d: 0 }], 0);
    const before = bal(A);
    f.get(A, 120_000);
    expect(w.storage(A).find((s) => s.id === 'iron_bar')?.qty).toBe(2);
    expect(bal(A)).toBe(before - 2); // 2 coal × 1 chip
    expect(carbonUnpaid(A)).toBe(0);
  });
  it('keeps producing when the owner is broke and records unpaid tax', () => {
    const f = resetFactory();
    const A = 'Ann-Broke'; rich(A, 250); // expand costs 250, leaves 0
    f.expand(A, 0);
    expect(bal(A)).toBe(0);
    // starter kit includes a smelter
    const p = w.packOf(A); p.set('ore:iron', { type: 'ore', id: 'iron', qty: 6 }); p.set('ore:coal', { type: 'ore', id: 'coal', qty: 2 });
    f.place(A, [{ k: 'chest_in', x: 0, y: 0, d: 0, f: 'ore:iron' }, { k: 'chest_in', x: 0, y: 1, d: 0, f: 'ore:coal' }, { k: 'belt', x: 1, y: 0, d: 0 }, { k: 'belt', x: 1, y: 1, d: 0 }, { k: 'smelter', x: 2, y: 0, d: 0, r: 's_iron' }, { k: 'belt', x: 4, y: 0, d: 0 }, { k: 'chest_out', x: 5, y: 0, d: 0 }], 0);
    f.get(A, 120_000);
    expect(w.storage(A).find((s) => s.id === 'iron_bar')?.qty).toBe(2);
    expect(bal(A)).toBe(0);
    expect(carbonUnpaid(A)).toBe(2);
  });
});

void TICK_MS;
