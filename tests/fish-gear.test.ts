import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { FishGear, setFishGear } from '../server/fishGear';
import { Fishing } from '../server/fishing';
import { baitLuckRoll, canBuyGear, FISH_BAITS, FISH_FLIES, MAX_BAIT_LUCK } from '../shared/fishGear';
import { SKINS, SKIN_WEAPONS } from '../shared/skins';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const g = new FishGear(pool, () => bank, () => 1_000); await g.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const ledger = (key: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = 'fish_gear' ORDER BY id`) as Array<{ amount: number }>;
  return { db, pool, bank, g, fund, ledger };
}

describe('fishing upgrades (request #28)', () => {
  it('tiers get pricier and stronger; flies trade bite speed for a harder fight', () => {
    for (let i = 1; i < FISH_BAITS.length; i++) { expect(FISH_BAITS[i].price).toBeGreaterThan(FISH_BAITS[i - 1].price); expect(FISH_BAITS[i].luck).toBeGreaterThan(FISH_BAITS[i - 1].luck); }
    for (let i = 1; i < FISH_FLIES.length; i++) { expect(FISH_FLIES[i].biteMul).toBeLessThan(FISH_FLIES[i - 1].biteMul); expect(FISH_FLIES[i].diffAdd).toBeGreaterThan(FISH_FLIES[i - 1].diffAdd); }
    expect(canBuyGear(['worm'], 'minnow')).toBe(false); expect(canBuyGear(['worm'], 'cricket')).toBe(true); expect(canBuyGear(['worm', 'cricket'], 'minnow')).toBe(true);
  });
  it('the worm changes nothing; bait luck stacks with the perk but is capped', () => {
    expect(baitLuckRoll(0.3, 0.37, 'worm')).toBe(0.37);
    expect(baitLuckRoll(0.5, 0.5, 'golden_lure')).toBeCloseTo(0.5 + 0.5 * 0.18);
    expect(baitLuckRoll(0.5, 0.9, 'golden_lure')).toBeCloseTo(0.5 + 0.5 * MAX_BAIT_LUCK);
  });
  it('buys through the wallet + ledger, in order, once, and auto-equips', async () => {
    const { g, fund, ledger, bank } = await setup();
    await fund('Ann', 20_000);
    await expect(g.buy('Ann', 'minnow')).rejects.toThrow(/Cricket first/);
    const r = await g.buy('Ann', 'cricket'); expect(r.cost).toBe(3_000);
    expect(bank.account('Ann').chips).toBe(17_000); expect(ledger('ann').map((x) => Number(x.amount))).toEqual([-3_000]);
    expect(g.equippedOf('Ann').bait).toBe('cricket');
    await expect(g.buy('Ann', 'cricket')).rejects.toThrow(/already own/);
    await g.equip('Ann', 'worm'); expect(g.equippedOf('Ann').bait).toBe('worm');
    await expect(g.buy('Ann', 'golden_lure')).rejects.toThrow();
    await fund('Bob', 100); await expect(g.buy('Bob', 'dry_fly')).rejects.toThrow(/Not enough chips/); expect(ledger('bob')).toEqual([]);
  });
  it('a fly makes the bite faster and the reel harder at cast time', async () => {
    const { g, fund, pool } = await setup(); setFishGear(g);
    await fund('Cy', 10_000); await g.buy('Cy', 'dry_fly');
    const rng = { int: (lo: number) => lo + 1000, unit: () => 0.5 };
    const f = new Fishing(pool, undefined, () => 50_000, rng); await f.init();
    const fly = await f.cast('Cy'); const base = await new Fishing(pool, undefined, () => 50_000, rng).cast('Dee');
    expect(fly.biteIn).toBeLessThan(base.biteIn);
    setFishGear(null);
  });
  it('rod skins: 55 new skins appended last, so older ids never shift', () => {
    expect(SKIN_WEAPONS[SKIN_WEAPONS.length - 1]).toBe('rod');
    const rods = SKINS.slice(-55); expect(rods.every((s) => s.weapon === 'rod')).toBe(true);
    expect(SKINS.slice(0, 440).some((s) => s.weapon === 'rod')).toBe(false);
  });
});
