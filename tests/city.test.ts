import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Mayor } from '../server/mayor';
import { City, setCityForTest, citySalesTaxRate, cityWealthTaxRate, cityFreightMul, cityPolicyMul, cityPerk, cityTicketPrice, cityTradeFeeMul, treasuryStmtsFor, salesTaxFor, treasuryCreditStmts } from '../server/city';
import { getJail } from '../server/jail';
import { LEVERS, LEVER_IDS, clampLever, POLICIES, BUILDINGS, BUILDING_IDS, SECTORS, TREASURY_CAP, recallPasses, recallNeeded, perkOf, isExcludedName, RECALL_FEE } from '../shared/city';
import { purchaseTaxOf } from '../shared/purchaseTax';
import { DAY_MS, WEEK_MS } from '../shared/mayor';

const MON = Date.parse('2026-11-02T06:00:00Z'); const H = 3_600_000;
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  let now = MON + 10 * H; const clock = () => now;
  const m = new Mayor(pool, () => bank, clock); await m.init();
  const c = new City(pool as never, () => m, clock, () => bank, () => 1); await c.init();
  const player = async (name: string, chips = 50_000) => {
    await pool.query('INSERT INTO players VALUES ($1,$2,$3)', [name.toLowerCase(), name, new Date(now - 3 * DAY_MS).toISOString()]);
    bank.transfer(name, chips, { game: 'admin' }); for (let i = 0; i < 6; i++) bank.transfer(name, 1, { game: 'slots' }); await bank.flush();
  };
  const fund = (n: number) => pool.query("UPDATE city_treasury SET balance = $1 WHERE id = 'main'", [n]);
  const sumGame = async (game: string) => Number((await pool.query('SELECT COALESCE(SUM(amount),0) AS s FROM wallet_transactions WHERE game = $1', [game])).rows[0].s);
  return { pool, bank, m, c, player, fund, sumGame, set: (t: number) => { now = t; }, get now() { return now; } };
}
/** Ann is mayor for the week of MON + 7 days (Bob voted). */
async function withMayor(extra: string[] = []) {
  const s = await setup(); for (const n of ['Ann', 'Bob', 'Cat', ...extra]) await s.player(n);
  await s.m.file('Ann', 'Build it'); await s.m.file('Cat', 'Runner up');
  s.set(MON + 5 * DAY_MS); await s.m.vote('Bob', 'Ann');
  s.set(MON + WEEK_MS + 9 * H); return s;
}

describe('levers: bounds and cooldowns', () => {
  it('clamps and snaps every lever to its hard bounds', () => {
    expect(clampLever('sales_tax', 0.5)).toBe(0.05); expect(clampLever('sales_tax', -1)).toBe(0); expect(clampLever('sales_tax', 0.0123)).toBe(0.01);
    expect(clampLever('wealth_tax', 0.2)).toBe(0.07); expect(clampLever('wealth_tax', 0)).toBe(0.03); expect(clampLever('wealth_tax', 'x')).toBe(0.05);
    expect(clampLever('freight', 3)).toBe(1.2); expect(clampLever('freight', 0.1)).toBe(0.8);
    expect(purchaseTaxOf(200_000, 10_000, 0.5)).toBe(700); expect(purchaseTaxOf(200_000, 10_000, 0)).toBe(300); expect(purchaseTaxOf(200_000, 10_000)).toBe(500);
  });
  it('only the sitting mayor; cooldown per lever; changes logged; hot readers follow', async () => {
    const s = await withMayor(); setCityForTest(s.c);
    try {
      await expect(s.c.setLever('Bob', 'sales_tax', 0.02)).rejects.toThrow(/sitting mayor/);
      expect(citySalesTaxRate()).toBe(0); expect(cityWealthTaxRate()).toBe(0.05); expect(cityFreightMul()).toBe(1);
      await s.c.setLever('Ann', 'sales_tax', 0.9); expect(citySalesTaxRate()).toBe(0.05);
      await expect(s.c.setLever('Ann', 'sales_tax', 0.01)).rejects.toThrow(/can change again/);
      await s.c.setLever('Ann', 'wealth_tax', 0.07); await s.c.setLever('Ann', 'freight', 1.2);
      expect(cityWealthTaxRate()).toBe(0.07); expect(cityFreightMul()).toBeCloseTo(1.2);
      s.set(s.now + 48 * H); await s.c.setLever('Ann', 'sales_tax', 0.01);
      await expect(s.c.setLever('Ann', 'wealth_tax', 0.03)).rejects.toThrow(/can change again/); // 72 h
      const v = await s.c.view(null); expect(v.actions.filter((a) => a.kind === 'lever')).toHaveLength(4);
      expect(v.actions[0]!.text).toMatch(/Sales tax: 5% → 1%/);
    } finally { setCityForTest(null); }
  });
});

