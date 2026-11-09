import { describe, expect, it } from 'vitest';
import { advance, newState, stockKey, type Storage } from '../shared/factory';
import { priceOf, sellable } from '../shared/mines';

// r20: crops harvested to the pantry bank as food:<crop>; a crop Input Chest (good:crop_<crop>) ignored them, so
// 20 pantry sunflowers sat next to a Mill & Press (Sunflower Oil) and nothing went in.
const store = (m: Record<string, number>): Storage => ({ get: (k) => m[k] ?? 0, add: (k, d) => { m[k] = (m[k] ?? 0) + d; } });
function line(withInserter: boolean) {
  const s = newState(3, 0); let id = 0;
  const e = (k: any, x: number, y: number, d: any, extra: object = {}) => s.ents.push({ id: ++id, k, x, y, d, ...extra });
  e('chest_in', 0, 0, 0, { f: 'good:crop_sunflower' });
  if (withInserter) e('inserter', 1, 0, 0); else e('belt', 1, 0, 0);
  e('mill', 2, 0, 0, { r: 'm_oil' }); e('belt', 4, 0, 0); e('chest_out', 5, 0, 0);
  s.seq = id; return s;
}
describe('pantry crops feed the factory', () => {
  for (const ins of [false, true]) it(`20 pantry sunflowers go into the Mill & Press and come out as oil (${ins ? 'inserter' : 'belt'})`, () => {
    const m: Record<string, number> = { 'food:sunflower': 20 }; const s = line(ins);
    advance(s, store(m), 600_000);
    expect(m['food:sunflower'] ?? 0).toBe(0);
    expect(m['good:sunflower_oil']).toBe(20);
  });
  it('import stack is used before the pantry stack; non-crop filters have no alias', () => {
    const m: Record<string, number> = { 'good:crop_sunflower': 1, 'food:sunflower': 5 }; const st = store(m);
    expect(stockKey(st, 'good:crop_sunflower')).toBe('good:crop_sunflower'); m['good:crop_sunflower'] = 0;
    expect(stockKey(st, 'good:crop_sunflower')).toBe('food:sunflower');
    expect(stockKey(st, 'ore:iron')).toBe(null);
  });
  it('price 0 on pantry food is intended (never house-sold); the factory import key is priced', () => {
    expect(priceOf({ type: 'food', id: 'sunflower' })).toBe(0); expect(sellable({ type: 'food', id: 'sunflower' })).toBe(false);
    expect(priceOf({ type: 'good', id: 'crop_sunflower' })).toBe(375); // live GOODS price (seed 250 × crop margins)
  });
});
