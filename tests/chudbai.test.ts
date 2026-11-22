// Chudbai: premium travel, light-sweet oil sim, concessions, in-person exchange with Fort McChud's daily tiers, Postgres.
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank, isChipEvent } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { Travel, setTravel, isAtChudbai, setTicketWaiver, awayFromMarket, MARKET_AWAY_MSG } from '../server/travel';
import { Chudbai } from '../server/chudbai';
import { SINK_DEBIT_GAMES } from '../shared/sinkRoom';
import { DESTINATIONS } from '../shared/resort';
import * as F from '../shared/fortmc';
import {
  CHUDBAI_TICKET_BASE, DESERT_WELL_COST, ESP_COST, EXPORT_LEVY, G_GRID_MW, G_PIPES, G_PRODUCTS, G_SURVEY_COST, G_TRACTS, G_UNITS, G_WATER_CUT,
  OFFSHORE_FROM, OFFSHORE_WELL_COST, SELL_TIERS, STEP_MS, exchangeGross, gPowerDemand, gSettle, gStep, gTractInfo, gulfBuildValue, gulfWorth, newGulf,
  sellPayout, wellCost, wellMw, wellRate, type GulfState,
} from '../shared/chudbai';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
const seed = (n: string, chips: number) => { const b = getBank(); b.transfer(n, chips - b.account(n).chips, { game: 'admin' }); };
const H = 3600_000;

describe('travel to Chudbai', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravel(new Travel(null)); setTicketWaiver(null); });
  it('premium ticket px(12000), a sink, free return; away from city markets', async () => {
    const t = new Travel(null); setTravel(t); seed('QA-Gulf', 20_000);
    expect(t.status('QA-Gulf').tickets.chudbai).toBe(CHUDBAI_TICKET_BASE);
    expect(CHUDBAI_TICKET_BASE).toBeGreaterThanOrEqual(5 * DESTINATIONS.fortmc.ticket);
    const r = await t.fly('QA-Gulf', 'chudbai'); expect(r.fee).toBe(12_000); expect(getBank().account('QA-Gulf').chips).toBe(8_000);
    expect(isAtChudbai('QA-Gulf')).toBe(true);
    expect(SINK_DEBIT_GAMES.has('chudbai_ticket')).toBe(true); expect(SINK_DEBIT_GAMES.has('chudbai_upkeep')).toBe(true); expect(SINK_DEBIT_GAMES.has('chudbai')).toBe(false);
    expect(() => awayFromMarket('QA-Gulf', Error)).toThrow(MARKET_AWAY_MSG);
    expect(isChipEvent('chudbai_act')).toBe(true);
    await t.home('QA-Gulf'); expect(t.where('QA-Gulf')).toBe('city');
  });
  it('private jets fly free', async () => {
    const t = new Travel(null); setTravel(t); seed('QA-GJet', 0); setTicketWaiver((n) => (n === 'QA-GJet' ? 'Private jet' : null));
    const r = await t.fly('QA-GJet', 'chudbai'); expect(r.fee).toBe(0); expect(isAtChudbai('QA-GJet')).toBe(true);
  });
});

