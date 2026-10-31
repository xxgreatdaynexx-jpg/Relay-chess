import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { MinesWorld, PgMineStore, resetMines } from '../server/mines';
import { getBank, resetBank } from '../server/casino-store';
import { BACKPACK_CAP, MINE_MAP, MINE_NODES, ORES, REACH, SWING_MIN_MS, payoutFor, oreFor, CELL } from '../shared/mines';
import { canStand, eyeHeightOf } from '../shared/fps';

let w: MinesWorld;
beforeEach(() => { resetBank(); w = resetMines(); });

/** Put the miner on a standable spot within reach of node n, facing it. */
function stand(id: string, nodeIdx: number) {
  const n = MINE_NODES[nodeIdx]; const m = w.miners.get(id)!;
  for (let r = 0.9; r < 2.5; r += 0.1) for (let k = 0; k < 16; k++) {
    const x = n.x + Math.cos((k / 16) * Math.PI * 2) * r, y = n.y + Math.sin((k / 16) * Math.PI * 2) * r;
    if (canStand(x, y, 0, MINE_MAP) && Math.hypot(n.x - x, n.y - y, n.z - eyeHeightOf(m)) - 0.55 < REACH - 0.2) { m.x = x; m.y = y; m.z = 0; try { w.nodes[nodeIdx].hp = w.nodes[nodeIdx].hp; return; } catch { /* */ } }
  }
  throw new Error('no spot near node ' + nodeIdx);
}
/** Sell from outside the mine (the miner steps out for the call, then back). */
const sellAs = (id: string, now: number, only?: string) => { const m = w.miners.get(id); if (m) w.miners.delete(id); try { return w.sell(m ? m.account : null, now, only); } finally { if (m) w.miners.set(id, m); } };
const acct = (id: string) => w.miners.get(id)?.account ?? null;
const mineOut = (id: string, idx: number, t0: number) => { let t = t0; let r; do { r = w.hit(id, idx, t); t += SWING_MIN_MS; } while (!r.broke && !r.full); return { r, t }; };

describe('mines map', () => {
  it('has spawns that can stand, lots of nodes, rarer ore deeper', () => {
    for (const s of MINE_MAP.spawns) expect(canStand(s[0], s[1], 0, MINE_MAP)).toBe(true);
    expect(MINE_NODES.length).toBeGreaterThan(40);
    expect(MINE_NODES.filter((n) => n.depth === 0).some((n) => n.ore === 'diamond' || n.ore === 'gold')).toBe(false);
    const deep = MINE_NODES.filter((n) => n.depth >= 2);
    expect(deep.some((n) => ['gold', 'gem', 'diamond'].includes(n.ore))).toBe(true);
    expect(oreFor(0, 0.999)).not.toBe('diamond');
  });
  it('every floor cell is reachable from spawn (no sealed tunnels)', () => {
    const W = MINE_MAP.w / CELL, D = MINE_MAP.d / CELL;
    const open = (x: number, y: number) => canStand(x * CELL + 1, y * CELL + 1, 0, MINE_MAP);
    const seen = new Set<string>(); const q = [[Math.floor(MINE_MAP.spawns[0][0] / CELL), Math.floor(MINE_MAP.spawns[0][1] / CELL)]];
    while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || !open(x, y)) continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
    let total = 0; for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (open(x, y)) total++;
    expect(seen.size).toBe(total);
  });
});

describe('mining', () => {
  it('takes ORES.hits hits, drops into backpack, node respawns after its timer', () => {
    w.join('a', 'QA-Miner', 0); stand('a', 0);
    const ore = MINE_NODES[0].ore;
    const { r, t } = mineOut('a', 0, 1000);
    expect(r.broke).toBe(true);
    expect(w.carried('a')).toEqual([{ type: 'ore', id: ore, qty: 1 }]); expect(w.backpack('a')).toEqual([]);
    expect(() => w.hit('a', 0, t + 1000)).toThrow(/mined out/);
    expect(w.nodesView(t + ORES[ore].respawnMs)[0]).toBe(ORES[ore].hits);
  });
  it('rejects out-of-reach, too-fast and rate-limited hits', () => {
    w.join('a', 'QA-Miner', 0); stand('a', 0);
    w.hit('a', 0, 1000);
    expect(() => w.hit('a', 0, 1000 + SWING_MIN_MS - 1)).toThrow(/fast/);
    const m = w.miners.get('a')!; m.x = MINE_MAP.spawns[0][0]; m.y = MINE_MAP.spawns[0][1];
    const far = MINE_NODES.reduce((b, n, i) => (Math.hypot(n.x - m.x, n.y - m.y) > 20 ? i : b), 0);
    expect(() => w.hit('a', far, 5000)).toThrow(/far/);
    stand('a', 1); m.hits = Array.from({ length: 26 }, () => 9000);
    expect(() => w.hit('a', 1, 9500)).toThrow(/fast/);
  });
  it('backpack cap stops mining', () => {
    w.join('a', 'QA-Miner', 0); stand('a', 0);
    w.miners.get('a')!.carried.set('ore:stone', { type: 'ore', id: 'stone', qty: BACKPACK_CAP });
    let t = 1000; let r; do { r = w.hit('a', 0, t); t += 500; } while (!r.full && !r.broke);
    expect(r.full).toBe(true);
  });
  it('movement uses the Arena speed cap', () => {
    const m = w.join('a', 'QA-Miner', 0);
    const x0 = m.x; w.move('a', x0 + 50, m.y, 0, 0, 0, false, false, 100);
    expect(m.x - x0).toBeLessThan(2);
  });
});

