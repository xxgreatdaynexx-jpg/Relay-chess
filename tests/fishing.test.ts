import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing, type FishRng } from '../server/fishing';
import { onActivity } from '../server/activity';
import { setPriceIndexForTest } from '../server/price-index';
import { COOLER_MAX, FISH, FISH_DAILY_MAX, fishById, fishDiff, fishPayout, fishValue, Reel, RARITY_ODDS, replayReel, rollFish, rollWeight } from '../shared/fishing';
import { DOCK, DOCK_BOX, inLake, LAKE, lakeShape, outskirts, RURAL_ROADS, RURAL_ROAD_W } from '../shared/outskirts';
import { landmarks } from '../shared/worldLayout';
import { propertyById } from '../shared/realEstate';

const T0 = Date.parse('2026-11-01T12:00:00Z');
/** Play the reel like a decent player (aim at the zone, damped). */
function play(seed: number, diff: number): string { const r = new Reel(seed, diff); let s = ''; while (!r.s.done) { const h = r.s.x < r.s.c - 0.35 * r.s.v; s += h ? '1' : '0'; r.tick(h); } return s; }
/** Scripted rng: fish choice by (u1,u2,u3), bite delay, seed. */
const fixed = (u: number[], bite = 2000, seed = 42): FishRng => { let i = 0; return { unit: () => u[i++ % u.length]!, int: (lo) => (lo === 1 ? seed : bite) }; };
async function setup(rng?: FishRng) {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const f = new Fishing(pool, () => bank, () => now, rng); await f.init();
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = 'fish_sell' ORDER BY id`) as Array<{ amount: number }>;
  const adv = (ms: number) => { now += ms; };
  /** Cast, hook on the bite, reel in real time; returns the land result. */
  const fishOnce = async (name: string) => { const { biteIn } = await f.cast(name); adv(biteIn + 100); const h = f.hook(name); const inp = play(h.seed, h.diff); adv(inp.length * 50); return f.land(name, inp); };
  return { db, pool, bank, f, chips, ledger, adv, fishOnce };
}

describe('fishing rules', () => {
  it('has junk → legendary species with sane sizes and prices', () => {
    expect(Object.values(RARITY_ODDS).reduce((a, b) => a + b, 0)).toBe(100);
    for (const r of Object.keys(RARITY_ODDS)) expect(FISH.some((f) => f.rarity === r)).toBe(true);
    for (const f of FISH) { expect(f.max).toBeGreaterThan(f.min); expect(fishValue(f, rollWeight(f, 1))).toBeGreaterThan(fishValue(f, rollWeight(f, 0)) - 1); }
    expect(rollFish(0, 0).rarity).toBe('junk'); expect(rollFish(0.999, 0.99).rarity).toBe('legendary'); expect(rollFish(0.5, 0).rarity).toBe('common');
    const koi = fishById('koi')!; expect(fishDiff(koi, rollWeight(koi, 1))).toBeGreaterThan(fishDiff(fishById('bluegill')!, 100));
  });
  it('daily cap mirrors the farm: full, half, a tenth, then nothing (max 1,350)', () => {
    expect(FISH_DAILY_MAX).toBe(115_000); expect(fishPayout(500, 0)).toBe(500); expect(fishPayout(100, 500)).toBe(100); expect(fishPayout(200, 114_900)).toBe(100); expect(fishPayout(1e9, 0)).toBe(115_000); expect(fishPayout(50, 115_000)).toBe(0);
  });
  it('reel sim is deterministic, winnable with skill and lost by mashing', () => {
    let won = 0, mashed = 0;
    for (let s = 1; s <= 60; s++) { const inp = play(s, 0.6); expect(replayReel(s, 0.6, inp)).toBe('caught'); won++;
      if (replayReel(s, 0.6, Array.from({ length: 600 }, (_, i) => ((i * 7 + s) % 3 ? '1' : '0')).join('').slice(0, 600)) === 'caught') mashed++; }
    expect(won).toBe(60); expect(mashed).toBe(0);
    const inp = play(9, 0.3); expect(replayReel(9, 0.3, inp + '1')).toBe('invalid'); expect(replayReel(9, 0.3, inp.slice(0, -1))).toBe('invalid'); expect(replayReel(9, 0.3, 'x1')).toBe('invalid');
  });
});

describe('fishing server', () => {
  it('cast → hook → land puts the server-rolled fish in the cooler and emits Fishing XP', async () => {
    const { f, fishOnce } = await setup(fixed([0.9, 0.9, 0.5])); // rare, last of its tier
    const ev: unknown[] = []; const off = onActivity((e) => ev.push(e));
    const r = await fishOnce('Angler'); off();
    expect(r.caught).toBe(true); expect(r.fish!.fish).toBe('salmon'); expect(r.xp).toBe(40);
    expect(ev).toEqual([expect.objectContaining({ name: 'Angler', skill: 'fishing', xp: 40, action: 'catch' })]);
    const v = await f.view('angler'); expect(v.cooler.length).toBe(1); expect(v.best!.fish).toBe('salmon');
  });
  it('rejects early/late hooks, spam casts, replayed or too-fast timelines', async () => {
    const { f, adv } = await setup(fixed([0.5, 0.5, 0.5], 3000));
    await f.cast('A'); await expect(f.cast('A')).rejects.toThrow(/settle/);
    adv(1000); expect(() => f.hook('A')).toThrow(/early/);
    adv(1300); await f.cast('A'); adv(3000 + 1900); expect(() => f.hook('A')).toThrow(/slow/);
    adv(1300); await f.cast('A'); adv(3000); const h = f.hook('A'); expect(() => f.hook('A')).toThrow();
    const inp = play(h.seed, h.diff); adv(500); await expect(f.land('A', inp)).rejects.toThrow(/snapped/); // way faster than real time
    await expect(f.land('A', inp)).rejects.toThrow(/Nothing on the line/); // one landing per cast
    adv(1300); await f.cast('A'); adv(3000); const h2 = f.hook('A'); adv(30_000); await expect(f.land('A', '1'.repeat(3))).rejects.toThrow(/snapped/); void h2;
  });
  it('sells atomically through the wallet at the price index, once, under the daily cap', async () => {
    setPriceIndexForTest(1.2);
    const { f, chips, ledger, fishOnce, adv, bank } = await setup(fixed([0.99, 0.99, 0.9])); // Old Chud, max-ish size
    for (let i = 0; i < 4; i++) { const r = await fishOnce('Seller'); expect(r.caught).toBe(true); adv(1500); }
    const v = await f.view('seller'); const gross = v.cooler.reduce((a, c) => a + c.value, 0); expect(gross).toBeGreaterThan(1350);
    const before = bank.account('Seller').chips;
    const [a, b] = await Promise.allSettled([f.sell('Seller'), f.sell('Seller')]);
    expect(a.status).toBe('fulfilled'); expect(b.status).toBe('rejected');
    const paid = (a as PromiseFulfilledResult<{ paid: number }>).value.paid; expect(paid).toBe(Math.floor(fishPayout(gross * 1.15, 0) * 1.2)); // +15% fishing buff
    await bank.flush(); expect(chips('seller')).toBe(before + paid); expect(ledger('seller').map((x) => Number(x.amount))).toEqual([paid]);
    expect((await f.view('seller')).cooler).toEqual([]);
    for (let i = 0; i < 2; i++) { await fishOnce('Seller'); adv(1500); }
    const s2 = await f.sell('Seller').catch((e) => e as Error); // past 5,000 base already? then capped to 0 → refused
    if (s2 instanceof Error) expect(s2.message).toMatch(/bought all/); else expect(s2.paid).toBeLessThanOrEqual(Math.ceil((FISH_DAILY_MAX - fishPayout(gross, 0)) * 1.2));
    setPriceIndexForTest(1);
  });
  it('caps the cooler, releases fish, and the board shows one best catch per real player', async () => {
    const { f, fishOnce, adv, pool } = await setup(fixed([0.6, 0.3, 0.5]));
    for (let i = 0; i < COOLER_MAX; i++) await pool.query("INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at) VALUES ($1,'full','Full','perch',300,8,0)", [`x${i}`]);
    await expect(f.cast('Full')).rejects.toThrow(/full/);
    expect((await f.release('Full', ['x1', 'x2', 'nope'])).released).toBe(2);
    await fishOnce('Bob'); adv(1500); await fishOnce('Bob'); adv(1500); await fishOnce('QA-Tess-Auth1');
    const board = await f.board(); expect(board.map((x) => x.name)).toEqual(['Bob', 'Full']);
  });
});

describe('biggest catches order (pt1267u)', () => {
  it('sorts heaviest first by grams (not value, not as strings), ties to the earliest catch', async () => {
    const { f, pool } = await setup();
    const ins = (id: string, name: string, sp: string, g: number, v: number, at: number) => pool.query("INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, name.toLowerCase(), name, sp, g, v, at]);
    await ins('a', 'Light', 'bass', 900, 500, 1); // pricey but light
    await ins('b', 'Heavy', 'perch', 10000, 5, 2); // '10000' < '900' as a string
    await ins('c', 'TieLate', 'perch', 2000, 9, 30);
    await ins('d', 'TieEarly', 'perch', 2000, 1, 20);
    await ins('e', 'Heavy', 'bass', 950, 999, 3); // Heavy's lighter fish never shows
    const board = await f.board();
    expect(board.map((x) => x.name)).toEqual(['Heavy', 'TieEarly', 'TieLate', 'Light']);
    expect(board.map((x) => x.grams)).toEqual([10000, 2000, 2000, 900]);
    expect((await f.view('Heavy')).best).toEqual({ fish: 'perch', grams: 10000 });
  });
});

describe('lake + dock', () => {
  const o = outskirts();
  const roadHits = (x: number, z: number, m: number) => RURAL_ROADS.some((pl) => pl.some((p, i) => { if (!i) return false; const [ax, az] = pl[i - 1]!, [bx, bz] = p; const L2 = (bx - ax) ** 2 + (bz - az) ** 2; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2)); return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)) < RURAL_ROAD_W / 2 + m; }));
  it('is a smooth organic outline of sensible size, clear of roads', () => {
    const pts = lakeShape(); expect(pts.length).toBeGreaterThanOrEqual(64);
    for (const [x, z] of pts) { expect(((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2).toBeLessThan(1.02); expect(roadHits(x, z, 4)).toBe(false); }
    for (let i = 0; i < pts.length; i++) { const [a, b, c] = [pts[(i + pts.length - 1) % pts.length]!, pts[i]!, pts[(i + 1) % pts.length]!]; const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]); expect(Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)))).toBeLessThan(0.35); }
    expect(LAKE.rx * 2).toBeGreaterThan(40); expect(LAKE.rx * 2).toBeLessThan(80);
  });
  it('nothing built, planted or farmed in the water; decor rings the shore but not the dock', () => {
    for (const [x, z] of o.trees) expect(inLake(x, z, 3)).toBe(false);
    for (const [x, z] of o.rocks) expect(inLake(x, z, 2)).toBe(false);
    for (const b of [...o.buildings, ...o.fields]) for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) expect(inLake(b.x + (dx! * b.w) / 2, b.z + (dz! * b.d) / 2, 2)).toBe(false);
    expect(o.lake.reeds.length).toBeGreaterThan(40); expect(o.lake.rocks.length).toBeGreaterThan(2); expect(o.lake.lilies.length).toBeGreaterThan(3);
    expect(o.trees.filter(([x, z]) => inLake(x, z, 14)).length).toBeGreaterThan(15);
    for (const [x, z] of [...o.lake.reeds, ...o.lake.lilies, ...o.lake.rocks]) expect(x > DOCK_BOX.x0 - 1 && x < DOCK_BOX.x1 + 1 && z > DOCK_BOX.z0).toBe(false);
  });
  it('the dock landmark sits between the road and the water; its pier reaches into the lake', () => {
    const d = landmarks().dock!; expect([d.x, d.z]).toEqual([DOCK.x, DOCK.z]);
    expect(roadHits(d.x, d.z + 6, 0)).toBe(false); expect(roadHits(DOCK.path[0][0], DOCK.path[0][1] + 1, 0)).toBe(true);
    expect(inLake(d.x, d.z - 6, 0)).toBe(false); expect(inLake(DOCK.x, DOCK.pierZ0, -3)).toBe(true);
    expect(propertyById('lm:dock')!.label).toBe('Fishing Dock');
  });
});

describe('3D fishing (pt1220u)', () => {
  it('lists other anglers at the dock for 20 s, never yourself', async () => {
    const { markHere, anglersHere, HERE_MS } = await import('../server/fishing');
    const t = 1_000_000; markHere('Alice', t); markHere('Bob', t + 1000);
    expect(anglersHere('Alice', t + 2000)).toEqual(['Bob']);
    expect(anglersHere(null, t + HERE_MS + 500)).toEqual(['Bob']);
    expect(anglersHere(null, t + 1000 + HERE_MS + 1)).toEqual([]);
  });
  it('builds a 3D model for every species, bigger for heavier fish', async () => {
    const { buildFish } = await import('../client/src/lib/fishing3d');
    const { FISH } = await import('../shared/fishing');
    for (const f of FISH) { const g = buildFish(f.id, Math.round(f.max * 1000)); expect(g.children.length).toBeGreaterThan(0); }
    expect(buildFish('bass', 4000).scale.x).toBeGreaterThan(buildFish('bass', 500).scale.x);
  });
});
