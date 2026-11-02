import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Employment, EMPLOY_MIGRATION, type OreSink } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { setPriceIndexForTest } from '../server/price-index';
import { JOBS, jobById, baseHire, baseWage, dayValue, costShare, itemsPerDay, rollOre, rollWorkerFish, FISHER_ITEM_EV, minerItemEv, MAX_WORKERS, DAY, HOUR, MIN } from '../shared/employment';
import { ORES, payoutFor } from '../shared/mines';
import { FISH_DAILY_MAX, fishPayout } from '../shared/fishing';

const T0 = Date.parse('2026-11-01T12:00:00Z');
function seeded(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
async function setup(ageMs = 2 * DAY) {
  setPriceIndexForTest(1);
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  await pool.query(FISH_MIGRATION);
  let now = T0; const clock = () => now;
  const stored = new Map<string, number>();
  const sink = (): OreSink => ({ async write(cl, items) { for (const [id, n] of items) await cl.query('SELECT $1::int AS n', [n]).then(() => stored.set(id, (stored.get(id) ?? 0) + n)); }, after() {} });
  const e = new Employment(pool, () => bank, clock, sink, seeded(7)); await e.init();
  const addPlayer = (name: string, age = ageMs) => pool.query('INSERT INTO players VALUES ($1,$1,$2)', [name.toLowerCase(), new Date(T0 - age).toISOString()]);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string, game: string) => (db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}' ORDER BY id`) as Array<{ amount: number }>).map((r) => Number(r.amount));
  const cooler = (key: string) => Number(db.public.one(`SELECT count(*) AS n FROM fish_catches WHERE player_key = '${key}' AND sold_at IS NULL`).n);
  return { db, pool, bank, e, addPlayer, fund, chips, ledger, cooler, stored, setNow: (t: number) => { now = t; } };
}
const miner = jobById('miner:mine')!, fisher = jobById('fisher')!;

describe('employment economics', () => {
  it('cost of a worker ≈ 50% of its expected output over the first week, for every job', () => {
    for (const j of JOBS) {
      expect(costShare(j)).toBeGreaterThan(0.47); expect(costShare(j)).toBeLessThan(0.53);
      expect(baseWage(j) / dayValue(j)).toBeLessThan(0.5); // a daily wage alone is still a profit
    }
  });
  it('miners: 144 ores a day from the cave’s own mix (coral excluded); still profitable after the mine sell tiers', () => {
    expect(JOBS.filter((j) => j.kind === 'miner').map((j) => j.cave)).toEqual(['mine', 'frost', 'magma']);
    for (const j of JOBS.filter((x) => x.kind === 'miner')) { expect(itemsPerDay(j)).toBe(144); expect(j.itemEv).toBeCloseTo(minerItemEv(j.cave!)); expect(payoutFor(dayValue(j), 0)).toBeGreaterThan(baseWage(j) + baseHire(j) / 7); }
    // Monte Carlo: the roll matches the cave EV
    const u = seeded(3); let v = 0; const N = 40_000; for (let i = 0; i < N; i++) v += ORES[rollOre('mine', u)].price;
    expect(Math.abs(v / N - minerItemEv('mine')) / minerItemEv('mine')).toBeLessThan(0.05);
  });
  it('fishers: 1 / hour from the normal table without junk; a full day fits under the fish dock daily cap', () => {
    expect(itemsPerDay(fisher)).toBe(24); expect(dayValue(fisher)).toBeLessThan(FISH_DAILY_MAX); expect(fishPayout(dayValue(fisher), 0)).toBeGreaterThan(baseWage(fisher) + baseHire(fisher) / 7);
    const u = seeded(5); let v = 0; const N = 40_000; for (let i = 0; i < N; i++) { const f = rollWorkerFish(u); expect(f.fish.rarity).not.toBe('junk'); v += f.value; }
    expect(Math.abs(v / N - FISHER_ITEM_EV) / FISHER_ITEM_EV).toBeLessThan(0.05);
  });
  it('prices: hire fee and wage are scaled by the price index', async () => {
    const s = await setup(); expect(s.e.hirePrice(miner)).toBe(baseHire(miner)); setPriceIndexForTest(2);
    expect(s.e.wagePrice(miner)).toBeGreaterThan(baseWage(miner) * 1.8); setPriceIndexForTest(1);
  });
});

