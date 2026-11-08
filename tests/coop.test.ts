import { whAdd, whQty } from './helpers/warehouseStock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { Coop, resetCoop, sellCapMul } from '../server/coop';
import { setJail, Jail } from '../server/jail';
import { hockeyDailyCap } from '../server/hockey';
import { ticketPrice } from '../server/travel';
import { houseRoom } from '../server/house-room';
import { HK_DAILY_PAID_WINS } from '../shared/hockey';
import { LAUNCH } from '../shared/launchPopup';
import {
  COOP_PLAN, DONOR_REWARD_CAP, DONOR_REWARD_RATE, SELL_BONUS_MAX, contractAt, contractIndex, contractPay, donorReward, partKey, playerCap, projectStages, projectValue,
  sellBonusK, sellCapBonus, sellBonusPct, recentDonated, SELL_BONUS_WINDOW_DAYS, SELL_BONUS_WINDOW_MS, CONTRACT_BONUS, CONTRACT_CLAIM_CAP, inStadiumSite, STADIUM_SITE,
} from '../shared/coop';
import { HOUSE_DAILY_BASE } from '../shared/mines';

const HOUR = 3_600_000, DAY = 24 * HOUR;
let n = 0; const nonce = () => `nonce${++n}x${Math.random().toString(36).slice(2, 8)}`;
const fund = (who: string, amt: number) => getBank().transferConfirmed(who, amt, { key: `test_fund:${who}:${Math.random()}`, game: 'admin' });
const chips = (who: string) => getBank().account(who).chips;
const OLD = async () => ({ ageMs: 30 * DAY, playMs: 50 * HOUR });

/** Fill the current stadium stage completely, donating from `who` (funded/stocked as needed). */
async function fillStage(c: Coop, who: string) {
  const id = c.activeProject()!; const st = projectStages(COOP_PLAN[id])[c.stagesDone(id)]!; const row = c.projectView(id).stages[c.stagesDone(id)]!.done;
  const left = st.chips - (row.chips ?? 0); if (left > 0) { fund(who, left); await c.donate(who, { project: id, part: 'chips', qty: left, nonce: nonce() }); }
  for (const g of st.goods) { const q = g.qty - (row[partKey(g)] ?? 0); if (q <= 0) continue; whAdd(who, g.type, g.id, q); await c.donate(who, { project: id, part: partKey(g), qty: q, nonce: nonce() }); }
}

describe('co-op sizing + rules', () => {
  it('stadium totals about 693k over 4 stages; bridge follows', () => {
    expect(COOP_PLAN.stadium.total).toBe(693_000); expect(COOP_PLAN.stadium.stages.map((s) => s.id)).toEqual(['foundation', 'frame', 'stands', 'roof']);
    expect(Math.abs(projectValue(COOP_PLAN.stadium) - 693_000) / 693_000).toBeLessThan(0.01);
    expect(COOP_PLAN.bridge.stages).toHaveLength(4);
  });
  it('donor reward is 10%, capped, and always below the donation', () => {
    expect(donorReward(10_000, 0)).toBe(10_000 * DONOR_REWARD_RATE);
    expect(donorReward(10_000_000, 0)).toBe(DONOR_REWARD_CAP); expect(donorReward(1000, DONOR_REWARD_CAP)).toBe(0);
    for (const v of [100, 1234, 99_999, 5_000_000]) expect(donorReward(v, 0)).toBeLessThan(v);
  });
  it('contracts rotate daily; pay is proportional + completion bonus, capped per claim', () => {
    const a = contractAt(100), b = contractAt(101); expect(b.start - a.start).toBe(DAY); expect(a.deadline).toBe(b.start);
    const p1 = contractPay(a, 10, true), p2 = contractPay(a, 20, true); expect(p2.base).toBeCloseTo(p1.base * 2, -1); expect(p1.bonus).toBe(Math.floor(p1.base * CONTRACT_BONUS));
    expect(contractPay(a, 10, false).bonus).toBe(0); expect(contractPay(a, 1e9, true).total).toBe(CONTRACT_CLAIM_CAP); expect(playerCap(a)).toBe(Math.floor(a.qty / 2));
  });
  it('stadium site keeps trees/rocks out', () => { expect(inStadiumSite(STADIUM_SITE.x, STADIUM_SITE.z)).toBe(true); expect(inStadiumSite(0, 0)).toBe(false);
    expect(inStadiumSite(STADIUM_SITE.x + STADIUM_SITE.w / 2 + 10, STADIUM_SITE.z + STADIUM_SITE.d / 2 + 10)).toBe(true); expect(inStadiumSite(STADIUM_SITE.x + STADIUM_SITE.w / 2 + 13, STADIUM_SITE.z)).toBe(false); });
  it('is in the launch popup', () => {
    const co = LAUNCH.items.filter((i) => i.section === 'Co-op'); expect(co.length).toBeGreaterThanOrEqual(4);
    expect(co.some((i) => /sell-cap/i.test(i.title))).toBe(true); expect(co.some((i) => /contract/i.test(i.title))).toBe(true);
  });
});

