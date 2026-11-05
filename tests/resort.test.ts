// Chud Resort: travel ticket, location gates, resort slots (RTP), properties, plantation and the Coral Grotto.
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { getBank, resetBank, CasinoBank, PgCasinoStore, isChipEvent } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { Travel, setTravel, isAtResort } from '../server/travel';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { MACHINES, RESORT_MACHINE_IDS, MACHINE_IDS, BUY_BONUS_MULT, mulberry32, simulate, simulateBuy, playRound, isMachineId } from '../shared/video-slots';
import { RESORT_TICKET_BASE, resortLots, resortPlots, TROPICAL_CROPS, RESORT_TYPES, resortFarmPrice, resortEstateFarmPrice, RESORT_X0, RESORT_X1, RESORT_Z0, RESORT_Z1, SHORE_Z, RESORT_SPOTS } from '../shared/resort';
import { properties, propertyById, BASE_PRICE, taxOf, sellBackOf } from '../shared/realEstate';
import { CAVES, CELL, ORES, caveValueRate, inExit } from '../shared/mines';
import { canStand } from '../shared/fps';
import { obbOverlap } from '../shared/worldLayout';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}

describe('resort travel', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravel(new Travel(null)); });
  it('ticket costs px(500), return is free, can’t double-fly, broke players are refused', async () => {
    const t = new Travel(null); setTravel(t); const b = getBank(); b.transferConfirmed('QA-Fly', 2000 - b.account('QA-Fly').chips, { key: 'seed', game: 'admin' });
    expect(t.status('QA-Fly')).toMatchObject({ loc: 'city', ticket: RESORT_TICKET_BASE });
    const r = await t.fly('QA-Fly'); expect(r.fee).toBe(500); expect(b.account('QA-Fly').chips).toBe(1500); expect(isAtResort('qa-fly')).toBe(true);
    await expect(t.fly('QA-Fly')).rejects.toThrow(/already/);
    await t.home('QA-Fly'); expect(isAtResort('QA-Fly')).toBe(false); expect(b.account('QA-Fly').chips).toBe(1500);
    setPriceIndexForTest(2); expect(t.status(null).ticket).toBe(1000);
    b.transfer('QA-Broke', -b.account('QA-Broke').chips, { game: 'admin' }); await expect(t.fly('QA-Broke')).rejects.toThrow(/Not enough chips/);
    expect(isChipEvent('trip_buy')).toBe(true);
  });
  it('on Postgres: ticket ledger row + location persist atomically and reload', async () => {
    const db = new PGlite(); const t = new Travel(shim(db) as never); await t.init(); await t.init();
    const b = getBank(); b.transferConfirmed('QA-Pg', 3000, { key: 'f:pg', game: 'admin' });
    await t.fly('QA-Pg');
    const t2 = new Travel(shim(db) as never); await t2.init(); expect(t2.where('QA-Pg')).toBe('resort');
    await t2.home('QA-Pg'); const t3 = new Travel(shim(db) as never); await t3.init(); expect(t3.where('QA-Pg')).toBe('city');
  });
});

describe('resort slots', () => {
  // Same seeds as the city RTP checks in tests/video-slots.test.ts: identical tables give identical results.
  const SEEDS: Record<string, number> = { dragon: 7, warzone: 7, goldrush: 7 };
  it('three new themed machines, distinct symbols, each reusing a city engine’s exact pay table and reel weights', () => {
    expect(RESORT_MACHINE_IDS).toEqual(['lagoon', 'yacht', 'pearl']); expect(MACHINE_IDS).toEqual(['dragon', 'warzone', 'goldrush']);
    const citySyms = new Set(MACHINE_IDS.flatMap((m) => MACHINES[m].symbols.map((s) => s.id)));
    for (const m of RESORT_MACHINE_IDS) {
      const c = MACHINES[m], twin = MACHINES[c.engine]; expect(isMachineId(m)).toBe(true);
      expect(c.weights).toEqual(twin.weights); expect(c.symbols.map((s) => [s.kind, s.pays])).toEqual(twin.symbols.map((s) => [s.kind, s.pays]));
      for (const s of c.symbols) expect(citySyms.has(s.id)).toBe(false);
      expect(BUY_BONUS_MULT[m]).toBe(BUY_BONUS_MULT[c.engine]);
      const r = playRound(m, 20, mulberry32(7)); expect(r.machine).toBe(m);
      for (const st of r.steps) for (const reel of st.final) for (const id of reel) expect(c.symbols.some((s) => s.id === id)).toBe(true);
    }
  });
  for (const m of RESORT_MACHINE_IDS) {
    it(`${m} RTP is within 94%–96% (seeded simulation, 1.5M spins) and buy-bonus RTP too`, () => {
      const s = simulate(m, 1_500_000, mulberry32(SEEDS[MACHINES[m].engine])); console.log(`[resort-rtp] ${m}`, JSON.stringify(s));
      expect(s.rtp).toBeGreaterThanOrEqual(0.94); expect(s.rtp).toBeLessThanOrEqual(0.96);
      const twin = simulate(MACHINES[m].engine, 1_500_000, mulberry32(SEEDS[MACHINES[m].engine])); expect(s.rtp).toBeCloseTo(twin.rtp, 10); // same engine + tables = same outcomes
      const b = simulateBuy(m, m === 'warzone' || m === 'yacht' ? 60_000 : 20_000, mulberry32(99)); console.log(`[resort-buy-rtp] ${m}`, JSON.stringify(b));
      expect(b.rtp).toBeGreaterThan(0.85); expect(b.rtp).toBeLessThan(1.05);
    }, 120_000);
  }
});

