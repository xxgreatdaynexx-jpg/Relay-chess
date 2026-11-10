import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { WeeklyEvents, resetWeekly, eventCredit } from '../server/weeklyEvent';
import { DAILY_EVENT_GOALS, DAILY_EVENT_GOALS_RETUNE, DAILY_EVENT_TIERS, DAILY_EVENT_TIERS_RETUNE, DAILY_EVENTS, DAILY_EVENTS_RETUNE, EVENT_CLAIM_MS, EVENT_DAILY_FROM, EVENT_ORDER, EVENT_PAYOUT_FROM, EVENT_RETUNE_FROM, EVENT_TIERS, EVENTS, LEGACY_EVENT_TIERS, WEEKLY_EVENT_GOALS, eventDailyEpoch, eventFor, eventReward, eventTiersFor, periodIndex, periodStart, playerEventCap, TRADE_COUNT_CAP, weekIndex, weekStart } from '../shared/coop3';
import { expectChangelogEntry, expectChangelogOrder } from './helpers/changelog';

const W = weekIndex(Date.parse('2026-11-04T18:00:00Z')); // a mining-or-whatever week; tests pick weeks by kind
const weekOf = (kind: string) => { for (let w = W; ; w++) if (eventFor(w).id === kind) return w; };
let now = 0; let ev: WeeklyEvents;
const at = (w: number, off = 3_600_000) => { now = periodStart(w) + off; };

