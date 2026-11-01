import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { indexed, stepIndex, fmtIndex, PI_FLOOR, PI_MAX_DAILY, type IndexState } from '../shared/priceIndex';
import { advancePriceIndex, rawRate, setPriceIndexForTest, px } from '../server/price-index';
import { payoutOdds, betReturn, RED, WHEEL } from '../shared/casino';
import { POKER_PAYS } from '../shared/casino-games';
import { MACHINES, MACHINE_IDS, DQ_SCATTER_PAY, DQ_FREE_MULT, GR_GRAND_MULT, DQ_CHEST_PRIZES, GR_COIN_VALUES } from '../shared/video-slots';

/**
 * Economy sim: cash C, daily faucets F*idx and sinks S*idx (both indexed, as in the game), plus organic growth g
 * (new players). Measured inflation = dC/C feeds the index. Shows the loop converges instead of running away.
 */
function simulate(days: number, opts: { cash: number; faucet: number; sink: number; growth?: number; shock?: (d: number) => number }) {
  let st: IndexState = { index: 1, ema: null }; let cash = opts.cash; const out: number[] = [];
  for (let d = 0; d < days; d++) {
    const prev = cash;
    cash = Math.max(1, cash + (opts.faucet - opts.sink) * st.index + cash * (opts.growth ?? 0) + (opts.shock?.(d) ?? 0));
    const s = stepIndex(st, (cash - prev) / prev); st = { index: s.index, ema: s.ema };
    expect(Math.abs(s.applied)).toBeLessThanOrEqual(PI_MAX_DAILY + 2e-4);
    expect(s.index).toBeGreaterThanOrEqual(PI_FLOOR);
    out.push(s.index);
  }
  return out;
}

describe('price index damping', () => {
  it('starts at 1 and is flat with no inflation', () => {
    expect(simulate(30, { cash: 10_000, faucet: 500, sink: 500 }).at(-1)).toBe(1);
  });
  it('heavy +10%/day inflation: capped and does not run away over 60 days', () => {
    // Faucets outrun sinks by 1,000/day on a 10k economy (≈10% day one). Indexed payouts mint more nominal chips,
    // but cash grows too, so the measured rate decays and the index growth decelerates.
    const s = simulate(60, { cash: 10_000, faucet: 2_000, sink: 1_000 });
    const g = (a: number, b: number) => s[b]! / s[a]! - 1;
    expect(g(50, 59)).toBeLessThan(g(0, 9));
    expect(s.at(-1)!).toBeLessThan(6);
    console.log('sim +10%/day → index day 10/30/60:', s[9], s[29], s[59]);
  });
  it('steady 2%/day organic growth converges to ~1%/day (pass-through 0.5)', () => {
    const s = simulate(45, { cash: 10_000, faucet: 0, sink: 0, growth: 0.02 });
    expect(s[44]! / s[43]! - 1).toBeCloseTo(0.01, 3);
    console.log('sim 2%/day → index day 45:', s[44]);
  });
  it('one-day 10x admin-style spike is clipped and fades', () => {
    const s = simulate(30, { cash: 10_000, faucet: 0, sink: 0, shock: (d) => (d === 3 ? 100_000 : 0) });
    expect(s.at(-1)!).toBeLessThan(1.3);
  });
  it('deflation brings the index back down but never below the floor', () => {
    const up = simulate(20, { cash: 10_000, faucet: 0, sink: 0, growth: 0.04 });
    expect(up.at(-1)!).toBeGreaterThan(1.3);
    let st: IndexState = { index: up.at(-1)!, ema: 0.04 };
    for (let d = 0; d < 120; d++) { const x = stepIndex(st, -0.05); st = { index: x.index, ema: x.ema }; }
    expect(st.index).toBe(PI_FLOOR);
  });
  it('indexed() rounds and keeps positive bases >= 1', () => {
    expect(indexed(300, 1.07)).toBe(321); expect(indexed(1, 1)).toBe(1); expect(indexed(0, 2)).toBe(0);
    setPriceIndexForTest(1.5); expect(px(1000)).toBe(1500); setPriceIndexForTest(1);
    expect(fmtIndex(1.07, 2.1)).toBe('Prices & payouts: x1.07 (+2.1% today)');
  });
});