describe('selling', () => {
  it('pays fixed prices via the bank with a ledger entry, guests cannot sell', () => {
    w.join('a', 'QA-Seller', 0); w.join('g', null, 0);
    const before = getBank().account('QA-Seller').chips;
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'stone', qty: 25 }, { type: 'ore', id: 'iron', qty: 3 }, { type: 'ore', id: 'gold', qty: 1 }]);
    const r = sellAs('a', 1000);
    expect(r.paid).toBe(Math.floor(25 * 0.1 + 3 * 4 + 15)); // 29
    expect(getBank().account('QA-Seller').chips).toBe(before + 29);
    expect(w.backpack('a')).toEqual([]);
    w.add(w.miners.get('g')!, [{ type: 'ore', id: 'gold', qty: 2 }]);
    expect(() => sellAs('g', 1000)).toThrow(/Sign in/);
    expect(() => sellAs('a', 1000)).toThrow(/Nothing/);
  });
  it('diminishing returns per day', () => {
    expect(payoutFor(600, 0)).toBe(600);
    expect(payoutFor(100, 600)).toBe(50);
    expect(payoutFor(200, 500)).toBe(150);
    expect(payoutFor(1000, 1200)).toBe(200);
    w.join('a', 'QA-Rich', 0);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'diamond', qty: 4 }]);
    expect(sellAs('a', 1000).paid).toBe(600);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'diamond', qty: 4 }]);
    expect(sellAs('a', 2000).paid).toBe(300);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'diamond', qty: 1 }]);
    expect(sellAs('a', 2000 + 86_400_000).paid).toBe(150); // next day resets
  });
  it('persists stacks and daily totals to postgres', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    await w.attach(new PgMineStore(pool));
    w.join('a', 'QA-Saver', 0);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'coal', qty: 7 }, { type: 'ore', id: 'silver', qty: 100 }]);
    sellAs('a', 1000, 'silver');
    await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Saver', 0);
    expect(w2.backpack('b')).toEqual([{ type: 'ore', id: 'coal', qty: 7 }]);
    expect(w2.daily.get('qa-saver')?.gross).toBe(800);
  });
});

import { FACTORY_LEVELS, RECIPES, GOODS, inputValue, priceOf } from '../shared/mines';
describe('factory', () => {
  const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
  it('every recipe adds 1.5-3x value and furnace/bench timers are 10-60s per unit', () => {
    for (const r of RECIPES) {
      expect(r.ms).toBeGreaterThanOrEqual(10_000); expect(r.ms).toBeLessThanOrEqual(60_000);
      const ratio = (priceOf(r.out) * r.out.qty) / inputValue(r);
      expect(ratio).toBeGreaterThanOrEqual(1.5); expect(ratio).toBeLessThanOrEqual(3);
      expect(GOODS[r.out.id]).toBeTruthy();
    }
  });
  it('guests cannot build; build/upgrade charges chips once via the bank', () => {
    w.join('g', null, 0); expect(() => w.upgradeFactory(acct('g'), 0)).toThrow(/Sign in/);
    w.join('a', 'QA-Smith', 0); rich('QA-Smith', 0);
    expect(() => w.upgradeFactory(acct('a'), 0)).toThrow(/chips/);
    rich('QA-Smith', 5000);
    expect(w.upgradeFactory(acct('a'), 0).level).toBe(1);
    expect(getBank().account('QA-Smith').chips).toBe(5000 - FACTORY_LEVELS[0].cost);
    w.upgradeFactory(acct('a'), 0); w.upgradeFactory(acct('a'), 0);
    expect(() => w.upgradeFactory(acct('a'), 0)).toThrow(/maxed/);
    expect(getBank().account('QA-Smith').chips).toBe(5000 - 250 - 750 - 2000);
  });
  it('smelts on the server clock, enforces slots/batch, collects bars and sells under daily caps', () => {
    w.join('a', 'QA-Smith', 0); rich('QA-Smith', 300); w.upgradeFactory(acct('a'), 0);
    const m = w.miners.get('a')!;
    expect(() => w.startJob(acct('a'), 'iron_bar', 1, 0)).toThrow(/Need/);
    w.add(m, [{ type: 'ore', id: 'iron', qty: 30 }, { type: 'ore', id: 'coal', qty: 10 }]);
    expect(() => w.startJob(acct('a'), 'iron_bar', 6, 0)).toThrow(/Batch/);
    const j = w.startJob(acct('a'), 'iron_bar', 2, 1000);
    expect(j.doneAt).toBe(1000 + 40_000);
    expect(() => w.startJob(acct('a'), 'iron_bar', 1, 1000)).toThrow(/busy/);
    expect(w.backpack('a').find((s) => s.id === 'iron')?.qty).toBe(24);
    expect(() => w.collect(acct('a'), 40_999)).toThrow(/Nothing/);
    // player leaves; job keeps running
    w.leave('a'); w.join('b', 'QA-Smith', 50_000);
    expect(w.collect(acct('b'), 50_000)).toEqual([{ type: 'bar', id: 'iron_bar', qty: 2 }]);
    const r = sellAs('b', 50_000, 'bar:iron_bar'); expect(r.paid).toBe(56);
  });
  it('persists factory level and running jobs', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    await w.attach(new PgMineStore(pool));
    w.join('a', 'QA-Forge', 0); rich('QA-Forge', 300); w.upgradeFactory(acct('a'), 0);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'stone', qty: 10 }, { type: 'ore', id: 'coal', qty: 1 }]);
    w.startJob(acct('a'), 'brick', 1, 0); await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Forge', 0);
    expect(w2.factoryView(w2.miners.get('b')!.account, 20_000)).toMatchObject({ level: 1, jobs: [{ recipe: 'brick', done: true }] });
    expect(w2.backpack('b')).toEqual([]);
  });
});

