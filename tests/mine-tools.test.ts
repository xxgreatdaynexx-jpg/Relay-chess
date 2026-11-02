import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { MineTools, setMineTools } from '../server/mineTools';
import { MinesWorld } from '../server/mines';
import { MINE_MAP, MINE_NODES, SWING_MIN_MS, SWING_MS } from '../shared/mines';
import { canStand } from '../shared/fps';
import { miningBonusChance, miningSwingMul } from '../shared/skillPerks';
import { canBuyTool, combinedBonus, extraOreRoll, combinedSwingMul, MAX_TOTAL_BONUS, MIN_SWING_MUL, MINE_TOOLS, toolDef } from '../shared/mineTools';
import { hasItemIcon } from '../shared/itemIcons';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const tools = new MineTools(pool, () => bank, () => 1_000); await tools.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = 'mine_tool' ORDER BY id`) as Array<{ amount: number }>;
  return { db, pool, bank, tools, fund, chips, ledger };
}

describe('mining tools: tiers (request #16)', () => {
  it('5 buyable tiers beyond the pickaxe, each faster and pricier, with icons', () => {
    expect(MINE_TOOLS.length).toBe(6); expect(MINE_TOOLS[0]).toMatchObject({ id: 'pickaxe', price: 0, swingMul: 1 });
    for (let i = 1; i < MINE_TOOLS.length; i++) {
      expect(MINE_TOOLS[i].tier).toBe(i);
      expect(MINE_TOOLS[i].swingMul).toBeLessThan(MINE_TOOLS[i - 1].swingMul);
      expect(MINE_TOOLS[i].price).toBeGreaterThan(MINE_TOOLS[i - 1].price);
    }
    for (const t of MINE_TOOLS) expect(hasItemIcon('tool', t.id), t.id).toBe(true);
  });
  it('tool × Mining perk never goes below 25% of base (4× speed); extra-ore bonus capped', () => {
    expect(combinedSwingMul(1, 'pickaxe')).toBe(1);
    expect(combinedSwingMul(1, 'hand_drill')).toBeCloseTo(1 / 1.4);
    expect(combinedSwingMul(miningSwingMul(99), 'plasma_cutter')).toBeGreaterThanOrEqual(MIN_SWING_MUL); expect(combinedSwingMul(1, 'plasma_cutter')).toBeCloseTo(0.5);
    for (const t of MINE_TOOLS) for (const l of [1, 30, 60, 99]) expect(combinedSwingMul(miningSwingMul(l), t.id)).toBeGreaterThanOrEqual(0.25);
    expect(combinedBonus(miningBonusChance(99), 'plasma_cutter')).toBeCloseTo(5 + miningBonusChance(99)); expect(combinedBonus(100, 'plasma_cutter')).toBe(MAX_TOTAL_BONUS);
    expect(extraOreRoll(3.5, 0.49)).toBe(4); expect(extraOreRoll(3.5, 0.5)).toBe(3); expect(extraOreRoll(0.5, 0.9)).toBe(0);
    expect(combinedBonus(0, 'power_drill')).toBeCloseTo(2); expect(combinedBonus(0, 'hand_drill')).toBe(1); expect(combinedBonus(0, 'steel_pick')).toBe(0.5);
  });
  it('tiers are bought in order', () => {
    expect(canBuyTool(['pickaxe'], 'steel_pick')).toBe(true);
    expect(canBuyTool(['pickaxe'], 'hand_drill')).toBe(false);
    expect(canBuyTool(['pickaxe', 'steel_pick'], 'hand_drill')).toBe(true);
    expect(canBuyTool(['pickaxe', 'steel_pick'], 'steel_pick')).toBe(false);
    expect(canBuyTool(['pickaxe'], 'pickaxe')).toBe(false);
  });
});

describe('mining tools: shop', () => {
  it('buy debits exactly once via the mine_tool ledger, auto-equips, persists, and refuses out-of-order/unaffordable', async () => {
    const s = await setup();
    await s.fund('Rex', 13_000);
    await expect(s.tools.buy('Rex', 'hand_drill')).rejects.toThrow(/Steel Pickaxe first|first/);
    await expect(s.tools.buy('Rex', 'nope')).rejects.toThrow(/Unknown/);
    const [a, b] = await Promise.allSettled([s.tools.buy('Rex', 'steel_pick'), s.tools.buy('Rex', 'steel_pick')]);
    expect([a, b].filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(s.ledger('rex')).toEqual([{ amount: -2500 }]);
    expect(s.chips('rex')).toBe(10_500);
    expect(s.tools.equippedOf('Rex')).toBe('steel_pick');
    await s.tools.buy('Rex', 'hand_drill');
    expect(s.chips('rex')).toBe(500); expect(s.ledger('rex')).toEqual([{ amount: -2500 }, { amount: -10_000 }]);
    await expect(s.tools.buy('Rex', 'power_drill')).rejects.toThrow(/Not enough chips/);
    expect(s.ledger('rex').length).toBe(2);
    const t2 = new MineTools(s.pool, () => s.bank); await t2.init();
    expect(t2.ownedOf('rex')).toEqual(['pickaxe', 'steel_pick', 'hand_drill']); expect(t2.equippedOf('REX')).toBe('hand_drill');
  });
  it('equip only works for owned tools; guests always hold the pickaxe', async () => {
    const s = await setup(); await s.fund('Ivy', 3000);
    await expect(s.tools.equip('Ivy', 'steel_pick')).rejects.toThrow(/don't own/);
    await s.tools.buy('Ivy', 'steel_pick'); await s.tools.equip('Ivy', 'pickaxe');
    expect(s.tools.equippedOf('Ivy')).toBe('pickaxe');
    expect(s.tools.view(null)).toMatchObject({ owned: ['pickaxe'], equipped: 'pickaxe' });
    expect(s.tools.equippedOf(null)).toBe('pickaxe');
  });
});

describe('mining tools: in the mine', () => {
  let w: MinesWorld;
  beforeEach(() => { w = new MinesWorld(); setMineTools(null); });
  function stand(id: string, i: number) {
    const n = MINE_NODES[i]; const m = w.miners.get(id)!;
    for (let r = 1.0; r < 2.6; r += 0.2) for (let k = 0; k < 16; k++) {
      const x = n.x + Math.cos((k / 16) * Math.PI * 2) * r, y = n.y + Math.sin((k / 16) * Math.PI * 2) * r;
      if (canStand(x, y, 0, MINE_MAP)) { m.x = x; m.y = y; m.z = 0; try { w.hit(id, i, -1e9); } catch (e) { if (/far|way/.test((e as Error).message)) continue; } m.lastHit = 0; m.hits = []; return; }
    }
  }
  it('the equipped tool shortens the server swing gate and the client swing time', () => {
    w.miningLevel = () => 1; w.bonusRng = () => 1; w.toolOf = () => 'jackhammer';
    w.join('a', 'Tool-Miner', 0); stand('a', 0);
    w.hit('a', 0, 10_000);
    const fast = Math.ceil(SWING_MIN_MS / 1.8);
    expect(() => w.hit('a', 0, 10_000 + fast - 5)).toThrow(/fast/);
    expect(() => w.hit('a', 0, 10_000 + fast + 1)).not.toThrow();
    expect(w.swingMsFor('Tool-Miner')).toBe(Math.round(SWING_MS / 1.8));
    w.miningLevel = () => 99; w.toolOf = () => 'plasma_cutter';
    expect(w.swingMsFor('Tool-Miner')).toBe(Math.round(SWING_MS * miningSwingMul(99) / 2));
    expect(w.playersView('mine')[0]).toMatchObject({ tl: 'plasma_cutter' });
  });
  it('the shop hook drives toolOf, and a tool adds its expected extra ore with one roll', async () => {
    const s = await setup(); await s.fund('Ore-Guy', 400_000);
    for (const t of MINE_TOOLS.slice(1, 4)) await s.tools.buy('Ore-Guy', t.id);
    setMineTools(s.tools);
    expect(w.toolOf('Ore-Guy')).toBe('power_drill');
    w.miningLevel = () => 1; let rolls = 0; w.bonusRng = () => { rolls++; return 0.01; };
    w.join('b', 'Ore-Guy', 0); stand('b', 0);
    let t = 50_000, r; do { r = w.hit('b', 0, t); t += SWING_MIN_MS; } while (!r.broke && !r.full);
    expect(rolls).toBe(1); expect(r).toMatchObject({ broke: true, bonus: 2 });
    expect([...w.miners.get('b')!.carried.values()].reduce((a, x) => a + x.qty, 0)).toBe(3);
    expect(toolDef('power_drill').bonus).toBeGreaterThan(0.01);
    setMineTools(null);
  });
});