describe('stored index (Postgres claim)', () => {
  function fakeDb(econ: Array<{ day: string; cash: number; flows?: unknown }>) {
    const rows = new Map<string, Record<string, unknown>>();
    return {
      rows,
      async query(sql: string, a: unknown[] = []) {
        if (sql.startsWith('SELECT day, cash, flows FROM daily_economy')) return { rows: econ };
        if (sql.includes('ORDER BY day DESC LIMIT 1')) { const k = [...rows.keys()].sort().at(-1); return { rows: k ? [rows.get(k)] : [] }; }
        if (sql.startsWith('SELECT * FROM price_index WHERE day')) return { rows: [rows.get(String(a[0]))].filter(Boolean) };
        if (sql.startsWith('INSERT INTO price_index')) {
          const day = String(a[0]); if (rows.has(day)) return { rows: [] };
          rows.set(day, sql.includes('VALUES ($1, 1,') ? { day, idx: 1, ema: null, raw: null, applied: 0 } : { day, idx: a[1], ema: a[2], raw: a[3], applied: a[4] });
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
  }
  it('seeds 1.00, steps once per day, is idempotent and ignores admin grants', async () => {
    const econ = [{ day: '2026-11-01', cash: 10_000 }, { day: '2026-11-02', cash: 11_500, flows: { faucets: [{ game: 'admin', amount: 500 }], sinks: [] } }];
    expect(rawRate(new Map(econ.map((e) => [e.day, { cash: e.cash, flows: e.flows ?? null }])), '2026-11-02')).toBeCloseTo(0.1);
    const db = fakeDb(econ);
    expect((await advancePriceIndex(db as never, Date.parse('2026-11-02T12:00:00Z'))).index).toBe(1);
    const v = await advancePriceIndex(db as never, Date.parse('2026-11-03T01:00:00Z'));
    expect(v.index).toBeCloseTo(1.03, 4); // 10% raw, EMA seed 10% x 0.5 = 5% → capped 3%
    const again = await advancePriceIndex(db as never, Date.parse('2026-11-03T05:00:00Z'));
    expect(again.index).toBe(v.index); expect(db.rows.size).toBe(2);
    setPriceIndexForTest(1);
  });
  it('waits for the midnight close before stepping', async () => {
    const db = fakeDb([{ day: '2026-10-31', cash: 10_000 }]);
    await advancePriceIndex(db as never, Date.parse('2026-11-01T12:00:00Z'));
    await advancePriceIndex(db as never, Date.parse('2026-11-02T00:30:00Z'));
    expect(db.rows.size).toBe(1);
    setPriceIndexForTest(1);
  });
});

// The city machines exactly as they were before Chud Resort, so CASINO_HASH stays unchanged. The `engine` tag is metadata only.
// The resort machines copy these pay tables and weights (tests/resort.test.ts checks that they match).
const CITY_MACHINES = Object.fromEntries(MACHINE_IDS.map((id) => { const { engine: _e, ...rest } = MACHINES[id]; return [id, rest]; }));
describe('casino is never indexed', () => {
  it('payout tables are byte-for-byte unchanged', () => {
    const tables = JSON.stringify({ odds: ['straight', 'split', 'street', 'corner', 'line', 'dozen', 'column', 'red'].map((k) => payoutOdds(k as never)), RED: [...RED], WHEEL, POKER_PAYS, MACHINES: CITY_MACHINES, DQ_SCATTER_PAY, DQ_FREE_MULT, GR_GRAND_MULT, DQ_CHEST_PRIZES, GR_COIN_VALUES });
    expect(createHash('sha256').update(tables).digest('hex')).toBe(CASINO_HASH);
  });
  it('roulette returns are identical at any index', () => {
    setPriceIndexForTest(3);
    expect(betReturn({ kind: 'straight', numbers: [17], amount: 10 } as never, 17)).toBe(360);
    setPriceIndexForTest(1);
  });
  it('no casino module imports the price index', () => {
    const casino = ['roulette', 'blackjack', 'slots', 'video-poker', 'holdem', 'casino-sockets', 'casino-store', 'solitro', 'conquest', 'rooms'].map((f) => `server/${f}.ts`)
      .concat(readdirSync('shared').filter((f) => /casino|slots|holdem|solitro/.test(f)).map((f) => `shared/${f}`));
    for (const f of casino) expect(readFileSync(f, 'utf8'), f).not.toMatch(/price-?index|priceIndex/i);
  });
});
const CASINO_HASH = 'bd29058759e12bc9f5c44750fa7ffa2e818af951fab3e094871b0ac7e91ef60d';