describe('weekly server events', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); ev = resetWeekly(new WeeklyEvents(null, () => now)); ev.guard.excluded = (n) => (/^(qa-|bot)/i.test(n) || n === 'Jailbird' ? 'nope' : null); });
  afterEach(() => resetWeekly());

  it('rotates through all five events, one per week, Monday 00:00 MST', () => {
    expect(new Set(EVENT_ORDER.map((_, i) => eventFor(W + i).id)).size).toBe(5);
    expect(new Date(weekStart(W)).getUTCDay()).toBe(1); expect(new Date(weekStart(W)).getUTCHours()).toBe(7);
  });

  it('only the running event counts; per-player cap; excluded accounts and duplicates ignored', () => {
    const w = weekOf('fishing'); at(w); const e = eventFor(w); const cap = playerEventCap(e);
    expect(eventCredit('mining', 'Ann', 5)).toBe(0);
    expect(eventCredit('fishing', 'Ann', 1, 'f1')).toBe(1); expect(eventCredit('fishing', 'Ann', 1, 'f1')).toBe(0);
    expect(eventCredit('fishing', 'QA-Cole-Visit', 1)).toBe(0); expect(eventCredit('fishing', 'Jailbird', 1)).toBe(0); expect(eventCredit('fishing', 'Bot7', 1)).toBe(0);
    expect(eventCredit('fishing', 'Ann', cap * 5)).toBe(cap - 1);
    const v = ev.view('Ann'); expect(v.progress).toBe(cap); expect(v.me).toMatchObject({ amount: cap, tier: 'gold' }); expect(v.top[0]).toEqual({ name: 'Ann', amount: cap });
    expect(ev.view('QA-Cole-Visit').me?.excluded).toBeTruthy();
  });

  it('trade week: both sides count, capped per trade, self and linked trades ignored', () => {
    const w = weekOf('trade'); at(w);
    ev.creditTrade('Ann', 'Bob', TRADE_COUNT_CAP * 10, 's1'); ev.creditTrade('Ann', 'Bob', 1000, 's1'); ev.creditTrade('Ann', 'ann', 5000, 's2');
    const v = ev.view(null); expect(v.progress).toBe(eventFor(w).goal);
  });

  it('claim: tiered, halved under goal, nothing under 50%; atomic and once only; window closes', async () => {
    const w = weekOf('hockey'); at(w); const e = eventFor(w); const cap = playerEventCap(e);
    // Two gold-tier helpers (≥0.6 of cap each) so total ≥50% of goal when possible; plus bronze.
    eventCredit('hockey', 'P0', Math.max(1, Math.ceil(cap * 0.6)));
    eventCredit('hockey', 'P1', Math.max(1, Math.ceil(cap * 0.6)));
    eventCredit('hockey', 'Low', Math.max(1, Math.ceil(cap * 0.05)));
    const serverPct = Math.min(1, ev.view(null).progress / e.goal);
    expect(serverPct).toBeGreaterThanOrEqual(0.5);
    await expect(ev.claim('P0')).rejects.toThrow(/didn’t take part/); // still this period
    at(w + 1);
    const before = getBank().account('P0').chips; const r = await ev.claim('P0');
    const amt0 = ev.view('P0').past?.amount ?? cap;
    const expectPay = eventReward(e, amt0, serverPct, 1, w); expect(r.amount).toBe(expectPay);
    expect(getBank().account('P0').chips - before).toBe(expectPay);
    await expect(ev.claim('P0')).rejects.toThrow(/Already/);
    const [a, b] = await Promise.allSettled([ev.claim('P1'), ev.claim('P1')]); expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const lowAmt = Math.max(1, Math.ceil(cap * 0.05));
    expect((await ev.claim('Low')).amount).toBe(eventReward(e, lowAmt, serverPct, 1, w));
    expect(ev.view('P1').past?.claimed).toBe(true);
    now = periodStart(w + 1) + EVENT_CLAIM_MS + 1; await expect(ev.claim('P1')).rejects.toThrow(/closed|didn’t take part/);
    const w2 = weekOf('mining'); at(w2); const e2 = eventFor(w2);
    eventCredit('mining', 'Solo', Math.floor(e2.goal * 0.4)); at(w2 + 1); await expect(ev.claim('Solo')).rejects.toThrow(/50%/);
  });

  it('persists counts with a capped UPSERT and claims with a guard row (pg)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const w = weekOf('harvest'); at(w); ev = resetWeekly(new WeeklyEvents(pool as never, () => now)); ev.guard.excluded = () => null; await ev.init();
    const cap = playerEventCap(eventFor(w));
    eventCredit('harvest', 'Ann', 10); eventCredit('harvest', 'Ann', cap * 2); await ev.flush();
    expect(Number(db.public.one(`SELECT amount FROM wev_contrib WHERE player_key = 'ann'`).amount)).toBe(cap);
    const re = new WeeklyEvents(pool as never, () => now); await re.init(); expect(re.view('Ann').me?.amount).toBe(cap);
  });

  it('ref dedup is persisted: a restart or a second instance cannot count the same ref again (pg)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const w = weekOf('fishing'); at(w);
    const a = new WeeklyEvents(pool as never, () => now); a.guard.excluded = () => null; await a.init();
    const b = new WeeklyEvents(pool as never, () => now); b.guard.excluded = () => null; await b.init(); // second instance, booted before the credit
    expect(a.credit('fishing', 'Ann', 1, 'fish-1')).toBe(1); await a.flush();
    const re = new WeeklyEvents(pool as never, () => now); re.guard.excluded = () => null; await re.init(); // restart
    expect(re.credit('fishing', 'Ann', 1, 'fish-1')).toBe(0); await re.flush();
    b.credit('fishing', 'Ann', 1, 'fish-1'); await b.flush(); // stale memory: DB guard undoes it
    expect(b.view('Ann').me?.amount).toBe(0);
    expect(Number(db.public.one(`SELECT amount FROM wev_contrib WHERE player_key = 'ann'`).amount)).toBe(1);
    expect(re.credit('fishing', 'Ann', 1, 'fish-2')).toBe(1); await re.flush();
    expect(Number(db.public.one(`SELECT amount FROM wev_contrib WHERE player_key = 'ann'`).amount)).toBe(2);
  });

  it('is announced in the changelog and the Co-op popup', () => {
    expectChangelogEntry(/weekly server events/i);
    expectChangelogOrder(/Factory goods sell/, /weekly server events/i, /Co-op mine raids/, /The Millionaire Update/);
  });

  it('event payout bump: gold 200k with silver/bronze scaled; legacy weeks keep 15k/6k/2k', () => {
    expect(EVENT_TIERS.map((x) => x.chips)).toEqual([26_667, 80_000, 200_000]);
    expect(LEGACY_EVENT_TIERS.map((x) => x.chips)).toEqual([2_000, 6_000, 15_000]);
    expect(eventTiersFor(EVENT_PAYOUT_FROM - 1)).toBe(LEGACY_EVENT_TIERS);
    // From EVENT_DAILY_FROM (== EVENT_PAYOUT_FROM) onward, daily half-payouts apply.
    expect(eventTiersFor(EVENT_PAYOUT_FROM)).toBe(DAILY_EVENT_TIERS);
    expect(EVENT_TIERS.map((x) => x.chips)).toEqual([26_667, 80_000, 200_000]); // kept for the brief weekly-era window
    const e = EVENTS.hockey; const cap = playerEventCap(e);
    // Weekly-tier amounts still used when an explicit pre-daily week index is passed below DAILY_FROM
    // but EVENT_PAYOUT_FROM itself is daily now — assert daily table + legacy below.
    expect(eventReward(DAILY_EVENTS.hockey, playerEventCap(DAILY_EVENTS.hockey), 1, 1, EVENT_DAILY_FROM)).toBe(100_000);
    expect(eventReward(DAILY_EVENTS.hockey, playerEventCap(DAILY_EVENTS.hockey), 0.5, 1, EVENT_DAILY_FROM)).toBe(50_000);
    expect(eventReward(e, cap, 1, 1, EVENT_PAYOUT_FROM - 1)).toBe(15_000);
    expect(eventReward(e, cap, 0.5, 1, EVENT_PAYOUT_FROM - 1)).toBe(7_500);
    // ratios preserved vs gold (weekly table + daily table)
    expect(80_000 / 200_000).toBeCloseTo(6_000 / 15_000, 10);
    expect(40_000 / 100_000).toBeCloseTo(6_000 / 15_000, 10);
  });


  it('daily from EVENT_DAILY_FROM: Regina midnight periods, day goals, half payouts; period 44 is daily', () => {
    expect(EVENT_DAILY_FROM).toBe(44);
    expect(DAILY_EVENT_GOALS).toEqual({ mining: 600, harvest: 850, fishing: 45, trade: 150, hockey: 3 });
    expect(WEEKLY_EVENT_GOALS).toEqual({ mining: 4_000, harvest: 6_000, fishing: 300, trade: 1_000, hockey: 20 });
    expect(DAILY_EVENT_TIERS.map((x) => x.chips)).toEqual([13_333, 40_000, 100_000]);
    expect(eventTiersFor(EVENT_DAILY_FROM)).toBe(DAILY_EVENT_TIERS);
    // Period 43 is pre-daily and also pre-EVENT_PAYOUT_FROM (44) → legacy tiers + weekly-rebalance goals
    expect(eventTiersFor(EVENT_DAILY_FROM - 1)).toBe(LEGACY_EVENT_TIERS);
    expect(eventFor(EVENT_DAILY_FROM - 1).goal).toBe(EVENTS[eventFor(EVENT_DAILY_FROM - 1).id].goal);
    expect(eventFor(EVENT_DAILY_FROM).goal).toBe(DAILY_EVENTS[eventFor(EVENT_DAILY_FROM).id].goal);
    const d0 = eventDailyEpoch();
    expect(periodIndex(d0 - 1)).toBe(EVENT_DAILY_FROM - 1);
    expect(periodIndex(d0)).toBe(EVENT_DAILY_FROM);
    expect(periodIndex(d0 + 86_400_000)).toBe(EVENT_DAILY_FROM + 1);
    expect(periodStart(EVENT_DAILY_FROM)).toBe(d0);
    expect(periodStart(EVENT_DAILY_FROM + 1) - periodStart(EVENT_DAILY_FROM)).toBe(86_400_000);
    // Regina midnight = 06:00 UTC
    expect(new Date(d0).getUTCHours()).toBe(6);
    const e = DAILY_EVENTS.hockey; const cap = playerEventCap(e);
    expect(eventReward(e, cap, 1, 1, EVENT_DAILY_FROM)).toBe(100_000);
    expect(eventReward(e, cap, 0.5, 1, EVENT_DAILY_FROM)).toBe(50_000);
  });

  it('converts period 44 Hockey Cup to daily immediately: day goal, half payouts, Regina midnight end', () => {
    const w = 44; at(w);
    expect(eventFor(w).id).toBe('hockey');
    expect(eventFor(w).goal).toBe(DAILY_EVENT_GOALS.hockey);
    expect(eventTiersFor(w)).toBe(DAILY_EVENT_TIERS);
    expect(periodStart(w + 1) - periodStart(w)).toBe(86_400_000);
    expect(new Date(periodStart(w)).getUTCHours()).toBe(6); // Regina midnight
    const cap = playerEventCap(eventFor(w));
    eventCredit('hockey', 'Ann', cap);
    expect(ev.view('Ann').goal).toBe(DAILY_EVENT_GOALS.hockey);
    // Goal already met → claim after rolling to next period pays once (daily gold table)
    at(w + 1);
    expect(periodIndex(now)).toBe(w + 1);
  });

  it('retune from EVENT_RETUNE_FROM: 5× goals and 25% lower payouts; prior daily periods keep old numbers', () => {
    expect(EVENT_RETUNE_FROM).toBe(46);
    expect(DAILY_EVENT_GOALS_RETUNE).toEqual({ mining: 3_000, harvest: 4_250, fishing: 225, trade: 750, hockey: 15 });
    expect(DAILY_EVENT_TIERS_RETUNE.map((x) => x.chips)).toEqual([10_000, 30_000, 75_000]);
    // In-progress day (period 45) and earlier daily periods keep the pre-retune table.
    expect(eventFor(EVENT_RETUNE_FROM - 1).goal).toBe(DAILY_EVENTS[eventFor(EVENT_RETUNE_FROM - 1).id].goal);
    expect(eventTiersFor(EVENT_RETUNE_FROM - 1)).toBe(DAILY_EVENT_TIERS);
    expect(eventReward(DAILY_EVENTS.hockey, playerEventCap(DAILY_EVENTS.hockey), 1, 1, EVENT_RETUNE_FROM - 1)).toBe(100_000);
    // New day uses quintupled goals and cut payouts.
    expect(eventFor(EVENT_RETUNE_FROM).goal).toBe(DAILY_EVENTS_RETUNE[eventFor(EVENT_RETUNE_FROM).id].goal);
    expect(eventTiersFor(EVENT_RETUNE_FROM)).toBe(DAILY_EVENT_TIERS_RETUNE);
    const e = DAILY_EVENTS_RETUNE.hockey; const cap = playerEventCap(e);
    expect(e.goal).toBe(15);
    expect(eventReward(e, cap, 1, 1, EVENT_RETUNE_FROM)).toBe(75_000);
    expect(eventReward(e, cap, 0.5, 1, EVENT_RETUNE_FROM)).toBe(37_500);
    // period 46 starts at the next Regina midnight after this ship (2026-11-11 00:00)
    expect(new Date(periodStart(EVENT_RETUNE_FROM)).toISOString()).toBe('2026-11-11T06:00:00.000Z');
  });


});
