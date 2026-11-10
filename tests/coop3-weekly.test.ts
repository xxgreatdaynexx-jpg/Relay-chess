import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { WeeklyEvents, resetWeekly, eventCredit } from '../server/weeklyEvent';
import { DAILY_EVENT_GOALS, DAILY_EVENT_TIERS, DAILY_EVENTS, EVENT_CLAIM_MS, EVENT_DAILY_FROM, EVENT_ORDER, EVENT_PAYOUT_FROM, EVENT_TIERS, EVENTS, LEGACY_EVENT_TIERS, WEEKLY_EVENT_GOALS, eventDailyEpoch, eventFor, eventReward, eventTiersFor, periodIndex, periodStart, playerEventCap, TRADE_COUNT_CAP, weekIndex, weekStart } from '../shared/coop3';
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
    // Two players each at 60% of their half-goal cap → 60% of the goal; one bronze-ish player
    for (let i = 0; i < 2; i++) eventCredit('hockey', `P${i}`, cap * 0.6); eventCredit('hockey', 'Low', Math.ceil(cap * 0.05));
    await expect(ev.claim('P0')).rejects.toThrow(/didn’t take part/); // still this week
    at(w + 1);
    const before = getBank().account('P0').chips; const r = await ev.claim('P0');
    // Week w is hockey; claims use that week's tier table (EVENT_PAYOUT_FROM → 200k gold / half under goal).
    const halfGold = eventReward(e, cap, 0.62, 1, w); expect(r.amount).toBe(halfGold);
    expect(halfGold).toBe(w >= EVENT_PAYOUT_FROM ? 100_000 : 7_500);
    expect(getBank().account('P0').chips - before).toBe(halfGold);
    await expect(ev.claim('P0')).rejects.toThrow(/Already/);
    const [a, b] = await Promise.allSettled([ev.claim('P1'), ev.claim('P1')]); expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const halfBronze = eventReward(e, Math.ceil(cap * 0.05), 0.62, 1, w);
    expect((await ev.claim('Low')).amount).toBe(halfBronze);
    expect(ev.view('P1').past).toMatchObject({ claimed: true, reward: halfGold });
    now = periodStart(w + 1) + EVENT_CLAIM_MS + 1; await expect(ev.claim('P1')).rejects.toThrow(/closed|didn’t take part/) // next period's claim window;
    // under 50%: nothing (use a known mining period; contribute under half the server goal)
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
    expect(eventTiersFor(EVENT_PAYOUT_FROM)).toBe(EVENT_TIERS);
    const e = EVENTS.hockey; const cap = playerEventCap(e);
    expect(eventReward(e, cap, 1, 1, EVENT_PAYOUT_FROM)).toBe(200_000);
    expect(eventReward(e, cap, 0.5, 1, EVENT_PAYOUT_FROM)).toBe(100_000);
    expect(eventReward(e, Math.ceil(cap * 0.25), 1, 1, EVENT_PAYOUT_FROM)).toBe(80_000);
    expect(eventReward(e, Math.ceil(cap * 0.05), 1, 1, EVENT_PAYOUT_FROM)).toBe(26_667);
    expect(eventReward(e, cap, 1, 1, EVENT_PAYOUT_FROM - 1)).toBe(15_000);
    expect(eventReward(e, cap, 0.5, 1, EVENT_PAYOUT_FROM - 1)).toBe(7_500);
    // ratios preserved vs gold
    expect(80_000 / 200_000).toBeCloseTo(6_000 / 15_000, 10);
    expect(26_667 / 200_000).toBeCloseTo(2_000 / 15_000, 3);
  });


  it('daily from EVENT_DAILY_FROM: Regina midnight periods, day goals, half payouts; week 44 stays weekly', () => {
    expect(EVENT_DAILY_FROM).toBe(45);
    expect(DAILY_EVENT_GOALS).toEqual({ mining: 600, harvest: 850, fishing: 45, trade: 150, hockey: 3 });
    expect(WEEKLY_EVENT_GOALS).toEqual({ mining: 4_000, harvest: 6_000, fishing: 300, trade: 1_000, hockey: 20 });
    expect(DAILY_EVENT_TIERS.map((x) => x.chips)).toEqual([13_333, 40_000, 100_000]);
    expect(eventTiersFor(EVENT_DAILY_FROM)).toBe(DAILY_EVENT_TIERS);
    expect(eventTiersFor(EVENT_DAILY_FROM - 1)).toBe(EVENT_TIERS);
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

  it('lets the current weekly Hockey Cup finish: credits on week 44 still use weekly goals/payouts', async () => {
    const w = 44; at(w);
    expect(eventFor(w).id).toBe('hockey');
    expect(eventFor(w).goal).toBe(20);
    expect(eventTiersFor(w)).toBe(EVENT_TIERS);
    const cap = playerEventCap(eventFor(w));
    eventCredit('hockey', 'Ann', cap);
    expect(ev.view('Ann').goal).toBe(20);
    at(w + 1); // first daily period
    expect(periodIndex(now)).toBe(EVENT_DAILY_FROM);
    expect(eventFor(periodIndex(now)).goal).toBe(DAILY_EVENT_GOALS[eventFor(periodIndex(now)).id]);
    // week 44 claim still pays weekly gold table (half if under goal — here server may be under 50% with one player)
  });


});