describe('treasury', () => {
  it('sales tax and the treasury credit commit in ONE transaction with the wallet debit (or neither)', async () => {
    const s = await withMayor(); setCityForTest(s.c);
    try {
      await s.c.setLever('Ann', 'sales_tax', 0.05);
      const st = salesTaxFor('Bob', 10_000, 'car_buy:t1', 'a car'); expect(st.tax).toBe(500); expect(st.stmts).toHaveLength(2);
      const tx = async (moves: any[], extra: any[]) => {
        let w: any; try { w = s.bank.transferAtomic(moves); } catch { return false; } const run = (async () => { await w.after; const cl = await s.pool.connect();
          try { await cl.query('BEGIN'); for (const x of [...w.stmts, ...extra]) await cl.query(x.sql, x.args); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); } })();
        w.bind(run); try { await run; return true; } catch { w.revert(); return false; } };
      expect(await tx([{ name: 'Bob', amount: -10_000, key: 'car_buy:t1', game: 'car_buy' }, st.move], st.stmts)).toBe(true);
      expect(await s.c.balance()).toBe(500); expect(await s.sumGame('sales_tax')).toBe(-500);
      // a failing purchase (replayed key) rolls the treasury credit back too
      const st2 = salesTaxFor('Bob', 10_000, 'car_buy:t1', 'a car');
      expect(await tx([{ name: 'Bob', amount: -10_000, key: 'car_buy:t1', game: 'car_buy' }, st2.move], st2.stmts)).toBe(false);
      expect(await s.c.balance()).toBe(500);
      // player-to-player market trades never carry sales tax: the only callers are the game's own shops
      for (const f of ['market.ts', 'stocks.ts', 'realEstate.ts']) expect(readFileSync(`server/${f}`, 'utf8')).not.toMatch(/salesTaxFor/);
      for (const f of ['cars.ts', 'fleet.ts', 'logistics.ts', 'homes.ts']) expect(readFileSync(`server/${f}`, 'utf8')).toMatch(/salesTaxFor/);
    } finally { setCityForTest(null); }
  });
  it('QA / guest / bot payers are burned, not credited; the treasury is capped', async () => {
    const s = await setup(); setCityForTest(s.c);
    try {
      expect(treasuryStmtsFor('QA-Cole-Visit', 'sales_tax', 100, 'x')).toEqual([]); expect(treasuryStmtsFor('guest123', 'x', 100, 'x')).toEqual([]); expect(treasuryStmtsFor('bot7', 'x', 100, 'x')).toEqual([]);
      expect(treasuryStmtsFor('Ann', 'x', 100, 'x')).toHaveLength(2);
      await s.fund(TREASURY_CAP - 10); for (const x of treasuryCreditStmts('t', 500, 'big', 1)) await s.pool.query(x.sql, x.args);
      expect(await s.c.balance()).toBe(TREASURY_CAP);
    } finally { setCityForTest(null); }
    expect(treasuryStmtsFor('Ann', 'x', 100, 'x')).toEqual([]); // offline City Hall = burned as before
  });
  it('there is NO path from the treasury to any wallet', async () => {
    const src = readFileSync('server/city.ts', 'utf8') + readFileSync('server/city-rates.ts', 'utf8');
    expect(src.match(/transferAtomic\(/g)).toHaveLength(1); expect(src).toMatch(/amount: -RECALL_FEE/);
    expect(src).not.toMatch(/\.transfer\(|transferConfirmed|credit\(/);
    // every treasury debit is a policy, a treasury project or a building (sinks)
    expect([...src.matchAll(/this\.spend\(cl, \w+, '(\w+)'/g)].map((m) => m[1]).sort()).toEqual(['build', 'policy', 'project']);
    // and a full mayor term moves no chips into any wallet from city games
    const s = await withMayor(); await s.fund(5_000_000); await s.c.startPolicy('Ann', 'trade_week'); await s.c.build('Ann', 'park');
    const pos = await s.pool.query("SELECT COUNT(*) AS n FROM wallet_transactions WHERE amount > 0 AND game IN ('sales_tax','recall_fee','policy','build','project','treasury')");
    expect(Number(pos.rows[0].n)).toBe(0);
  });
  it('casino odds and payouts are untouched: no casino module reads the city, and no lever / sector / perk targets them', () => {
    const casino = readdirSync('server').filter((f) => /casino|slots|blackjack|roulette|poker|plinko|crash|mines-game|dice|baccarat/i.test(f) && f.endsWith('.ts'));
    expect(casino.length).toBeGreaterThan(0);
    for (const f of casino) expect(readFileSync(`server/${f}`, 'utf8')).not.toMatch(/city(-rates)?\.js/);
    const words = JSON.stringify({ LEVER_IDS, SECTORS, perks: BUILDING_IDS.map((b) => BUILDINGS[b].perk) });
    expect(words).not.toMatch(/casino|slot|odds|payout|blackjack|roulette|bet/i);
  });
});

describe('policies and buildings', () => {
  it('a policy costs the treasury (x price index), lasts 24 h, then 72 h cooldown', async () => {
    const s = await withMayor(); setCityForTest(s.c);
    try {
      await expect(s.c.startPolicy('Ann', 'mining_boom')).rejects.toThrow(/treasury doesn't have/);
      await s.fund(100_000); await s.c.startPolicy('Ann', 'mining_boom'); expect(await s.c.balance()).toBe(100_000 - POLICIES.mining_boom.cost);
      expect(cityPolicyMul('mining')).toBe(1.1); expect(cityPolicyMul('farming')).toBe(1);
      await expect(s.c.startPolicy('Ann', 'farm_subsidy')).rejects.toThrow(/already running/);
      s.set(s.now + DAY_MS); expect(cityPolicyMul('mining')).toBe(1);
      await expect(s.c.startPolicy('Ann', 'farm_subsidy')).rejects.toThrow(/next policy/);
      s.set(s.now + 72 * H); await s.c.startPolicy('Ann', 'tourism_push'); expect(cityTicketPrice(1000)).toBe(750);
      await s.c.startPolicy('Ann', 'farm_subsidy').catch(() => {}); expect(cityTradeFeeMul()).toBe(1);
    } finally { setCityForTest(null); }
  });
  it('buildings: 3 stages, one project at a time, perks switch on when a stage finishes', async () => {
    const s = await withMayor(); setCityForTest(s.c);
    try {
      await s.fund(5_000_000);
      const r = await s.c.build('Ann', 'police'); expect(r).toMatchObject({ stage: 1, cost: 300_000 });
      expect(cityPerk('property_upkeep')).toBe(0);
      await expect(s.c.build('Ann', 'park')).rejects.toThrow(/under construction/);
      await expect(s.c.build('Bob', 'park')).rejects.toThrow(/sitting mayor/);
      s.set(r.doneAt); expect(cityPerk('property_upkeep')).toBe(0.1);
      await s.c.build('Ann', 'police'); s.set(s.now + DAY_MS); await s.c.build('Ann', 'police'); s.set(s.now + DAY_MS);
      expect(cityPerk('property_upkeep')).toBe(0.3); await expect(s.c.build('Ann', 'police')).rejects.toThrow(/fully built/);
      expect(await s.c.balance()).toBe(5_000_000 - 2_100_000);
      const v = await s.c.view(null); expect(v.buildings.find((b) => b.id === 'police')!.stage).toBe(3);
      expect(v.actions.filter((a) => a.kind === 'built')).toHaveLength(3);
      expect(perkOf('police', 2)).toBe(0.2); expect(BUILDINGS.police.perk).toBe('property_upkeep');
      // finishing twice (two instances) never double-writes
      const c2 = new City(s.pool as never, () => s.m, () => s.now, () => s.bank, () => 1); await c2.init(); await c2.finish(); await s.c.finish();
      expect((await s.c.view(null)).actions.filter((a) => a.kind === 'built')).toHaveLength(3);
    } finally { setCityForTest(null); }
  });
  it('building costs scale with the price index', async () => {
    const s = await withMayor(); const c = new City(s.pool as never, () => s.m, () => s.now, () => s.bank, () => 2); await c.init(); await s.fund(1_000_000);
    expect((await c.build('Ann', 'lights')).cost).toBe(200_000);
  });
});

describe('approval, recall and exclusions', () => {
  const crowd = Array.from({ length: 24 }, (_, i) => `Voter${String(i).padStart(2, '0')}`);
  it('rating once per day; 10-vote minimum; recall rules, vote, and runner-up takeover', async () => {
    const s = await withMayor(crowd); setCityForTest(s.c);
    try {
      await s.c.setLever('Ann', 'sales_tax', 0.03);
      await expect(s.c.rate('Ann', 'up')).rejects.toThrow(/yourself/);
      await s.c.rate('Bob', 'up'); await expect(s.c.rate('Bob', 'down')).rejects.toThrow(/already rated/);
      expect((await s.c.view(null)).approval.rating).toBeNull();
      for (const v of crowd.slice(0, 20)) await s.c.rate(v, 'down');
      expect((await s.c.view(null)).approval.rating).toBeCloseTo(1 / 21);
      expect(await s.c.recallBlock('Bob')).toMatch(/48 hours/);
      s.set(s.now + 48 * H);
      const chips = s.bank.account('Bob').chips; await s.c.openRecall('Bob');
      expect(s.bank.account('Bob').chips).toBe(chips - RECALL_FEE); expect(await s.c.balance()).toBe(RECALL_FEE);
      await expect(s.c.openRecall('Cat')).rejects.toThrow(/already been a recall|There has/);
      await expect(s.c.voteRecall('Ann', 'yes')).rejects.toThrow(/own recall/);
      for (const v of crowd.slice(0, 14)) await s.c.voteRecall(v, 'yes');
      await expect(s.c.voteRecall('Voter00', 'no')).rejects.toThrow(/already voted/);
      await s.c.voteRecall('Cat', 'no');
      s.set(s.now + DAY_MS); const v = await s.c.view(null);
      expect(v.recall).toMatchObject({ result: 'passed', yes: 15, no: 1 });
      expect(await s.m.mayor(s.now)).toMatchObject({ name: 'Cat', week: '2026-11-02-r' });
      expect(citySalesTaxRate()).toBe(0); expect(v.actions.some((a) => a.kind === 'recall_result' && /Cat takes over/.test(a.text))).toBe(true);
      await expect(s.c.setLever('Ann', 'sales_tax', 0.02)).rejects.toThrow(/sitting mayor/);
      await s.c.settleRecalls(s.now + H); expect((await s.c.view(null)).actions.filter((a) => a.kind === 'recall_result')).toHaveLength(1); // once
    } finally { setCityForTest(null); }
  });
  it('recall thresholds', () => {
    expect(recallNeeded(10)).toBe(15); expect(recallNeeded(100)).toBe(40);
    expect(recallPasses(9, 6, 10)).toBe(true); expect(recallPasses(8, 6, 10)).toBe(false); expect(recallPasses(20, 14, 10)).toBe(false);
  });
  it('QA, guest, bot and jailed accounts are excluded from running, voting, rating and recall', async () => {
    expect(isExcludedName('QA-Cole-Visit')).toBe(true); expect(isExcludedName('guest_9')).toBe(true); expect(isExcludedName('bot3')).toBe(true); expect(isExcludedName('Bottle')).toBe(false);
    const s = await withMayor(['QA-Tester', 'guest42', 'Jay']);
    await expect(s.c.rate('QA-Tester', 'up')).rejects.toThrow(/Test, guest and bot/);
    await expect(s.c.rate('guest42', 'up')).rejects.toThrow(/Test, guest and bot/);
    await expect(s.m.eligibility('QA-Tester')).resolves.toMatch(/Test, guest and bot/);
    await getJail().jail('Jay', 1, 'test');
    try {
      await expect(s.c.rate('Jay', 'up')).rejects.toThrow(/City Jail/); await expect(s.c.openRecall('Jay')).rejects.toThrow(/City Jail/);
      await expect(s.m.eligibility('Jay')).resolves.toMatch(/City Jail/);
    } finally { await getJail().release('Jay', 'test'); }
    await expect(s.c.rate('Jay', 'up')).resolves.toBeTruthy();
  });
  it('the dev-only QA flag is ignored in production', async () => {
    const { politicsExcluded } = await import('../server/city-rates');
    const env = { ...process.env };
    try {
      process.env.CITY_DEV_ALLOW_QA = '1'; process.env.NODE_ENV = 'development'; expect(politicsExcluded('QA-Cole-Visit')).toBe(false);
      process.env.NODE_ENV = 'production'; expect(politicsExcluded('QA-Cole-Visit')).toBe(true);
    } finally { process.env = env; }
  });
});
void LEVERS;