describe('stadium sell-cap bonus', () => {
  it('K = 60 days of the base cap; curve values at 100k / 1M / 5M', () => {
    expect(sellBonusK(1)).toBe(6_000_000); expect(sellBonusK(2)).toBe(12_000_000); expect(sellBonusK(0.5)).toBe(6_000_000);
    expect(sellCapBonus(0)).toBe(0); expect(sellCapBonus(-5)).toBe(0);
    expect(sellBonusPct(sellCapBonus(100_000))).toBeCloseTo(0.8, 1); expect(sellBonusPct(sellCapBonus(1_000_000))).toBeCloseTo(7.6, 0);
    expect(sellBonusPct(sellCapBonus(5_000_000))).toBeCloseTo(28.3, 0);
    let prev = 0; for (const d of [1e3, 1e4, 1e5, 1e6, 3e6, 1e7]) { const b = sellCapBonus(d); expect(b).toBeGreaterThan(prev); prev = b; } // monotone
  });
  it('hard max +50%', () => { expect(sellCapBonus(1e12)).toBe(SELL_BONUS_MAX); expect(sellCapBonus(25_000_000)).toBeLessThanOrEqual(0.5); });
  it('no profit over 30 days: bonus value + rebate < donation, for any donation and cap index', () => {
    for (const idx of [1, 1.7, 4]) for (const D of [100, 1e4, 1e5, 5e5, 1e6, 3e6, 1e7, 2.5e7, 1e9]) {
      const extraCap30 = 30 * HOUSE_DAILY_BASE * idx * sellCapBonus(D, idx); // every extra chip of cap fully used, at 100% margin (worst case)
      expect(extraCap30 + donorReward(D, 0)).toBeLessThan(D);
      expect(extraCap30).toBeLessThanOrEqual(D / 2 + 1e-6);
    }
  });
  it('worst-case lifetime return of a donation (rebate + 60 days of fully-used extra cap) stays <= 0.60x', () => {
    let worst = 0;
    for (const idx of [1, 1.7, 4]) for (const D0 of [0, 1e5, 1e6, 5e6, 2e7]) for (const d of [100, 1e3, 1e4, 1e5, 2.5e5, 1e6, 3e6, 1e7, 2.5e7, 1e9]) {
      const C = HOUSE_DAILY_BASE * idx; // seller maxes the (boosted) cap every day at 100% margin
      const extra = SELL_BONUS_WINDOW_DAYS * C * (sellCapBonus(D0 + d, idx) - sellCapBonus(D0, idx)); // d counts for exactly 60 days
      const ratio = (extra + donorReward(d, 0)) / d; worst = Math.max(worst, ratio);
      expect(ratio).toBeLessThanOrEqual(0.6);
    }
    expect(worst).toBeLessThanOrEqual(0.6); expect(worst).toBeGreaterThan(0.59); // analytic bound 60*0.5/60 + 0.1 = 0.60
  });
  it('only the last 60 days of donations count; older ones roll off', async () => {
    const t0 = 500 * DAY; expect(SELL_BONUS_WINDOW_MS).toBe(60 * DAY);
    const log = [{ at: t0, value: 1_000_000 }, { at: t0 + 30 * DAY, value: 500_000 }];
    expect(recentDonated(log, t0 + DAY)).toBe(1_000_000); expect(recentDonated(log, t0 + 59 * DAY)).toBe(1_500_000);
    expect(recentDonated(log, t0 + 60 * DAY)).toBe(500_000); expect(recentDonated(log, t0 + 91 * DAY)).toBe(0);
    resetBank(); resetMines(); setPriceIndexForTest(1); let now = t0; const c = resetCoop(new Coop(null, () => now));
    fund('Roller', 2_000_000); await c.donate('Roller', { project: 'stadium', part: 'chips', qty: 20_000, nonce: nonce() });
    expect(c.sellBonus('Roller')).toBeCloseTo(sellCapBonus(20_000), 10);
    now = t0 + 61 * DAY; expect(c.sellBonus('Roller')).toBe(0); expect(c.stadiumDonated('Roller')).toBe(20_000);
    expect(c.view('Roller').stadiumRecent).toBe(0);
  });
  it('stacks across donations (by total given), boosts mines.quote + house room cap', async () => {
    resetBank(); resetMines(); setPriceIndexForTest(1); const c = resetCoop(new Coop(null));
    expect(sellCapMul('Stacker')).toBe(1); const q0 = getMines().quote('Stacker', Date.now()).capBase;
    fund('Stacker', 2_000_000);
    await c.donate('Stacker', { project: 'stadium', part: 'chips', qty: 20_000, nonce: nonce() });
    const b1 = c.sellBonus('Stacker');
    await c.donate('Stacker', { project: 'stadium', part: 'chips', qty: 20_000, nonce: nonce() });
    expect(c.stadiumDonated('Stacker')).toBe(40_000); expect(c.sellBonus('Stacker')).toBeCloseTo(sellCapBonus(40_000), 10); expect(c.sellBonus('Stacker')).toBeGreaterThan(b1);
    expect(getMines().quote('Stacker', Date.now()).capBase).toBeCloseTo(q0 * (1 + sellCapBonus(40_000)), 3);
    const r = houseRoom('Stacker'); expect(r.bonus).toBeCloseTo(sellCapBonus(40_000), 6); expect(r.cap).toBe(Math.floor(HOUSE_DAILY_BASE * (1 + sellCapBonus(40_000))));
    expect(c.view('Stacker').sellBonus).toBeCloseTo(sellCapBonus(40_000), 10);
    resetCoop();
  });
});

