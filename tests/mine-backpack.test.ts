import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { MineBackpack, setMineBackpack } from '../server/mineBackpack';
import { MinesWorld } from '../server/mines';
import { BACKPACK_CAP, MINE_MAP, MINE_NODES, SWING_MIN_MS } from '../shared/mines';
import { canStand } from '../shared/fps';
import {
  BACKPACK_BASE_CAP, BACKPACK_UPGRADES, MAX_BACKPACK_CAP, MAX_BACKPACK_TIER,
  canBuyBackpack, capForTier, nextUpgrade,
} from '../shared/mineBackpack';
import { setPriceIndexForTest } from '../server/price-index';
import { expectChangelogEntry } from './helpers/changelog';
import { buildWiki } from '../shared/wiki';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const packs = new MineBackpack(pool, () => bank, () => 1_000); await packs.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = 'mine_backpack' ORDER BY id`) as Array<{ amount: number }>;
  return { db, pool, bank, packs, fund, chips, ledger };
}

describe('mining pack upgrades: tiers (requested by Jay)', () => {
  it('four buyable tiers above the 120 starter cap, each larger and pricier', () => {
    expect(BACKPACK_BASE_CAP).toBe(120);
    expect(BACKPACK_CAP).toBe(120);
    expect(BACKPACK_UPGRADES.map((u) => u.cap)).toEqual([160, 200, 250, 300]);
    expect(BACKPACK_UPGRADES.map((u) => u.price)).toEqual([5_000, 15_000, 45_000, 110_000]);
    expect(MAX_BACKPACK_CAP).toBe(300);
    expect(MAX_BACKPACK_TIER).toBe(4);
    for (let i = 1; i < BACKPACK_UPGRADES.length; i++) {
      expect(BACKPACK_UPGRADES[i]!.tier).toBe(i + 1);
      expect(BACKPACK_UPGRADES[i]!.cap).toBeGreaterThan(BACKPACK_UPGRADES[i - 1]!.cap);
      expect(BACKPACK_UPGRADES[i]!.price).toBeGreaterThan(BACKPACK_UPGRADES[i - 1]!.price);
    }
    expect(capForTier(0)).toBe(120);
    expect(capForTier(1)).toBe(160);
    expect(capForTier(4)).toBe(300);
    expect(nextUpgrade(0)?.id).toBe('pack_160');
    expect(nextUpgrade(4)).toBeNull();
    expect(canBuyBackpack(0, 'pack_160')).toBe(true);
    expect(canBuyBackpack(0, 'pack_200')).toBe(false);
    expect(canBuyBackpack(1, 'pack_200')).toBe(true);
    expect(canBuyBackpack(1, 'pack_160')).toBe(false);
  });
  it('is in the wiki and the player-facing changelog, crediting Jay', () => {
    const ores = buildWiki().find((s) => s.id === 'ores')!;
    expect(ores.bullets!.some((b) => /pack upgrades/i.test(b) && /160 for 5,000/.test(b) && /300 for 110,000/.test(b))).toBe(true);
    const { entry } = expectChangelogEntry(/bigger mining pack/i, { from: '2026-11-11T00:00:00-06:00', to: '2026-11-12T12:00:00-06:00' });
    expect(entry.title).toMatch(/requested by Jay/i);
    expect(entry.bullets.some((b) => /Jay/.test(b))).toBe(true);
  });
});

describe('mining pack upgrades: shop', () => {
  it('buy debits exactly once via the mine_backpack ledger, persists, and refuses out-of-order/unaffordable/maxed', async () => {
    const s = await setup();
    await s.fund('Jay', 20_500);
    await expect(s.packs.buy('Jay', 'pack_200')).rejects.toThrow(/Roomy Pack first|first/);
    await expect(s.packs.buy('Jay', 'nope')).rejects.toThrow(/Roomy Pack first|first|Unknown/);
    const [a, b] = await Promise.allSettled([s.packs.buy('Jay', 'pack_160'), s.packs.buy('Jay', 'pack_160')]);
    expect([a, b].filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(s.ledger('jay')).toEqual([{ amount: -5_000 }]);
    expect(s.chips('jay')).toBe(15_500);
    expect(s.packs.capOf('Jay')).toBe(160);
    await s.packs.buy('Jay', 'pack_200');
    expect(s.chips('jay')).toBe(500); expect(s.ledger('jay')).toEqual([{ amount: -5_000 }, { amount: -15_000 }]);
    await expect(s.packs.buy('Jay', 'pack_250')).rejects.toThrow(/Not enough chips/);
    expect(s.ledger('jay').length).toBe(2);
    const t2 = new MineBackpack(s.pool, () => s.bank); await t2.init();
    expect(t2.capOf('jay')).toBe(200); expect(t2.tierOf('JAY')).toBe(2);
    expect(t2.view('Jay').next).toMatchObject({ id: 'pack_250', cap: 250 });
  });
  it('applies the price index, never charges on a failed or repeated buy, and guests stay at 120', async () => {
    setPriceIndexForTest(2);
    try {
      const s = await setup();
      await s.fund('Ivy', 4_000);
      await expect(s.packs.buy('Ivy', 'pack_160')).rejects.toThrow(/Not enough chips: the Roomy Pack costs 10,000/);
      expect(s.ledger('ivy')).toEqual([]);
      expect(s.chips('ivy')).toBe(4_000);
      await s.fund('Ivy', 10_000);
      await s.packs.buy('Ivy');
      expect(s.chips('ivy')).toBe(0);
      expect(s.ledger('ivy')).toEqual([{ amount: -10_000 }]);
      await expect(s.packs.buy('Ivy', 'pack_160')).rejects.toThrow(/already have/);
      expect(s.ledger('ivy').length).toBe(1);
      expect(s.packs.view(null)).toMatchObject({ cap: 120, tier: 0, signedIn: false, next: { id: 'pack_160' } });
      expect(s.packs.capOf(null)).toBe(120);
    } finally {
      setPriceIndexForTest(1);
    }
  });
  it('buying every tier reaches 300 and then refuses further purchases', async () => {
    const s = await setup();
    await s.fund('Max', 5_000 + 15_000 + 45_000 + 110_000);
    for (const u of BACKPACK_UPGRADES) await s.packs.buy('Max', u.id);
    expect(s.packs.capOf('Max')).toBe(300);
    expect(s.chips('max')).toBe(0);
    expect(s.ledger('max').map((r) => r.amount)).toEqual([-5_000, -15_000, -45_000, -110_000]);
    await expect(s.packs.buy('Max')).rejects.toThrow(/already at the maximum 300/);
    expect(s.ledger('max').length).toBe(4);
  });
});

describe('mining pack upgrades: in the mine', () => {
  let w: MinesWorld;
  beforeEach(() => { w = new MinesWorld(); setMineBackpack(null); });
  function stand(id: string, i: number) {
    const n = MINE_NODES[i]; const m = w.miners.get(id)!;
    for (let r = 1.0; r < 2.6; r += 0.2) for (let k = 0; k < 16; k++) {
      const x = n.x + Math.cos((k / 16) * Math.PI * 2) * r, y = n.y + Math.sin((k / 16) * Math.PI * 2) * r;
      if (canStand(x, y, 0, MINE_MAP)) { m.x = x; m.y = y; m.z = 0; try { w.hit(id, i, -1e9); } catch (e) { if (/far|way/.test((e as Error).message)) continue; } m.lastHit = 0; m.hits = []; return; }
    }
  }
  it('the shop hook raises the carry cap so a full 120 pack can keep mining', async () => {
    const s = await setup(); await s.fund('Hauler', 5_000);
    await s.packs.buy('Hauler', 'pack_160');
    setMineBackpack(s.packs);
    w.join('a', 'Hauler', 0); stand('a', 0);
    expect(w.capFor('a')).toBe(160);
    w.miners.get('a')!.carried.set('ore:stone', { type: 'ore', id: 'stone', qty: BACKPACK_CAP });
    let t = 20_000, r; do { r = w.hit('a', 0, t); t += SWING_MIN_MS + 20; } while (!r.full && !r.broke);
    expect(r.full).toBeFalsy();
    expect(r.broke).toBe(true);
    expect(w.load('a')).toBeGreaterThan(BACKPACK_CAP);
    setMineBackpack(null);
    w.join('g', null, 0);
    expect(w.capFor('g')).toBe(120);
  });
  it('existing carried ore is kept when the cap is upgraded', async () => {
    const s = await setup(); await s.fund('Keep', 5_000);
    setMineBackpack(s.packs);
    w.join('a', 'Keep', 0);
    w.miners.get('a')!.carried.set('ore:iron', { type: 'ore', id: 'iron', qty: 80 });
    expect(w.load('a')).toBe(80);
    await s.packs.buy('Keep', 'pack_160');
    expect(w.capFor('a')).toBe(160);
    expect(w.carried('a')).toEqual([{ type: 'ore', id: 'iron', qty: 80 }]);
    setMineBackpack(null);
  });
});
