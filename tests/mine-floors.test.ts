import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { MineGear } from '../server/mineGear';
import { MinesWorld } from '../server/mines';
import { CAVES, ORES, MINE_EXIT, inExit } from '../shared/mines';
import { canStand } from '../shared/fps';
import { LADDER, MAX_FLOOR, canRideTo, elevatorStops, floorRows, inLadder, levelOf, respawnFloor } from '../shared/mineFloors';
import { ARMORS, MOBS, WEAPONS, canBuyGear, hitThrough, lostOnDeath, mobCount, mobHp, maxHpOf } from '../shared/mineCombat';
import { SINK_DEBIT_GAMES } from '../shared/sinkRoom';

const avgValue = (f: number) => { const n = levelOf('mine', f).nodes; return n.reduce((t, x) => t + ORES[x.ore].price, 0) / n.length; };

describe('mine floors (#13)', () => {
  it('floor 1 is the classic mine, unchanged', () => {
    expect(levelOf('mine', 1).nodes).toEqual(CAVES.mine.nodes);
    expect(levelOf('mine', 1).map).toBe(CAVES.mine.map);
  });
  it('every floor: the lift spawn connects to the ladder by walkable cells', () => {
    for (let f = 2; f <= MAX_FLOOR; f++) {
      const rows = floorRows(f); const H = rows.length, W = rows[0].length;
      const seen = new Set<string>(); const q: Array<[number, number]> = [[1, 1]];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] !== '#' && rows[y][x] !== '~' && x < 4 && !q.length) q.push([x, y]);
      const start = levelOf('mine', f).map.spawns[0]; q.length = 0; q.push([Math.floor(start[0] / 2), Math.floor(start[1] / 2)]);
      while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '#' || rows[y][x] === '~') continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
      expect(seen.has(`${Math.floor(LADDER.cx / 2)},${Math.floor(LADDER.cy / 2)}`), `floor ${f}`).toBe(true);
      expect(canStand(LADDER.cx, LADDER.cy, 0, levelOf('mine', f).map), `floor ${f} ladder`).toBe(true);
    }
  });
  it('deeper floors are richer on average', () => {
    const band = (a: number, b: number) => { let t = 0; for (let f = a; f <= b; f++) t += avgValue(f); return t / (b - a + 1); };
    expect(band(2, 9)).toBeGreaterThan(avgValue(1));
    expect(band(10, 19)).toBeGreaterThan(band(2, 9));
    expect(band(20, 29)).toBeGreaterThan(band(10, 19));
    expect(band(30, 40)).toBeGreaterThan(band(20, 29));
  });
  it('elevator stops every 5 floors you have reached; death respawns at the stop above', () => {
    expect(elevatorStops(1)).toEqual([1]); expect(elevatorStops(4)).toEqual([1]); expect(elevatorStops(12)).toEqual([1, 5, 10]);
    expect(canRideTo(10, 12)).toBe(true); expect(canRideTo(15, 12)).toBe(false); expect(canRideTo(7, 12)).toBe(false);
    expect(respawnFloor(3)).toBe(1); expect(respawnFloor(14)).toBe(10); expect(respawnFloor(20)).toBe(20);
  });
});

