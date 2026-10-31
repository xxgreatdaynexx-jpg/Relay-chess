import { describe, expect, it } from 'vitest';
import { Economy, avgDaily, marketPrices, skinValue, splitFlows, valueHoldings, type DayRow, type EconSource, type Holdings, type SaleRow } from '../server/economy';
import { SKINS } from '../shared/skins';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-31T12:00:00Z');
const common = (w: string) => SKINS.filter((s) => s.weapon === w && s.rarity === 'common');

describe('economy valuation', () => {
  it('uses the median of recent sales, falling back to the last few ever', () => {
    const sales: SaleRow[] = [{ what: 'a', unit: 10, at: NOW - DAY }, { what: 'a', unit: 30, at: NOW - 2 * DAY }, { what: 'a', unit: 20, at: NOW - 3 * DAY }, { what: 'a', unit: 999, at: NOW - 40 * DAY }, { what: 'b', unit: 7, at: NOW - 60 * DAY }];
    const p = marketPrices(sales, NOW);
    expect(p.get('a')).toBe(20); expect(p.get('b')).toBe(7);
  });
  it('estimates a skin with no history from same rarity + weapon, then rarity, then base', () => {
    const [a, b, c] = common('pistol'); const smg = common('smg')[0]!;
    const prices = new Map([[a!.id, 100], [b!.id, 200]]);
    expect(skinValue(a!.id, prices)).toEqual({ value: 100, est: false });
    expect(skinValue(c!.id, prices)).toEqual({ value: 150, est: 'peers' });
    expect(skinValue(smg.id, prices)).toEqual({ value: 150, est: 'rarity' });
    const ultra = SKINS.find((s) => s.rarity === 'ultra')!;
    expect(skinValue(ultra.id, prices).est).toBe('base');
  });
  it('breaks assets down by category and reports the estimated share', () => {
    const [a, c] = common('pistol'); const pick = SKINS.find((s) => s.weapon === 'pickaxe' && s.rarity === 'common')!;
    const h: Holdings = { skins: [{ kind: 'skin', skin: a!.id, n: 2 }, { kind: 'skin', skin: c!.id, n: 1 }, { kind: 'skin', skin: pick.id, n: 1 }, { kind: 'case', skin: '', n: 3 }], stacks: [{ type: 'ore', id: 'iron', qty: 10 }, { type: 'bar', id: 'gold_bar', qty: 1 }], machines: [{ kind: 'smelter', n: 2 }] };
    const v = valueHoldings(h, new Map([[a!.id, 100], ['stack:bar:gold_bar', 120]]));
    const cat = Object.fromEntries(v.categories.map((x) => [x.key, x]));
    expect(cat.skins!.value).toBe(300); expect(cat.skins!.estValue).toBe(100);
    expect(cat.pickaxes!.value).toBe(100); // same rarity peers
    expect(cat.goods!.value).toBe(120); expect(cat.goods!.estValue).toBe(0);
    expect(cat.factory!.value).toBe(200); // 50% of 200 x2
    expect(v.total).toBe(v.categories.reduce((s, x) => s + x.value, 0));
    expect(v.estPct).toBeGreaterThan(0); expect(v.estPct).toBeLessThan(100);
  });
  it('splits ledger flows into faucets and sinks, counting only market fees', () => {
    const f = splitFlows([{ game: 'mines', pos: 500, neg: -200 }, { game: 'market', pos: 950, neg: -1000 }, { game: 'roulette', pos: 300, neg: -400 }]);
    expect(f.faucets).toEqual([{ game: 'mines', amount: 500 }, { game: 'roulette', amount: 300 }]);
    expect(f.sinks).toEqual([{ game: 'roulette', amount: 400 }, { game: 'mines', amount: 200 }, { game: 'market fees', amount: 50 }]);
  });
  it('averages daily inflation geometrically', () => {
    expect(avgDaily([100, 110, 121], 7)).toBe(10);
    expect(avgDaily([100], 7)).toBeNull();
  });
});

function fakeSource(): EconSource & { rows: DayRow[]; calls: number } {
  const rows: DayRow[] = [];
  const s = {
    rows, calls: 0,
    async cash() { s.calls++; return 10_000; },
    async holdings(): Promise<Holdings> { return { skins: [], stacks: [{ type: 'ore', id: 'iron', qty: 100 }], machines: [] }; },
    async sales() { return []; },
    async flows() { return [{ game: 'mines', pos: 50, neg: 0 }]; },
    async cashAt(t: number) { return 9000 + Math.floor((t - Date.parse('2026-10-28T00:00:00Z')) / DAY) * 300; },
    async firstLedgerAt() { return Date.parse('2026-10-28T05:00:00Z'); },
    async days() { return rows; },
    async saveDay(r: DayRow) { if (!rows.some((x) => x.day === r.day)) rows.push(r); },
  };
  return s;
}

describe('Economy', () => {
  it('backfills finished days from the ledger, snapshots, computes change, and caches for 5 minutes', async () => {
    let t = NOW; const src = fakeSource(); const e = new Economy(src, () => t);
    const a = await e.stats() as Record<string, any>;
    expect(src.rows.map((r) => r.day)).toEqual(['2026-10-28', '2026-10-29', '2026-10-30']);
    expect(src.rows.every((r) => r.source === 'ledger' && r.assets == null)).toBe(true);
    expect(a.cash).toBe(10_000); expect(a.assets).toBeGreaterThan(0); expect(a.total).toBe(a.cash + a.assets);
    expect(a.change.cash).toBeCloseTo(((10_000 - 9900) / 9900) * 100, 1);
    expect(a.inflation.cash7).not.toBeNull();
    expect(a.flows.faucets[0]).toEqual({ game: 'mines', amount: 50 });
    const n = src.calls; t += 60_000; await e.stats(); expect(src.calls).toBe(n);
    t += 5 * 60_000; await e.stats(); expect(src.calls).toBeGreaterThan(n);
  });
  it('takes a full snapshot of a day that just closed', async () => {
    const src = fakeSource(); src.rows.push({ day: '2026-10-28', cash: 1, assets: null, total: null, estPct: null, flows: null, source: 'ledger' }, { day: '2026-10-29', cash: 1, assets: null, total: null, estPct: null, flows: null, source: 'ledger' });
    await new Economy(src, () => Date.parse('2026-10-31T00:00:05Z')).catchUp(Date.parse('2026-10-31T00:00:05Z'));
    const r = src.rows.find((x) => x.day === '2026-10-30')!;
    expect(r.source).toBe('snapshot'); expect(r.assets).toBeGreaterThan(0); expect(r.total).toBe(r.cash + r.assets!);
  });
});
