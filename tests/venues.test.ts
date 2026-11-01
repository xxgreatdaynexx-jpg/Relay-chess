// Airport + Speedway: geometry, lap timing, fly, Daily Cup (memory + Postgres via PGlite).
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { DriveRelay } from '../server/cars';
import { Speedway, dayOf } from '../server/race';
import { validDrive, CAR_BY_ID } from '../shared/cars';
import { LANDMARK_IDS, landmarks, PLATE, ROADS, MINE_SITES, MINE_APRON, RESERVED_VENUES } from '../shared/worldLayout';
import { outskirts } from '../shared/outskirts';
import { MAP_BOUNDS, FARM_X0, FARM_Z0 } from '../shared/farm';
import { AIRPORT_ROADS, RACETRACK_ROADS, AIRPORT, RACETRACK, AIRPORT_SLOT, RACETRACK_SLOT, TRACK_LEN, trackPoint, trackDist, LapTimer, drivable, onVenueRoad, FLY_DEST, nearAirport, VENUE_BOUNDS, RACE_ENTRY_BASE, RACE_SEED_BASE, fmtLap } from '../shared/venues';
import { propertyById } from '../shared/realEstate';

/** Drive the centreline from u0 for `laps` laps at `speed` u/s, sampling at 8 Hz. */
function drive(t: LapTimer | ((x: number, z: number, t: number) => unknown[]), laps: number, speed = 30, t0 = 0, u0 = 0.97) {
  const evs: unknown[] = []; const dt = 125; const du = speed * dt / 1000 / TRACK_LEN; let tt = t0;
  for (let u = u0; u < u0 + laps; u += du, tt += dt) { const [x, z] = trackPoint(u % 1); evs.push(...(t instanceof LapTimer ? t.feed(x, z, tt) : t(x, z, tt))); }
  return { evs: evs as Array<{ kind: string; ms?: number }>, t: tt };
}

describe('venue layout', () => {
  it('places the airport west and the speedway north-east, clear of the plate and the farm', () => {
    expect(LANDMARK_IDS).toEqual(expect.arrayContaining(['airport', 'racetrack']));
    const lm = landmarks(LANDMARK_IDS);
    expect([lm.airport.x, lm.airport.z]).toEqual(AIRPORT_SLOT); expect([lm.racetrack.x, lm.racetrack.z]).toEqual(RACETRACK_SLOT);
    expect(AIRPORT.x1).toBeLessThanOrEqual(-PLATE); expect(RACETRACK.z1).toBeLessThanOrEqual(-PLATE);
    expect(RACETRACK.x1 <= FARM_X0 || RACETRACK.z1 <= FARM_Z0).toBe(true); // never overlaps the farm district
    for (const r of ROADS) for (const [x, z] of r.pts) { expect(trackDist(x, z)).toBeGreaterThan(8); }
    const half = MINE_APRON / 2; const over = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, h: number) => r.x0 < x + h && r.x1 > x - h && r.z0 < z + h && r.z1 > z - h;
    for (const m of Object.values(MINE_SITES)) { expect(over(AIRPORT, m.x, m.z, half + 4)).toBe(false); expect(over(RACETRACK, m.x, m.z, half + 4)).toBe(false);
      for (const [a, b] of [...AIRPORT_ROADS, ...RACETRACK_ROADS]) for (let k = 0; k <= 20; k++) { const x = a[0] + (b[0] - a[0]) * k / 20, z = a[1] + (b[1] - a[1]) * k / 20; expect(Math.max(Math.abs(x - m.x), Math.abs(z - m.z))).toBeGreaterThan(half + 2); } }
    const inside = (r: typeof AIRPORT, R: typeof AIRPORT) => r.x0 >= R.x0 && r.x1 <= R.x1 && r.z0 >= R.z0 && r.z1 <= R.z1;
    expect(inside(AIRPORT, RESERVED_VENUES.airport)).toBe(true); expect(inside(RACETRACK, RESERVED_VENUES.racetrack)).toBe(true);
    const o = outskirts(); const segD = (x: number, z: number, a: number[], b: number[]) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
    for (const [a, b, w] of [...AIRPORT_ROADS, ...RACETRACK_ROADS]) {
      for (const t of [...o.trees, ...o.rocks, ...o.lamps]) expect(segD(t[0], t[1], a, b)).toBeGreaterThan(w / 2 + 0.3);
      for (const k of [...o.buildings, ...o.fields]) expect(segD(k.x, k.z, a, b)).toBeGreaterThan(w / 2 + Math.hypot(k.w, k.d) / 2);
    }
    expect(MAP_BOUNDS.x0).toBeLessThanOrEqual(VENUE_BOUNDS.x0); expect(MAP_BOUNDS.z0).toBeLessThanOrEqual(VENUE_BOUNDS.z0);
  });
  it('lets cars drive from the city onto both venues by road, and nowhere else outside the plate', () => {
    for (const [a, b] of [...AIRPORT_ROADS, ...RACETRACK_ROADS]) for (let k = 0; k <= 20; k++) { const x = a[0] + (b[0] - a[0]) * k / 20, z = a[1] + (b[1] - a[1]) * k / 20; expect(drivable(x, z, 1)).toBe(true); expect(onVenueRoad(x, z)).toBe(true); }
    for (let u = 0; u < 1; u += 0.01) { const [x, z] = trackPoint(u); expect(onVenueRoad(x, z)).toBe(true); expect(validDrive({ x, z, a: 0, v: 0 }, null, 0, 100)).toBe(true); }
    expect(drivable(-150, -30, 1)).toBe(false); expect(drivable(40, -150, 1)).toBe(false); // The Mine / Frostbite Caverns aprons
    expect(validDrive({ x: -250, z: 0, a: 0, v: 0 }, null, 0, 100)).toBe(false);
  });
  it('sells both as landmark deeds', () => {
    expect(propertyById('lm:airport')!.price).toBeGreaterThan(propertyById('lm:dealer')!.price);
    expect(propertyById('lm:racetrack')!.label).toMatch(/Speedway/);
  });
});