describe('Chudbai oil is a different, pricier oil', () => {
  it('light sweet: no sulfur product, little residue, and every cost is several times Fort McChud', () => {
    expect(Object.keys(G_PRODUCTS)).not.toContain('sulfur');
    expect(G_PRODUCTS.crude.name).toMatch(/Light Sweet/);
    expect(G_UNITS.refinery.out.find(([p]) => p === 'fueloil')![1]).toBeLessThan(0.1);
    expect(DESERT_WELL_COST / F.WELL_COST).toBeGreaterThanOrEqual(4); expect(OFFSHORE_WELL_COST / F.WELL_COST).toBeGreaterThanOrEqual(8);
    expect(G_UNITS.refinery.cost / F.UNITS.refinery.cost).toBeGreaterThanOrEqual(3);
    expect(G_UNITS.stabilizer.cost / F.UNITS.separator.cost).toBeGreaterThanOrEqual(4);
    expect(G_SURVEY_COST / F.SURVEY_COST).toBeGreaterThanOrEqual(5);
    expect(G_PRODUCTS.crude.price).toBeGreaterThan(2 * F.PRODUCTS.crude.price);
    for (let n = 1; n <= G_TRACTS; n++) expect(gTractInfo(n).offshore).toBe(n >= OFFSHORE_FROM);
  });
  it('starter paybacks land in the 10–30 day band (tier 1, ex-repair, with the levy and the ticket)', () => {
    const pb = (n: number, esp = false) => {
      const t = gTractInfo(n); const capex = G_SURVEY_COST + t.lease + wellCost(n) + G_PIPES[1].cost + G_UNITS.stabilizer.cost + (esp ? ESP_COST : 0) + CHUDBAI_TICKET_BASE;
      const ws = Math.min(wellRate(n) * t.richness * (esp ? 1.6 : 1), G_PIPES[1].cap); const pr = Math.min(1, G_GRID_MW / (wellMw(n) + (esp ? 0.6 : 0) + G_UNITS.stabilizer.mw));
      const day = ws * (1 - G_WATER_CUT - t.gas) * pr * 24; return capex / sellPayout(exchangeGross('crude', day), 0);
    };
    const all = Array.from({ length: G_TRACTS }, (_, i) => pb(i + 1));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(10); expect(Math.max(...all)).toBeLessThanOrEqual(30);
    for (let n = 1; n <= G_TRACTS; n++) expect(pb(n, true)).toBeLessThan(pb(n)); // ESP is the best first upgrade
    expect(G_UNITS.stabilizer.mw + wellMw(1) + G_UNITS.refinery.mw).toBeLessThanOrEqual(G_GRID_MW); // starter refinery fits the grid tie
  });
  it('uses Fort McChud’s daily sell tiers', () => { expect(SELL_TIERS).toBe(F.SELL_TIERS); expect(sellPayout(1_000_000, 0)).toBe(F.sellPayout(1_000_000, 0)); });
});

function bigGulf(): GulfState {
  const s = newGulf(0);
  for (const n of [1, 4, 8]) s.tracts[String(n)] = { leased: true, pipe: 2, wells: Array.from({ length: 4 }, () => ({ esp: true, cond: 100 })) };
  const add = (k: keyof typeof G_UNITS, n: number) => { for (let i = 0; i < n; i++) s.units.push({ id: ++s.seq, k, cond: 100, on: true }); };
  add('stabilizer', 4); add('lng', 2); add('refinery', 4); add('aromatics', 2); add('solar', 6); add('tank', 6);
  return s;
}
describe('Chudbai sim', () => {
  it('runs the full chain: crude, LNG, jet fuel, gasoline, paraxylene', () => {
    const s = bigGulf(); for (let i = 0; i < 12 * 6; i++) gStep(s);
    for (const p of ['lng', 'condensate', 'jetfuel', 'gasoline', 'paraxylene'] as const) expect(s.made[p] ?? 0).toBeGreaterThan(0);
    expect(s.power.supply).toBeGreaterThanOrEqual(s.power.demand);
  });
  it('power shortfall throttles; idle units draw nothing', () => {
    const s = newGulf(0); s.units.push({ id: 1, k: 'refinery', cond: 100, on: true }); expect(gPowerDemand(s)).toBe(0);
    const t = bigGulf(); t.units = t.units.filter((u) => u.k !== 'solar'); gStep(t); expect(t.power.demand).toBeGreaterThan(G_GRID_MW);
  });
  it('settle steps whole intervals and caps catch-up at a day', () => {
    const s = bigGulf(); expect(gSettle(s, 3 * STEP_MS + 5)).toBe(3); expect(gSettle(s, 10 * 24 * H)).toBe(288);
  });
  it('net worth is build basis + sellable stock', () => {
    const s = bigGulf(); const b = gulfBuildValue(s); s.stock.jetfuel = 10; s.stock.wellstream = 1000; expect(gulfWorth(s)).toBe(b + 10 * G_PRODUCTS.jetfuel.price);
  });
});