describe('resort properties and plantation', () => {
  it('lots are unique, on land inside the map, not overlapping, and priced above the city equivalents', () => {
    const lots = resortLots(); expect(lots.length).toBeGreaterThanOrEqual(18);
    expect(new Set(lots.map((l) => l.id)).size).toBe(lots.length);
    for (const l of lots) { expect(l.x - l.w / 2).toBeGreaterThan(RESORT_X0); expect(l.x + l.w / 2).toBeLessThan(RESORT_X1); expect(l.z - l.d / 2).toBeGreaterThan(RESORT_Z0); expect(l.z + l.d / 2).toBeLessThan(SHORE_Z); }
    const all = [...lots, ...resortPlots(), ...RESORT_SPOTS.filter((s) => s.id !== 'r-marina').map((s) => ({ ...s, rot: 0 }))];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(obbOverlap(all[i]!, all[j]!, 0.5), `${i}/${j}`).toBe(false);
    expect(RESORT_TYPES.beachhouse!.price).toBeGreaterThan(BASE_PRICE.house!); expect(RESORT_TYPES.condo!.price).toBeGreaterThan(BASE_PRICE.apartment!); expect(RESORT_TYPES.villa!.price).toBeGreaterThan(BASE_PRICE.tower! * 0.9); expect(RESORT_TYPES.hotel!.price).toBeGreaterThan(BASE_PRICE.tower!);
    for (const l of lots) { const p = propertyById(l.id)!; expect(p.map).toBe('resort'); expect(p.price).toBe(l.price); expect(taxOf(p.price)).toBe(Math.ceil(p.price * 0.005)); expect(sellBackOf(p.price)).toBe(Math.floor(p.price * 0.7)); }
    const rp = properties().filter((p) => p.map === 'resort').map((p) => p.price); console.log('[resort-prices]', Math.min(...rp), Math.max(...rp));
    for (const f of resortPlots()) expect(propertyById(`rf:${f.n}`)!.price).toBe(f.estate ? resortEstateFarmPrice(f.cols * f.rows) : resortFarmPrice(f.cols * f.rows));
  });
  it('tropical crops are profitable and slow-to-valuable', () => {
    for (let i = 1; i < TROPICAL_CROPS.length; i++) expect(TROPICAL_CROPS[i]!.grow).toBeGreaterThan(TROPICAL_CROPS[i - 1]!.grow);
    for (const c of TROPICAL_CROPS) expect(c.sell).toBeGreaterThan(c.seed);
    expect(TROPICAL_CROPS.map((c) => c.id)).toEqual(expect.arrayContaining(['coconut', 'pineapple', 'mango']));
  });
  it('buy a plantation plot and plant tropical crops (city crops refused there, tropical refused in the city)', async () => {
    setPriceIndexForTest(1);
    const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const re = new RealEstate(pool, () => bank, () => Date.parse('2026-11-01T12:00:00Z')); await re.init();
    const farm = new Farm(pool, () => bank, () => Date.parse('2026-11-01T12:00:00Z')); await farm.init();
    bank.transfer('QA-Isle', 50_000, { game: 'admin' }); await bank.flush();
    await re.buy('QA-Isle', 'rf:1');
    await expect(farm.plant('QA-Isle', 'rf:1', 'wheat', [0])).rejects.toThrow(/tropical/i);
    await farm.plow('QA-Isle', 'rf:1', [0, 1]); const r = await farm.plant('QA-Isle', 'rf:1', 'coconut', [0, 1]) as { cost?: number }; expect(r).toBeTruthy();
    const v = await farm.view('rf:1', 'QA-Isle'); expect(v.tiles.length).toBe(2); expect(v.cols).toBe(resortPlots()[0]!.cols);
    await re.buy('QA-Isle', 'f:1'); await expect(farm.plant('QA-Isle', 'f:1', 'mango', [0])).rejects.toThrow(/Chud Resort/);
  });
});

describe('Coral Grotto', () => {
  it('fully connected, spawns in the EXIT lift, payout a premium over The Mine (#10d)', () => {
    const map = CAVES.coral.map; const W = map.w / CELL, D = map.d / CELL;
    const open = (x: number, y: number) => canStand(x * CELL + 1, y * CELL + 1, 0, map);
    const seen = new Set<string>(); const q = [[Math.floor(map.spawns[0]![0] / CELL), Math.floor(map.spawns[0]![1] / CELL)]];
    while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || !open(x!, y!)) continue; seen.add(k); q.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]); }
    let total = 0; for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (open(x, y)) total++;
    expect(seen.size).toBe(total);
    // every ore node sits next to a reachable floor cell
    for (const n of CAVES.coral.nodes) { const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL); expect([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${cx + dx!},${cy + dy!}`)), `node ${n.id}`).toBe(true); }
    for (const s of map.spawns) expect(inExit(s[0], s[1])).toBe(true);
    const nv = (id: 'coral') => CAVES[id].nodes.reduce((a, n) => a + ORES[n.ore].price, 0) / CAVES[id].nodes.length; // pt1354u: real placed nodes, not the theoretical rate
    expect(caveValueRate(CAVES.coral)).toBeGreaterThan(0); const ratio = nv('coral') / 7.297; // pt1379u: vs The Mine before request #25 cut its gold; nv('mine') now lower by design console.log('[coral-payout]', ratio.toFixed(3));
    expect(ratio).toBeGreaterThan(1.2); expect(ratio).toBeLessThan(1.5); // #10d: the resort Grotto is the premium cave (costs a flight)
  });
});