describe('LapTimer', () => {
  it('times a clean lap from start-line crossing to start-line crossing', () => {
    const { evs } = drive(new LapTimer(), 2.05, 30);
    const laps = evs.filter((e) => e.kind === 'lap'); expect(laps).toHaveLength(2);
    for (const l of laps) expect(Math.abs(l.ms! - TRACK_LEN / 30 * 1000)).toBeLessThan(150);
    expect(fmtLap(laps[0].ms!)).toMatch(/^0:\d\d\.\d\d$/);
  });
  it('voids a lap that cuts across the infield and ignores driving backwards', () => {
    const t = new LapTimer(); drive(t, 0.1, 30); // crossed the start line
    const [ax, az] = trackPoint(0.1), [bx, bz] = trackPoint(0.6); let tt = 5000; const evs: Array<{ kind: string }> = [];
    for (let k = 0; k <= 20; k++) evs.push(...t.feed(ax + (bx - ax) * k / 20, az + (bz - az) * k / 20, (tt += 125)));
    expect(evs.some((e) => e.kind === 'void')).toBe(true);
    const b = new LapTimer(); const evs2: Array<{ kind: string }> = []; let t2 = 0;
    for (let u = 1.03; u > -1.1; u -= 0.005) { const [x, z] = trackPoint(((u % 1) + 1) % 1); evs2.push(...b.feed(x, z, (t2 += 125))); }
    expect(evs2.some((e) => e.kind === 'lap')).toBe(false);
  });
});

describe('fly', () => {
  it('teleports a driver only from the airport, and the relay accepts the next pose there', () => {
    let now = 1000; const r = new DriveRelay(() => now); const car = { carId: 'taxi', color: 1 };
    expect(r.update('s1', 'QA-F', car, { x: 0, z: 0, a: 0, v: 0 })).toBe(true);
    expect(r.fly('QA-F', 's1', 'racetrack')).toBeNull(); // downtown: not at the airport
    const [ax, az] = FLY_DEST.airport ? [FLY_DEST.airport.x, FLY_DEST.airport.z] : [0, 0]; expect(nearAirport(ax, az)).toBe(true);
    now += 10_000; expect(r.update('s1', 'QA-F', car, { x: ax, z: az, a: 0, v: 0 })).toBe(true); // fresh after idle
    now += 125; expect(r.fly('QA-F', 's2', 'racetrack')).toBeNull(); // other socket
    expect(r.fly('QA-F', 's1', 'mars')).toBeNull();
    const d = FLY_DEST.racetrack; expect(r.fly('QA-F', 's1', 'racetrack')).toEqual({ x: d.x, z: d.z, a: d.a });
    now += 125; expect(r.update('s1', 'QA-F', car, { x: d.x + 1, z: d.z, a: 0, v: 5 })).toBe(true);
    for (const k of Object.keys(FLY_DEST) as Array<keyof typeof FLY_DEST>) expect(drivable(FLY_DEST[k].x, FLY_DEST[k].z, 2)).toBe(true);
  });
});

