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
    expect(w.backpack('a')).toEqual([{ type: 'ore', id: ore, qty: 1 }]);
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
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'stone', qty: BACKPACK_CAP }]);
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
    const r = w.sell('a', 1000);
    expect(r.paid).toBe(Math.floor(25 * 0.1 + 3 * 4 + 15)); // 29
    expect(getBank().account('QA-Seller').chips).toBe(before + 29);
    expect(w.backpack('a')).toEqual([]);
    w.add(w.miners.get('g')!, [{ type: 'ore', id: 'gold', qty: 2 }]);
    expect(() => w.sell('g', 1000)).toThrow(/Sign in/);
    expect(() => w.sell('a', 1000)).toThrow(/Nothing/);
  });
  it('diminishing returns per day', () => {
    expect(payoutFor(600, 0)).toBe(600);
    expect(payoutFor(100, 600)).toBe(50);
    expect(payoutFor(200, 500)).toBe(150);
    expect(payoutFor(1000, 1200)).toBe(200);
    w.join('a', 'QA-Rich', 0);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'diamond', qty: 4 }]);
    expect(w.sell('a', 1000).paid).toBe(600);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'diamond', qty: 4 }]);
    expect(w.sell('a', 2000).paid).toBe(300);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'diamond', qty: 1 }]);
    expect(w.sell('a', 2000 + 86_400_000).paid).toBe(150); // next day resets
  });
  it('persists stacks and daily totals to postgres', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    await w.attach(new PgMineStore(pool));
    w.join('a', 'QA-Saver', 0);
    w.add(w.miners.get('a')!, [{ type: 'ore', id: 'coal', qty: 7 }, { type: 'ore', id: 'silver', qty: 100 }]);
    w.sell('a', 1000, 'silver');
    await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Saver', 0);
    expect(w2.backpack('b')).toEqual([{ type: 'ore', id: 'coal', qty: 7 }]);
    expect(w2.daily.get('qa-saver')?.gross).toBe(800);
  });
});