describe('Coop server', () => {
  let now = 1000 * DAY + HOUR; let c: Coop;
  beforeEach(() => { resetBank(); resetMines(); setPriceIndexForTest(1); now = 1000 * DAY + HOUR; c = resetCoop(new Coop(null, () => now)); c.accountInfo = OLD; });
  afterEach(() => { resetCoop(); setJail(new Jail(null)); });

  it('chip donation: debit + reward through the wallet; replay is a no-op', async () => {
    fund('Alice', 100_000); const c0 = chips('Alice'); const nn = nonce();
    const r = await c.donate('Alice', { project: 'stadium', part: 'chips', qty: 10_000, nonce: nn });
    expect(r.reward).toBe(1_000); expect(chips("Alice")).toBe(c0 - 10_000 + 1_000);
    const again = await c.donate('Alice', { project: 'stadium', part: 'chips', qty: 10_000, nonce: nn }); expect(again.replay).toBe(true);
    expect(chips('Alice')).toBe(c0 - 9_000); expect(c.projectView('stadium').top[0]).toEqual({ name: 'Alice', value: 10_000 });
  });
  it('goods donation takes warehouse stock; refuses what you lack; reward cap holds', async () => {
    const g = projectStages(COOP_PLAN.stadium)[0]!.goods[0]!; const q = Math.min(g.qty, Math.ceil(1000 / g.price)); whAdd('Bob', g.type, g.id, q);
    await expect(c.donate('Bob', { project: 'stadium', part: partKey(g), qty: q + 1, nonce: nonce() })).rejects.toThrow(/don’t have/);
    expect(whQty('Bob', g.type, g.id)).toBe(q);
    const r = await c.donate('Bob', { project: 'stadium', part: partKey(g), qty: q, nonce: nonce() }); expect(whQty('Bob', g.type, g.id)).toBe(0);
    expect(r.value).toBe(q * g.price); expect(c.projectView('stadium').stages[0]!.done[partKey(g)]).toBe(q); expect(r.reward).toBeLessThan(r.value);
    // The reduced stadium is too small to hit the 50k reward ceiling; exercise it on the unchanged bridge.
    for (let i = 0; i < 4; i++) await fillStage(c, 'Builder');
    fund('Big', 10_000_000); await c.donate('Big', { project: 'bridge', part: 'chips', qty: 600_000, nonce: nonce() });
    expect(c.view('Big').me!.rewarded).toBe(DONOR_REWARD_CAP);
  });
  it('concurrency: parallel donations never over-fill a stage, never double-spend', async () => {
    const st = projectStages(COOP_PLAN.stadium)[0]!; const ppl = Array.from({ length: 12 }, (_, i) => `Racer${i}`);
    for (const p of ppl) fund(p, st.chips);
    const before = ppl.reduce((a, p) => a + chips(p), 0);
    const res = await Promise.allSettled(ppl.map((p) => c.donate(p, { project: 'stadium', part: 'chips', qty: Math.ceil(st.chips / 5), nonce: nonce() })));
    const ok = res.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ qty: number; reward: number }>).value);
    const given = ok.reduce((a, r) => a + r.qty, 0), rewards = ok.reduce((a, r) => a + r.reward, 0);
    expect(given).toBe(st.chips); expect(c.projectView('stadium').stages[0]!.done.chips).toBe(st.chips);
    expect(before - ppl.reduce((a, p) => a + chips(p), 0)).toBe(given - rewards);
  });
  it('excludes QA, bot and jailed accounts', async () => {
    fund('QA-Someone', 10_000); fund('bot-steve', 10_000); fund('Jailbird', 10_000); const j0 = chips('Jailbird');
    await expect(c.donate('QA-Someone', { project: 'stadium', part: 'chips', qty: 1000, nonce: nonce() })).rejects.toThrow(/QA and bot/);
    await expect(c.donate('bot-steve', { project: 'stadium', part: 'chips', qty: 1000, nonce: nonce() })).rejects.toThrow(/QA and bot/);
    setJail({ isJailed: (x: string | null | undefined) => x === 'Jailbird' } as unknown as Jail);
    await expect(c.donate('Jailbird', { project: 'stadium', part: 'chips', qty: 1000, nonce: nonce() })).rejects.toThrow(/jail/);
    expect(chips('Jailbird')).toBe(j0);
  });
  it('stages complete in order; stadium perk = 6th paid hockey win; bridge perk = half-price Fort McChud', async () => {
    const full = ticketPrice('fortmc');
    expect(hockeyDailyCap()).toBe(HK_DAILY_PAID_WINS);
    for (let i = 0; i < 4; i++) { expect(c.stagesDone('stadium')).toBe(i); await fillStage(c, 'Builder'); }
    expect(c.perk('stadium')).toBe(true); expect(c.projectView('stadium').state).toBe('complete'); expect(hockeyDailyCap()).toBe(HK_DAILY_PAID_WINS + 1);
    expect(c.activeProject()).toBe('bridge'); expect(ticketPrice('fortmc')).toBe(full);
    await expect(c.donate('Builder', { project: 'stadium', part: 'chips', qty: 1000, nonce: nonce() })).rejects.toThrow(/isn’t taking/);
    for (let i = 0; i < 4; i++) await fillStage(c, 'Builder');
    expect(c.perk('bridge')).toBe(true); expect(ticketPrice('fortmc')).toBe(Math.ceil(full / 2));
  });
  it('contracts: anti-alt gate, per-player cap, proportional pay + bonus, claim once', async () => {
    const cur = c.current(); const it0 = contractAt(contractIndex(now)); expect(cur.id).toBe(`c${contractIndex(now)}`);
    const g = (await import('../shared/mines')).GOODS[it0.item]!; const cap = playerCap(cur);
    c.accountInfo = async (x) => (x === 'Newbie' ? { ageMs: DAY, playMs: 10 * HOUR } : x === 'Idle' ? { ageMs: 10 * DAY, playMs: HOUR } : OLD());
    whAdd('Newbie', g.type, g.id, 10); whAdd('Idle', g.type, g.id, 10);
    await expect(c.deliver('Newbie', { contract: cur.id, qty: 5, nonce: nonce() })).rejects.toThrow(/3 days/);
    await expect(c.deliver('Idle', { contract: cur.id, qty: 5, nonce: nonce() })).rejects.toThrow(/2 hours/);
    const ppl = ['H1', 'H2', 'H3', 'H4', 'H5']; for (const p of ppl) whAdd(p, g.type, g.id, cur.qty);
    const n1 = nonce(); const d1 = await c.deliver('H1', { contract: cur.id, qty: cur.qty, nonce: n1 }); expect(d1.qty).toBe(cap);
    expect((await c.deliver('H1', { contract: cur.id, qty: 5, nonce: n1 })).replay).toBe(true);
    await expect(c.deliver('H1', { contract: cur.id, qty: 5, nonce: nonce() })).rejects.toThrow(/share/);
    await expect(c.claim('H1', cur.id)).rejects.toThrow(/Pay opens/);
    await Promise.all(ppl.slice(1).map((p) => c.deliver(p, { contract: cur.id, qty: cap, nonce: nonce() }).catch(() => null)));
    const v = c.contractView(cur, 'H1'); expect(v.delivered).toBe(cur.qty); expect(v.filled).toBe(true);
    expect(whQty('H1', g.type, g.id)).toBe(cur.qty - cap);
    const c0 = chips('H1'); const pay = await c.claim('H1', cur.id); const exp = contractPay(cur, cap, true);
    expect(pay.total).toBe(exp.total); expect(pay.bonus).toBeGreaterThan(0); expect(chips('H1')).toBe(c0 + exp.total);
    await expect(c.claim('H1', cur.id)).rejects.toThrow(/Already/);
    const both = await Promise.allSettled([c.claim('H2', cur.id), c.claim('H2', cur.id)]); expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(c.claim('Nobody', cur.id)).rejects.toThrow(/didn’t deliver/);
  });
});