describe('employment office', () => {
  it('hiring charges fee + first day atomically; new accounts and a 4th worker are refused', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.addPlayer('Kid', 2 * HOUR);
    await s.fund('Gus', 100_000); await s.fund('Kid', 100_000);
    await expect(s.e.hire('Kid', 'miner:mine')).rejects.toThrow(/24 hours/);
    await expect(s.e.hire('Nobody', 'miner:mine')).rejects.toThrow(/24 hours/); // no account row: fail closed
    await s.e.hire('Gus', 'miner:mine');
    expect(s.ledger('gus', 'employ_hire')).toEqual([-(baseHire(miner) + baseWage(miner))]);
    expect(s.chips('gus')).toBe(100_000 - baseHire(miner) - baseWage(miner));
    await s.e.hire('Gus', 'fisher'); await s.e.hire('Gus', 'miner:frost');
    await expect(s.e.hire('Gus', 'miner:magma')).rejects.toThrow(/at most 3/);
    expect((await s.e.view('Gus')).workers).toHaveLength(MAX_WORKERS);
    await s.fund('Poor', 10); await s.addPlayer('Poor');
    await expect(s.e.hire('Poor', 'miner:mine')).rejects.toThrow(/Not enough chips/);
    expect((await s.e.view('Poor')).workers).toHaveLength(0);
  });
  it('1 ore / 10 min, auto-deposited (no collect); the log lists the last 24 h; nothing accrues 8 h after the last visit', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.fund('Gus', 100_000);
    await s.e.hire('Gus', 'miner:mine');
    const total = () => [...s.stored.values()].reduce((a, b) => a + b, 0);
    s.setNow(T0 + 65 * MIN); let v = await s.e.view('Gus');
    expect(total()).toBe(6); expect(Object.keys(v.workers[0]!.box.ores ?? {})).toHaveLength(0);
    expect(v.log!.reduce((a, x) => a + x.qty, 0)).toBe(6); expect(v.log!.every((x) => x.type === 'ore' && x.lastAt <= T0 + 65 * MIN)).toBe(true);
    // away 20 h: the background sweep keeps depositing, but only 8 h past the visit count (48 more)
    s.setNow(T0 + 65 * MIN + 20 * HOUR); await s.e.sweep(); expect(total()).toBe(54);
    s.setNow(T0 + 30 * HOUR); await s.e.sweep(); v = await s.e.view('Gus');
    expect(v.workers[0]!.status).toBe('idle'); expect(s.ledger('gus', 'employ_wage')).toEqual([]);
    // the 24 h log only counts what was picked up after T0+6h
    expect(v.log!.reduce((a, x) => a + x.qty, 0)).toBe(18); // items at T0+6h10m … T0+9h05m
    // re-hire brings them back for a new paid day
    const before = s.chips('gus'); const c2 = await s.e.collect('Gus');
    expect(c2.ores).toBe(0); expect(c2.charged).toBe(baseWage(miner)); expect(s.chips('gus')).toBe(before - baseWage(miner));
    expect((await s.e.view('Gus')).workers[0]!.status).toBe('working');
  });
  it('full storage: the overflow is held by the worker and deposited when room frees up (never lost)', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.fund('Gus', 100_000);
    let cap = 1; const got = new Map<string, number>();
    const e = new Employment(s.pool as never, () => s.bank, () => now, () => ({ room: (id) => Math.max(0, cap - (got.get(id) ?? 0)), async write(_cl, items) { for (const [id, n] of items) got.set(id, (got.get(id) ?? 0) + n); }, after() {} }), seeded(7));
    let now = T0; await e.hire('Gus', 'miner:mine');
    now = T0 + 60 * MIN; let v = await e.view('Gus');
    const sum = () => [...got.values()].reduce((a, b) => a + b, 0);
    expect(sum()).toBe(got.size); expect(sum()).toBeLessThan(6); expect(sum() + Object.values(v.workers[0]!.box.ores ?? {}).reduce((a, n) => a + (n ?? 0), 0)).toBe(6);
    expect(v.notes!.join(' ')).toMatch(/full/);
    cap = 1000; await e.sweep(); v = await e.view('Gus');
    expect(sum()).toBe(6); expect(Object.keys(v.workers[0]!.box.ores ?? {})).toHaveLength(0);
  });
  it('rollout: a haul left in a worker box from the old Collect button is deposited by the first sweep', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.fund('Gus', 100_000); await s.e.hire('Gus', 'miner:mine');
    await s.pool.query(`UPDATE employ_workers SET box = $1`, [JSON.stringify({ ores: { copper: 7 } })]);
    await s.e.sweep(); expect(s.stored.get('copper')).toBe(7);
    expect(JSON.parse(String(s.db.public.one('SELECT box FROM employ_workers').box)).ores).toEqual({});
  });
  it('survives a restart (new instance, same DB) and charges the next day’s wage while you keep visiting', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.fund('Gus', 100_000); await s.e.hire('Gus', 'miner:mine');
    for (let h = 6; h <= 24; h += 6) { s.setNow(T0 + h * HOUR); await s.e.collect('Gus'); }
    s.setNow(T0 + 26 * HOUR);
    const e2 = new Employment(s.pool as never, () => s.bank, () => T0 + 26 * HOUR, () => ({ async write() {}, after() {} }), seeded(9));
    const v = await e2.view('Gus');
    expect(s.ledger('gus', 'employ_wage')).toEqual([-baseWage(miner)]);
    expect(v.workers[0]!.paidUntil).toBe(T0 + 2 * DAY);
  });
  it('can’t pay → stops (no debt); fire any time with no refund', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.fund('Gus', baseHire(miner) + baseWage(miner));
    const { id } = await s.e.hire('Gus', 'miner:mine'); expect(s.chips('gus')).toBe(0);
    for (let h = 6; h <= 24; h += 6) { s.setNow(T0 + h * HOUR); await s.e.collect('Gus'); }
    s.setNow(T0 + 27 * HOUR); const v = await s.e.view('Gus');
    expect(v.workers[0]!.status).toBe('unpaid'); expect(s.chips('gus')).toBe(0);
    const n = [...s.stored.values()].reduce((a, b) => a + b, 0); expect(n).toBe(144);
    await s.e.fire('Gus', id); expect((await s.e.view('Gus')).workers).toHaveLength(0); expect(s.chips('gus')).toBe(0);
  });
  it('fish go to the cooler marked hired (not on the board), up to the cooler limit', async () => {
    const s = await setup(); await s.addPlayer('Gus'); await s.fund('Gus', 100_000); await s.e.hire('Gus', 'fisher');
    s.setNow(T0 + 5 * HOUR + MIN); await s.e.view('Gus'); expect(s.cooler('gus')).toBe(5);
    expect(Number(s.db.public.one(`SELECT count(*) AS n FROM fish_catches WHERE hired = true`).n)).toBe(5);
    expect(s.db.public.many(`SELECT species FROM fish_catches`).every((r: { species: string }) => r.species !== 'boot')).toBe(true);
  });
});
