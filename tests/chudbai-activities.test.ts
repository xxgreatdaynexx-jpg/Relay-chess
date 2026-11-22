// Chudbai activities beyond oil: Gold Souk trading, the At the Top deck, Gulf dhow fishing.
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newDb } from 'pg-mem';
import { getBank, resetBank } from '../server/casino-store';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { Travel, setTravel, setTicketWaiver } from '../server/travel';
import { Chudbai } from '../server/chudbai';
import { Fishing } from '../server/fishing';
import { SINK_DEBIT_GAMES } from '../shared/sinkRoom';
import { DECK_TICKET_BASE, GOLD_BAR_BASE, GOLD_F_MAX, GOLD_F_MIN, GOLD_MAX_BARS, GOLD_SELL_PER_DAY, GOLD_SPREAD, goldAsk, goldBid, goldNextF } from '../shared/chudbai';
import { CAST_COOLDOWN_MS, FISH, FISH_SPOT_CAP, fishById, fishDailyKey, fishPayout, fishPool, isFishSpot, RARITY_ODDS, Reel, rollFish, spotOf, type Rarity } from '../shared/fishing';
import { hasItemIcon, itemIconSvg } from '../shared/itemIcons';
import { fishingLoc, locLabel, parseLoc, WAREHOUSE } from '../shared/inventoryLocations';

const T0 = Date.parse('2026-11-22T12:00:00Z'); const DAY = 86_400_000;
const seed = (n: string, chips: number) => { const b = getBank(); b.transfer(n, chips - b.account(n).chips, { game: 'admin' }); };
function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? 0 }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
function play(seed: number, diff: number): string { const r = new Reel(seed, diff); let s = ''; while (!r.s.done) { const h = r.s.x < r.s.c - 0.35 * r.s.v; s += h ? '1' : '0'; r.tick(h); } return s; }

describe('Gold Souk', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravel(new Travel(null)); setTicketWaiver(null); });
  it('the daily price walks at most 3% a day (plus mean reversion) inside 85%..115%', () => {
    for (let p = GOLD_F_MIN; p <= GOLD_F_MAX + 1e-9; p += 0.01) for (const u of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const n = goldNextF(p, u); expect(n).toBeGreaterThanOrEqual(GOLD_F_MIN); expect(n).toBeLessThanOrEqual(GOLD_F_MAX);
      expect(Math.abs(n - p)).toBeLessThanOrEqual(0.03 * p + 0.15 * Math.abs(1 - p) + 1e-4);
    }
    expect(goldNextF(1, 0.5)).toBe(1); expect(goldNextF(1.15, 0.5)).toBeLessThan(1.15); expect(goldNextF(NaN, 0.5)).toBe(1);
    expect(goldAsk(GOLD_BAR_BASE, 1)).toBe(12_240); expect(goldBid(GOLD_BAR_BASE, 1)).toBe(11_760); expect(GOLD_SPREAD).toBe(0.02);
  });
  it('buy at ask, sell at bid (a 4% round trip), 100-bar holding cap, 25 bars a day sell-back, gated to Chudbai', async () => {
    let now = T0; const g = new Chudbai(null, () => now, async () => {}, () => 0.5); const n = 'QA-Gold'; seed(n, 5_000_000);
    const c0 = getBank().account(n).chips; const v = await g.view(n); expect(v.gold.f).toBe(1); expect(v.gold.ask).toBe(12_240); expect(v.gold.bid).toBe(11_760);
    expect((await g.act(n, { op: 'gold_buy', qty: 30 }) as { paid: number }).paid).toBe(30 * 12_240);
    expect(getBank().account(n).chips).toBe(c0 - 30 * 12_240);
    await expect(g.act(n, { op: 'gold_buy', qty: GOLD_MAX_BARS - 29 })).rejects.toThrow(/at most 100 bars/);
    await g.act(n, { op: 'gold_sell', qty: 20 });
    await expect(g.act(n, { op: 'gold_sell', qty: 6 })).rejects.toThrow(/at most 25 bars a day/);
    await g.act(n, { op: 'gold_sell', qty: 5 }); expect((await g.view(n)).gold.soldToday).toBe(GOLD_SELL_PER_DAY);
    expect(getBank().account(n).chips).toBe(c0 - 30 * 12_240 + 25 * 11_760);
    expect(await g.valueOf(n)).toBe(5 * 11_760); // gold counts at the bid in net worth
    now += DAY; await g.act(n, { op: 'gold_sell', qty: 5 }); expect((await g.view(n)).gold.bars).toBe(0);
    await expect(g.act(n, { op: 'gold_sell', qty: 1 })).rejects.toThrow(/only hold 0/);
    const games = (await getBank().recent(n, 20)).map((x: { game: string }) => x.game); expect(games).toContain('chudbai_gold'); expect(SINK_DEBIT_GAMES.has('chudbai_gold')).toBe(false);
    const gated = new Chudbai(null); seed('QA-Away', 1_000_000);
    await expect(gated.act('QA-Away', { op: 'gold_buy', qty: 1 })).rejects.toThrow(/in Chudbai/);
    await expect(gated.act('QA-Away', { op: 'deck' })).rejects.toThrow(/in Chudbai/);
  });
  it('a round trip always loses (no gold income), even across the best day-to-day move', () => {
    for (let p = GOLD_F_MIN; p <= GOLD_F_MAX; p += 0.01) { const up = goldNextF(p, 0.999999); expect(goldBid(GOLD_BAR_BASE, up) * GOLD_MAX_BARS - goldAsk(GOLD_BAR_BASE, p) * GOLD_MAX_BARS).toBeLessThan(0.04 * GOLD_BAR_BASE * GOLD_MAX_BARS); }
  });
  it('the day price is drawn once per UTC day and stored in Postgres', async () => {
    const db = new PGlite(); let now = T0; let u = 0.9;
    const a = new Chudbai(shim(db) as never, () => now, async () => {}, () => u); await a.init(); const f1 = await a.goldF();
    u = 0.1; const b = new Chudbai(shim(db) as never, () => now, async () => {}, () => u); await b.init(); expect(await b.goldF()).toBe(f1);
    expect(f1).toBe(goldNextF(1, 0.9));
    now += DAY; const c = new Chudbai(shim(db) as never, () => now, async () => {}, () => u); await c.init(); expect(await c.goldF()).toBe(goldNextF(f1, 0.1));
    const rows = (await db.query('SELECT day FROM chudbai_gold_px ORDER BY day')).rows; expect(rows.length).toBe(2);
  });
});

