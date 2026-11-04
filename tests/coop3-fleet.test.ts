import { afterEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing, setFishBoatHook, type FishRng } from '../server/fishing';
import { FishFleet, resetFishFleet } from '../server/fishFleet';
import { setPriceIndexForTest } from '../server/price-index';
import { setJail, Jail } from '../server/jail';
import { fishById, fishPool, Reel, rollFish } from '../shared/fishing';
import { bestBoat } from '../shared/fleet';
import { captainShare, crewSeats, FLEET_REQUEST_TTL_MS, FLEET_TRIP_MS } from '../shared/coop3';
import { ICON_FISH_IDS } from '../shared/itemIcons';

const DAY = 86_400_000; const OLD = async () => ({ ageMs: 30 * DAY, playMs: 3 * DAY, exists: true });
function play(seed: number, diff: number): string { const r = new Reel(seed, diff); let s = ''; while (!r.s.done) { const h = r.s.x < r.s.c - 0.35 * r.s.v; s += h ? '1' : '0'; r.tick(h); } return s; }
let now = Date.parse('2026-11-01T12:00:00Z');
function fleet(boats: Record<string, string[]> = { Cap: ['yacht'] }) {
  const f = resetFishFleet(new FishFleet(() => now)); f.guard.accountInfo = OLD; f.guard.allowQa = false; f.guard.linked = () => false;
  f.boatsOf = async (n) => boats[n] ?? []; f.atResort = () => true; return f;
}
afterEach(() => { resetFishFleet(); setJail(new Jail(null)); setFishBoatHook(async () => bestBoat([])); });