describe('mine combat (#13)', () => {
  it('creatures start at floor 3 and scale with depth', () => {
    expect(mobCount(2)).toBe(0); expect(mobCount(3)).toBeGreaterThan(0);
    expect(mobHp('slime', 20)).toBeGreaterThan(mobHp('slime', 3));
    expect(MOBS.wraith.minFloor).toBeGreaterThan(MOBS.slime.minFloor);
  });
  it('gear tiers, armor and death loss', () => {
    expect(canBuyGear('weapon', 'copper_sword', ['rusty_sword'])).toBe(true);
    expect(canBuyGear('weapon', 'iron_sword', ['rusty_sword'])).toBe(false);
    expect(hitThrough(20, 'crystal_plate')).toBe(15); expect(hitThrough(1, 'crystal_plate')).toBe(1);
    expect(maxHpOf('chainmail')).toBe(200);
    expect(lostOnDeath(1)).toBe(1); expect(lostOnDeath(5)).toBe(3);
    for (let i = 1; i < WEAPONS.length; i++) expect(WEAPONS[i].price).toBeGreaterThan(WEAPONS[i - 1].price);
    for (let i = 1; i < ARMORS.length; i++) expect(ARMORS[i].hp).toBeGreaterThan(ARMORS[i - 1].hp);
  });
  it('ladder, elevator, attack validation, creature hits and death', () => {
    const w = new MinesWorld(); w.gearOf = () => ({ weapon: 'diamond_saber', armor: 'none' });
    const m = w.join('s1', null, 1000, 'mine');
    expect(() => w.descend('s1', 5000)).toThrow(/ladder/);
    Object.assign(m, { x: LADDER.cx, y: LADDER.cy }); expect(inLadder(m.x, m.y)).toBe(true);
    let t = 5000;
    for (let f = 2; f <= 5; f++) { Object.assign(m, { x: LADDER.cx, y: LADDER.cy }); t += 1000; expect(w.descend('s1', t)).toBe(f); }
    expect(inExit(m.x, m.y)).toBe(true);
    t += 1000; expect(w.ride('s1', 1, t)).toBe(1); t += 1000; expect(w.ride('s1', 5, t)).toBe(5);
    expect(() => w.ride('s1', 10, t + 1000)).toThrow(/Reach/);
    // a creature on floor 5
    const mob = w.mobsOn(5)[0]; expect(mob).toBeTruthy();
    expect(() => w.attack('s1', mob.id, t + 2000)).toThrow(/far|way/);
    Object.assign(m, { x: mob.x - 1.2, y: mob.y, z: 0 });
    const r = w.attack('s1', mob.id, t + 3000); expect(r.killed).toBe(true); expect(r.dmg).toBe(90);
    expect(() => w.attack('s1', mob.id, t + 4000)).toThrow(/Nothing/);
    // carried ore, then a fatal hit
    m.carried.set('ore:gold', { type: 'ore', id: 'gold', qty: 5 });
    const live = w.mobsOn(5).find((b) => !b.deadUntil)!; Object.assign(m, { x: live.x + 0.5, y: live.y, hp: 1, lastHurt: t });
    let died = false; for (let k = 1; k < 30 && !died; k++) died = w.tickMobs(t + 5000 + k * 200).died.some((d) => d.id === 's1');
    expect(died).toBe(true); expect(m.floor).toBe(5); expect(m.carried.get('ore:gold')?.qty).toBe(2); expect(m.hp).toBe(w.maxHp(m));
    expect(m.x).toBeLessThan(MINE_EXIT.x1 + 0.01);
  });
});

describe('weapon store (#13)', () => {
  it('buys through the wallet ledger as mine_weapon (not a sink), in tier order, once', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const gear = new MineGear(pool, () => bank, () => 1_000); await gear.init();
    bank.transfer('Rex', 10_000, { game: 'admin' }); await bank.flush();
    await expect(gear.buy('Rex', 'iron_sword')).rejects.toThrow(/first/);
    const [a, b] = await Promise.allSettled([gear.buy('Rex', 'copper_sword'), gear.buy('Rex', 'copper_sword')]);
    expect([a, b].filter((x) => x.status === 'fulfilled').length).toBe(1);
    const led = db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = 'rex' AND game = 'mine_weapon'`) as Array<{ amount: number }>;
    expect(led.map((r) => Number(r.amount))).toEqual([-4000]);
    expect(gear.view('Rex').weapon).toBe('copper_sword');
    expect(SINK_DEBIT_GAMES.has('mine_weapon')).toBe(false);
    await expect(gear.buy('Rex', 'crystal_plate')).rejects.toThrow(/first/);
  });
});