import { CARRY_GRACE_MS, inExit } from '../shared/mines';
describe('extraction', () => {
  it('mined ore is carried, only banks at the EXIT lift', () => {
    w.join('a', 'QA-Haul', 0); stand('a', 0);
    const ore = MINE_NODES[0].ore; mineOut('a', 0, 1000);
    expect(w.storage('QA-Haul')).toEqual([]);
    expect(() => w.exit('a')).toThrow(/EXIT/);
    const m = w.miners.get('a')!; m.x = MINE_MAP.spawns[0][0]; m.y = MINE_MAP.spawns[0][1];
    expect(inExit(m.x, m.y)).toBe(true);
    const r = w.exit('a');
    expect(r.banked).toEqual([{ type: 'ore', id: ore, qty: 1 }]);
    expect(w.carried('a')).toEqual([]);
    expect(w.storage('QA-Haul')).toEqual([{ type: 'ore', id: ore, qty: 1 }]);
  });
  it('selling is blocked while in the mine, works after leaving', () => {
    w.join('a', 'QA-Haul', 0);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'gold', qty: 2 }]);
    expect(() => w.sell('QA-Haul', 1000)).toThrow(/Leave the mine/);
    w.leave('a', 1000);
    expect(w.sell('QA-Haul', 1000).paid).toBe(30);
  });
  it('dropping without exiting keeps the haul for the grace window, then it is lost', () => {
    const carry = (id: string) => w.miners.get(id)!.carried.set('ore:diamond', { type: 'ore', id: 'diamond', qty: 3 });
    w.join('a', 'QA-Drop', 0); carry('a'); w.leave('a', 1000);
    w.join('b', 'QA-Drop', 1000 + CARRY_GRACE_MS - 1);
    expect(w.carried('b')).toEqual([{ type: 'ore', id: 'diamond', qty: 3 }]);
    w.leave('b', 5000);
    w.join('c', 'QA-Drop', 5000 + CARRY_GRACE_MS + 1);
    expect(w.carried('c')).toEqual([]);
    expect(w.storage('QA-Drop')).toEqual([]);
    w.join('g', null, 0); w.miners.get('g')!.carried.set('ore:gold', { type: 'ore', id: 'gold', qty: 1 }); w.leave('g', 0);
    expect(w.grace.size).toBe(0);
  });
  it('factory works from banked storage without being in the mine', () => {
    getBank().transfer('QA-Out', 0, { game: 'test' });
    w.join('a', 'QA-Out', 0); w.add(w.miners.get('a')!, [{ type: 'ore', id: 'copper', qty: 3 }, { type: 'ore', id: 'coal', qty: 1 }]); w.leave('a', 0);
    w.upgradeFactory('QA-Out', 0);
    w.startJob('QA-Out', 'copper_bar', 1, 0);
    expect(w.storage('QA-Out')).toEqual([]);
    expect(w.collect('QA-Out', 15_000)).toEqual([{ type: 'bar', id: 'copper_bar', qty: 1 }]);
    expect(w.storage('QA-Out')).toEqual([{ type: 'bar', id: 'copper_bar', qty: 1 }]);
  });
});