describe('At the Top observation deck', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravel(new Travel(null)); setTicketWaiver(null); });
  it('a price-indexed sightseeing ticket (a sink) with a visit counter', async () => {
    const g = new Chudbai(null, () => T0, async () => {}); const n = 'QA-Deck'; seed(n, 10_000);
    expect(DECK_TICKET_BASE).toBe(2_500); expect(SINK_DEBIT_GAMES.has('chudbai_deck')).toBe(true);
    await g.act(n, { op: 'deck' }); await g.act(n, { op: 'deck' });
    expect(getBank().account(n).chips).toBe(10_000 - 2 * DECK_TICKET_BASE); expect((await g.view(n)).deck).toEqual({ ticket: 2_500, visits: 2 });
    setPriceIndexForTest(2); expect((await g.view(n)).deck.ticket).toBe(5_000);
  });
});

describe('Gulf dhow fishing (Chudbai-only)', () => {
  const dhow = fishPool('dhow'), lagoon = fishPool('lagoon');
  it('15 species with the Pearl Lagoon rarity mix and values, icons, its own 230k cap', () => {
    expect(isFishSpot('dhow')).toBe(true); expect(dhow.length).toBe(15); expect(new Set(FISH.map((f) => f.id)).size).toBe(FISH.length);
    const byR = (p: typeof dhow, r: Rarity) => p.filter((f) => f.rarity === r).map((f) => f.base).sort((a, b) => a - b);
    for (const r of Object.keys(RARITY_ODDS) as Rarity[]) expect(byR(dhow, r)).toEqual(byR(lagoon, r));
    for (const f of dhow) { expect(spotOf(f)).toBe('dhow'); expect(hasItemIcon('fish', f.id)).toBe(true); expect(itemIconSvg('fish', f.id)).toMatch(/^<svg[\s\S]*<\/svg>$/); }
    for (let i = 0; i <= 20; i++) expect(spotOf(rollFish(i / 20.0001, 0.3, 'dhow'))).toBe('dhow');
    expect(FISH_SPOT_CAP.dhow).toBe(230_000); expect(fishPayout(1e9, 0, 'dhow')).toBe(230_000); expect(fishDailyKey('ann', 'dhow')).toBe('ann#dhow');
    expect(fishingLoc('dhow')).toBe(WAREHOUSE); expect(parseLoc('fishing:dhow').kind).toBe('fishing'); expect(locLabel('fishing:dhow')).toMatch(/Chudbai/);
  });
  it('casting needs you in Chudbai; catches land in the city warehouse and sell under the dhow cap', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    let now = T0; const f = new Fishing(pool, () => bank, () => now); await f.init();
    await expect(f.cast('Ann', 'dhow', () => true, () => true, () => false)).rejects.toThrow(/Chudbai/);
    let landed = 0;
    for (let i = 0; i < 40 && landed < 3; i++) { now += CAST_COOLDOWN_MS + 10; const { biteIn } = await f.cast('Ann', 'dhow', () => false, () => false, () => true); now += biteIn + 100; const h = f.hook('Ann'); const inp = play(h.seed, h.diff); now += inp.length * 50; const r = await f.land('Ann', inp).catch(() => null); if (r?.caught) landed++; }
    const v = await f.view('Ann'); expect(v.cooler.length).toBeGreaterThan(0); expect(v.todayBySpot?.dhow).toMatchObject({ paid: 0 });
    for (const c of v.cooler) { expect(spotOf(fishById(c.fish)!)).toBe('dhow'); expect(c.loc).toBe(WAREHOUSE); }
    await f.sell('Ann'); await bank.flush();
    const rows = (await pool.query('SELECT player_key FROM fish_daily')).rows.map((r: { player_key: string }) => r.player_key); expect(rows).toEqual(['ann#dhow']);
  });
});