describe('Speedway (memory)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('records best laps, charges the Cup entry and pays 50/30/20 of fees + seed (QA gets nothing)', async () => {
    let now = Date.parse('2026-11-01T12:00:00Z'); const s = new Speedway(null, () => now); const b = getBank();
    for (const n of ['Ann', 'Bob', 'Cat', 'QA-Dan']) b.transferConfirmed(n, 5000, { key: `f:${n}`, game: 'admin' });
    const start = (n: string) => b.account(n).chips;
    const before = { Ann: start('Ann'), Bob: start('Bob'), Cat: start('Cat') };
    for (const n of ['Ann', 'Bob', 'Cat', 'QA-Dan']) await s.enter(n);
    await expect(s.enter('Ann')).rejects.toThrow(/already/);
    expect(start('Ann')).toBe(before.Ann - RACE_ENTRY_BASE);
    // QA-Dan fastest, then Ann, Bob, Cat
    for (const [n, sp] of [['QA-Dan', 45], ['Ann', 40], ['Bob', 35], ['Cat', 30]] as const) {
      const dt = 125; const du = sp * dt / 1000 / TRACK_LEN; let tt = now; for (let u = 0.97; u < 2.02; u += du, tt += dt) { const [x, z] = trackPoint(u % 1); await s.pose(n, CAR_BY_ID.has('hypervolt') ? 'hypervolt' : 'taxi', x, z, tt); }
    }
    const bd = await s.board('Ann'); expect(bd.today.map((r) => r.name)).toEqual(['QA-Dan', 'Ann', 'Bob', 'Cat']);
    expect(bd.cup.entered).toBe(true); expect(bd.cup.pool).toBe(4 * RACE_ENTRY_BASE + RACE_SEED_BASE);
    now += 86_400_000; expect(await s.settle()).toBe(2); expect(await s.settle()).toBe(0);
    const pool = 4 * RACE_ENTRY_BASE + RACE_SEED_BASE;
    expect(start('Ann')).toBe(before.Ann - RACE_ENTRY_BASE + Math.floor(pool * 0.3));
    expect(start('Bob')).toBe(before.Bob - RACE_ENTRY_BASE + Math.floor(pool * 0.2));
    expect(start('Cat')).toBe(before.Cat - RACE_ENTRY_BASE);
    expect((await s.board()).lastCup!.payouts.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(dayOf(now)).toBe('2026-11-02');
  });
  it('rejects entry without chips', async () => {
    const s = new Speedway(null); const b = getBank(); b.transfer('Broke', -b.account('Broke').chips, { game: 'admin' });
    await expect(s.enter('Broke')).rejects.toThrow(/chips/); expect(b.account('Broke').chips).toBe(0);
  });
});

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
describe('Speedway on Postgres', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('migrates, stores bests, entries and pays once', async () => {
    const db = new PGlite(); let now = Date.parse('2026-11-01T12:00:00Z'); const s = new Speedway(shim(db) as never, () => now); await s.init(); await s.init();
    const b = getBank(); for (const n of ['Eve', 'Fay']) b.transferConfirmed(n, 5000, { key: `f:${n}`, game: 'admin' });
    await s.enter('Eve'); await expect(s.enter('Eve')).rejects.toThrow(/already/);
    expect(await s.record('Eve', 'taxi', 30_000, now)).toBe(true); expect(await s.record('Eve', 'taxi', 31_000, now)).toBe(false); expect(await s.record('Eve', 'taxi', 29_000, now)).toBe(true);
    await s.record('Fay', 'taxi', 20_000, now); // not entered: on the board, not in the Cup
    const bd = await s.board('Eve'); expect(bd.today.map((r) => [r.name, r.ms])).toEqual([['Fay', 20000], ['Eve', 29000]]);
    expect(bd.allTime).toHaveLength(2); expect(bd.cup.standings).toEqual([{ name: 'Eve', car: 'taxi', ms: 29000 }]);
    const eve = b.account('Eve').chips; now += 86_400_000; expect(await s.settle()).toBe(1); expect(await s.settle()).toBe(0);
    expect(b.account('Eve').chips).toBe(eve + Math.floor((RACE_ENTRY_BASE + RACE_SEED_BASE) * 0.5));
  });
});
