// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Employment } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { setPriceIndexForTest } from '../server/price-index';
import { DAY, HOUR, expectedDayHaul, jobById, type WorkerView } from '../shared/employment';
import { hourlySeries, last24ByResource, productionRates, workplaceGroups, HOUR_MS } from '../shared/employProduction';
import { ProductionPanel } from '../client/src/components/EmployProduction';

afterEach(cleanup);
const T0 = Date.parse('2026-11-01T12:00:00Z');
const wv = (id: string, job: string, hiredAt: number, extra: Partial<WorkerView> = {}): WorkerView => ({ id, job, status: 'working', hiredAt, paidUntil: T0 + DAY, seenAt: T0, nextAt: null, box: {}, boxValue: 0, wage: 1, ...extra });

describe('workplace groups', () => {
  it('groups by workplace, biggest group first, hire order inside each group', () => {
    const ws = [wv('a', 'fisher', 1), wv('b', 'miner:frost', 2), wv('c', 'miner:mine', 3), wv('d', 'miner:frost', 4), wv('e', 'miner:mine', 0), wv('f', 'miner:frost', 5)];
    const g = workplaceGroups(ws);
    expect(g.map((x) => [x.job, x.workers.length])).toEqual([['miner:frost', 3], ['miner:mine', 2], ['fisher', 1]]);
    expect(g[0]!.workers.map((w) => w.id)).toEqual(['b', 'd', 'f']);
    expect(g[1]!.workers.map((w) => w.id)).toEqual(['e', 'c']);
  });
  it('ties keep the hire-card order (The Mine before Stone Quarry before Fisher)', () => {
    expect(workplaceGroups([wv('a', 'fisher', 1), wv('b', 'miner:quarry', 2), wv('c', 'miner:mine', 3)]).map((g) => g.job)).toEqual(['miner:mine', 'miner:quarry', 'fisher']);
  });
});

describe('production rates', () => {
  it('per hour = expected per day / 24, summed over working workers only, per workplace and in total', () => {
    const mine = jobById('miner:mine')!;
    const r = productionRates([wv('a', 'miner:mine', 1), wv('b', 'miner:mine', 2), wv('c', 'miner:mine', 3, { status: 'unpaid' }), wv('d', 'fisher', 4)]);
    const iron = expectedDayHaul(mine).items.find((x) => x.id === 'iron')!.qty / 24;
    expect(r.items.find((x) => x.key === 'iron')!.perHour).toBeCloseTo(iron * 2, 6);
    const g = r.byJob.find((x) => x.job === 'miner:mine')!; expect(g.working).toBe(2); expect(g.total).toBe(3);
    expect(g.perHour).toBeCloseTo((2 * expectedDayHaul(mine).picks) / 24, 6); // 2 working miners × 30 picks/h
    expect(r.items.find((x) => x.key === 'fish')!.perHour).toBeCloseTo(expectedDayHaul(jobById('fisher')!).picks / 24, 6);
    expect(r.perHour).toBeCloseTo(r.byJob.reduce((a, x) => a + x.perHour, 0), 6);
  });
  it('honours a miner priority', () => {
    const bal = productionRates([wv('a', 'miner:mine', 1)]).items.find((x) => x.key === 'stone')!.perHour;
    const pri = productionRates([wv('a', 'miner:mine', 1, { priority: 'stone' })]).items.find((x) => x.key === 'stone')!.perHour;
    expect(pri).toBeGreaterThan(bal);
  });
});