describe('Chudbai server', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravel(new Travel(null)); setTicketWaiver(null); });
  it('is gated on being in Chudbai', async () => {
    const g = new Chudbai(null); seed('QA-G1', 10_000_000);
    await expect(g.act('QA-G1', { op: 'survey', tract: 1 })).rejects.toThrow(/in Chudbai/);
  });
  it('survey → concession → well → pipe → stabilizer → produce → sell (levy + tiers), on Postgres', async () => {
    const db = new PGlite(); const clk = { now: Date.parse('2026-11-22T12:00:00Z') };
    const g = new Chudbai(shim(db) as never, () => clk.now, async () => {}); await g.init();
    const n = 'QA-G2'; seed(n, 5_000_000); const c0 = getBank().account(n).chips;
    await g.act(n, { op: 'survey', tract: 4 }); await g.act(n, { op: 'lease', tract: 4 });
    await expect(g.act('QA-G3', { op: 'lease', tract: 4 })).rejects.toThrow(/Survey it first/);
    seed('QA-G3', 1_000_000); await g.act('QA-G3', { op: 'survey', tract: 4 }); await expect(g.act('QA-G3', { op: 'lease', tract: 4 })).rejects.toThrow(/already holds/);
    await g.act(n, { op: 'drill', tract: 4 }); await g.act(n, { op: 'pipe', tract: 4 }); await g.act(n, { op: 'build', kind: 'stabilizer' });
    const spent = G_SURVEY_COST + gTractInfo(4).lease + DESERT_WELL_COST + G_PIPES[1].cost + G_UNITS.stabilizer.cost;
    expect(getBank().account(n).chips).toBe(c0 - spent);
    clk.now += 10 * H; const v = await g.view(n); const crude = Math.floor(v.gulf.stock.crude ?? 0); expect(crude).toBeGreaterThan(500);
    const r = await g.act(n, { op: 'sell', id: 'crude', qty: 'all' }) as { paid: number };
    expect(r.paid).toBe(sellPayout(Math.floor(crude * G_PRODUCTS.crude.price * (1 - EXPORT_LEVY)), 0));
    const games = (await getBank().recent(n, 10)).map((x: { game: string }) => x.game); expect(games).toContain('chudbai_sale'); expect(games).toContain('chudbai');
    await expect(g.act(n, { op: 'sell', id: 'wellstream', qty: 1 })).rejects.toThrow();
    // reload from Postgres: state, concession and today's sales survive
    const g2 = new Chudbai(shim(db) as never, () => clk.now, async () => {}); await g2.init();
    const v2 = await g2.view(n); expect(v2.gulf.tracts['4']!.wells.length).toBe(1); expect(v2.site.leases['4']!.mine).toBe(true); expect(v2.today.gross).toBeGreaterThan(0);
    expect(await g2.valueOf(n)).toBeGreaterThanOrEqual(spent - G_SURVEY_COST);
    expect(await g2.valueOf('QA-nobody')).toBe(0);
  });
  it('daily tiers apply across sales', async () => {
    const g = new Chudbai(null, () => Date.parse('2026-11-22T12:00:00Z'), async () => {}); const n = 'QA-G4'; seed(n, 0);
    const s = await (g as unknown as { load: (n: string) => Promise<GulfState> }).load(n); s.stock.paraxylene = 10_000; s.units.push({ id: 1, k: 'tank', cond: 100, on: false });
    const a = await g.act(n, { op: 'sell', id: 'paraxylene', qty: 3000 }) as { paid: number }; const b = await g.act(n, { op: 'sell', id: 'paraxylene', qty: 3000 }) as { paid: number };
    const unit = G_PRODUCTS.paraxylene.price * (1 - EXPORT_LEVY);
    expect(a.paid).toBe(sellPayout(Math.floor(3000 * unit), 0)); expect(b.paid).toBeLessThan(a.paid); expect(b.paid).toBe(sellPayout(Math.floor(3000 * unit), Math.floor(3000 * unit)));
  });
});