describe('fishing fleets', () => {
  it('seats by boat tier; crew-only species never bite solo', () => {
    expect([crewSeats('skiff'), crewSeats('sportfisher'), crewSeats('yacht'), crewSeats('superyacht')]).toEqual([0, 1, 3, 6]);
    const crew = fishPool('deep').filter((x) => x.crew); expect(crew.map((x) => x.id)).toEqual(['bigeye', 'opah', 'bluemarlin']);
    for (const c of crew) expect(ICON_FISH_IDS).toContain(c.id);
    const seen = new Set<string>(); const seenCrew = new Set<string>();
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 20; j++) { const u = i / 60.0001, v = j / 20.0001; seen.add(rollFish(u, v, 'deep', 3).id); seenCrew.add(rollFish(u, v, 'deep', 3, true).id); expect(rollFish(u, v, 'deep', 3, true).rarity).toBe(rollFish(u, v, 'deep', 3).rarity); }
    for (const c of crew) { expect(seen.has(c.id)).toBe(false); expect(seenCrew.has(c.id)).toBe(true); }
  });

  it('open/request/accept/leave; seats, cut bounds, linked, one trip each, expiry', async () => {
    const f = fleet({ Cap: ['skiff', 'sportfisher'], Big: ['superyacht'], Solo: ['skiff'] });
    await expect(f.open('Solo', 0.1)).rejects.toThrow(/sportfisher, yacht or superyacht/);
    await expect(f.open('Cap', 0.31)).rejects.toThrow(/0–30%/);
    f.atResort = (n) => n !== 'Cap'; await expect(f.open('Cap', 0.1)).rejects.toThrow(/Resort Marina/); f.atResort = () => true;
    const t = await f.open('Cap', 0.2); expect(t.seats).toBe(1); expect(t.boat).toBe('sportfisher');
    await expect(f.open('Cap', 0.1)).rejects.toThrow(/already on/);
    f.guard.linked = (a, b) => [a, b].sort().join() === 'Alt,Cap'; await expect(f.request('Alt', t.id)).rejects.toThrow(/linked/i); f.guard.linked = () => false;
    await f.request('Ann', t.id); await expect(f.request('Ann', t.id)).rejects.toThrow(/already/);
    expect(() => f.setCut('Cap', 0.3)).toThrow(/can’t change/);
    f.respond('Cap', 'Ann', true); expect(f.mine('Ann')?.mine).toBe('crew');
    await expect(f.request('Bob', t.id)).rejects.toThrow(/full/);
    expect(f.crewInfo('Ann')).toMatchObject({ captain: 'Cap', cut: 0.2, zone: 2, crewed: true }); expect(f.crewInfo('Cap')).toMatchObject({ captain: null, crewed: true });
    f.leave('Ann'); expect(f.crewInfo('Ann')).toBeNull(); expect(f.crewInfo('Cap')).toBeNull(); // no crew → solo boat
    // request TTL, jail, and trip end
    const big = await f.open('Big', 0); await f.request('Bob', big.id); now += FLEET_REQUEST_TTL_MS + 1; f.tick(); expect(f.mine('Bob')).toBeNull();
    await f.request('Bob', big.id); f.respond('Big', 'Bob', true); const j = new Jail(null); setJail(j); (j as unknown as { jailedUntil: (n: string) => number }).jailedUntil = (n) => (n === 'Bob' ? now + DAY : 0);
    f.guard.excluded = (n) => (n === 'Bob' ? 'jailed' : null); f.tick(); expect(f.mine('Bob')).toBeNull(); f.guard.excluded = () => null;
    now += FLEET_TRIP_MS; f.tick(); expect(f.list(null)).toHaveLength(0); expect(f.crewInfo('Cap')).toBeNull();
  });

  it('crew fish from the captain’s boat, land crew-only species, and the captain’s cut is paid atomically on sell', async () => {
    setPriceIndexForTest(1);
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    // u ≈ 0.999 → legendary; in a crewed boat the legendary pool includes blue marlin
    let k = 0; const us = [0.9995, 0.999]; const rng: FishRng = { unit: () => us[k++ % us.length]!, int: (lo) => (lo === 1 ? 42 : 2000) };
    const fi = new Fishing(pool, () => bank, () => now, rng); await fi.init();
    setFishBoatHook(async () => bestBoat([])); // Ann owns no boat
    const f = fleet(); await expect(fi.cast('Ann', 'deep', () => true)).rejects.toThrow(/need a boat/);
    const t = await f.open('Cap', 0.25); await f.request('Ann', t.id); f.respond('Cap', 'Ann', true);
    const { biteIn } = await fi.cast('Ann', 'deep', () => true); const c = (fi as unknown as { casts: Map<string, { fish: string }> }).casts.get('ann')!;
    expect(fishById(c.fish)!.zone).toBeLessThanOrEqual(3); expect(fishById(c.fish)!.crew).toBe(true);
    now += biteIn + 100; const h = fi.hook('Ann'); const inp = play(h.seed, h.diff); now += inp.length * 50; const r = await fi.land('Ann', inp);
    expect(r.caught).toBe(true);
    const capBefore = bank.account('Cap').chips;
    const sold = await fi.sell('Ann');
    expect(sold.captainCut).toBeGreaterThan(0);     expect(sold.captainCut).toBeLessThanOrEqual(captainShare(sold.paid + sold.captainCut!, 0.25) + 1);
    expect(bank.account('Cap').chips - capBefore).toBe(sold.captainCut);
    expect(Number(db.public.one(`SELECT count(*) AS n FROM wallet_transactions WHERE game = 'fish_fleet'`).n)).toBe(1);
  });

  it('a captain selling their own crewed catch pays no cut; ocean cap still bounds the sale', async () => {
    setPriceIndexForTest(1);
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const fi = new Fishing(pool, () => bank, () => now); await fi.init();
    await pool.query("INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, crew_trip, captain, cut) VALUES ('a','ann','Ann','bluemarlin',300000,9000000,$1,'t','Cap',0.3),('b','cap','Cap','bluemarlin',300000,9000000,$1,'t',NULL,NULL)", [now]);
    const a = await fi.sell('Ann'); const b = await fi.sell('Cap');
    expect(b.captainCut).toBeUndefined(); expect(a.captainCut).toBeGreaterThan(0);
    expect(a.paid + a.captainCut!).toBe(b.paid); // same capped deep payout, split
    expect(Math.abs(a.captainCut! - (a.paid + a.captainCut!) * 0.3)).toBeLessThan(1);
  });
});