describe('hourly history', () => {
  it('buckets the last 24 h by hour, folds fish species together, drops older rows', () => {
    const now = T0 + 30 * 60_000; const h0 = Math.floor(now / HOUR_MS) * HOUR_MS;
    const s = hourlySeries([
      { type: 'ore', id: 'iron', qty: 5, t: h0 }, { type: 'ore', id: 'iron', qty: 3, t: h0 - HOUR_MS }, { type: 'fish', id: 'perch', qty: 2, t: h0 },
      { type: 'fish', id: 'bass', qty: 1, t: h0 }, { type: 'ore', id: 'iron', qty: 99, t: h0 - 30 * HOUR_MS },
    ], now);
    expect(s.hours).toHaveLength(24); expect(s.hours[23]).toBe(h0);
    const iron = s.series.find((x) => x.key === 'iron')!; expect(iron.values[23]).toBe(5); expect(iron.values[22]).toBe(3); expect(iron.total).toBe(8);
    expect(s.series.find((x) => x.key === 'fish')!.values[23]).toBe(3);
    expect(last24ByResource([{ type: 'fish', id: 'perch', qty: 2, lastAt: 0 }, { type: 'fish', id: 'bass', qty: 4, lastAt: 0 }]).get('fish')).toBe(6);
  });

  it('the server view returns hourly buckets from the existing pick-up log that add up to the 24 h totals', async () => {
    setPriceIndexForTest(1);
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
    await pool.query(FISH_MIGRATION);
    let now = T0; let s = 7; const unit = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const e = new Employment(pool as never, () => bank, () => now, () => ({ async write() {}, after() {} }), unit); await e.init();
    await pool.query('INSERT INTO players VALUES ($1,$1,$2)', ['lar', new Date(T0 - 2 * DAY).toISOString()]);
    bank.transfer('Lar', 1_000_000, { game: 'admin' }); await bank.flush();
    await e.hire('Lar', 'miner:mine');
    for (let i = 1; i <= 3; i++) { now = T0 + i * HOUR + 60_000; await e.view('Lar'); }
    const v = await e.view('Lar');
    expect(v.hourly?.length).toBeGreaterThan(0);
    for (const b of v.hourly!) expect(b.t % HOUR_MS).toBe(0);
    const byHour = new Map<number, number>(); for (const b of v.hourly!) byHour.set(b.t, (byHour.get(b.t) ?? 0) + b.qty);
    expect([...byHour.values()].every((n) => n <= 30)).toBe(true); // one miner = 30 picks an hour at most
    expect(v.hourly!.reduce((a, b) => a + b.qty, 0)).toBe(v.log!.reduce((a, x) => a + x.qty, 0));
    expect(v.log!.reduce((a, x) => a + x.qty, 0)).toBe(90);
  });
});

describe('production panel', () => {
  it('shows per-hour and 24 h columns, draws one graph line per resource, and the legend hides a line', () => {
    const h0 = Math.floor(T0 / HOUR_MS) * HOUR_MS;
    render(createElement(ProductionPanel, { workers: [wv('a', 'miner:mine', 1)], log: [{ type: 'ore', id: 'iron', qty: 40, lastAt: T0 }, { type: 'ore', id: 'stone', qty: 20, lastAt: T0 }], hourly: [{ type: 'ore', id: 'iron', qty: 25, t: h0 - HOUR_MS }, { type: 'ore', id: 'iron', qty: 15, t: h0 }, { type: 'ore', id: 'stone', qty: 20, t: h0 }], now: T0 }));
    expect(screen.getByTestId('employ-rate-total').textContent).toBe('~30/h');
    expect(screen.getByTestId('employ-graph-line-iron')).toBeTruthy(); expect(screen.getByTestId('employ-graph-line-stone')).toBeTruthy();
    fireEvent.click(screen.getByTestId('employ-legend-stone'));
    expect(screen.queryByTestId('employ-graph-line-stone')).toBeNull();
  });
  it('says the graph is empty instead of drawing nothing', () => {
    render(createElement(ProductionPanel, { workers: [wv('a', 'fisher', 1)], log: [], hourly: [], now: T0 }));
    expect(screen.getByTestId('employ-graph-empty')).toBeTruthy();
  });
  it('the office lists workers in workplace groups with a count header', () => {
    const src = readFileSync(join(process.cwd(), 'client/src/components/EmploymentPanel.tsx'), 'utf8');
    expect(src).toContain('workplaceGroups(v.workers)'); expect(src).toContain('employ-group-count'); expect(src).toContain('<ProductionPanel');
  });
});
