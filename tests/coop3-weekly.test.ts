import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { WeeklyEvents, resetWeekly, eventCredit } from '../server/weeklyEvent';
import { EVENTS, EVENT_CLAIM_MS, EVENT_ORDER, eventFor, eventReward, playerEventCap, TRADE_COUNT_CAP, weekIndex, weekStart } from '../shared/coop3';
import { expectChangelogEntry, expectChangelogOrder } from './helpers/changelog';

const W = weekIndex(Date.parse('2026-11-04T18:00:00Z')); // a mining-or-whatever week; tests pick weeks by kind
const weekOf = (kind: string) => { for (let w = W; ; w++) if (eventFor(w).id === kind) return w; };
let now = 0; let ev: WeeklyEvents;
const at = (w: number, off = 3_600_000) => { now = weekStart(w) + off; };

describe('weekly server events', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); ev = resetWeekly(new WeeklyEvents(null, () => now)); ev.guard.excluded = (n) => (/^(qa-|bot)/i.test(n) || n === 'Jailbird' ? 'nope' : null); });
  afterEach(() => resetWeekly());

  it('rotates through all five events, one per week, Monday 00:00 MST', () => {
    expect(new Set(EVENT_ORDER.map((_, i) => eventFor(W + i).id)).size).toBe(5);
    expect(new Date(weekStart(W)).getUTCDay()).toBe(1); expect(new Date(weekStart(W)).getUTCHours()).toBe(7);
  });

  it('only the running event counts; per-player cap; excluded accounts and duplicates ignored', () => {
    const w = weekOf('fishing'); at(w); const e = EVENTS.fishing; const cap = playerEventCap(e);
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
    const v = ev.view(null); expect(v.progress).toBe(TRADE_COUNT_CAP * 2);
  });

  it('claim: tiered, halved under goal, nothing under 50%; atomic and once only; window closes', async () => {
    const w = weekOf('hockey'); at(w); const e = EVENTS.hockey; const cap = playerEventCap(e);
    // 6 gold players → 60% of goal (half rewards); one bronze-ish player
    for (let i = 0; i < 6; i++) eventCredit('hockey', `P${i}`, cap); eventCredit('hockey', 'Low', Math.ceil(cap * 0.05));
    await expect(ev.claim('P0')).rejects.toThrow(/didn’t take part/); // still this week
    at(w + 1);
    const before = getBank().account('P0').chips; const r = await ev.claim('P0');
    expect(r.amount).toBe(eventReward(e, cap, 0.62)); expect(r.amount).toBe(7_500);
    expect(getBank().account('P0').chips - before).toBe(7_500);
    await expect(ev.claim('P0')).rejects.toThrow(/Already/);
    const [a, b] = await Promise.allSettled([ev.claim('P1'), ev.claim('P1')]); expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await ev.claim('Low')).amount).toBe(1_000);
    expect(ev.view('P2').past).toMatchObject({ claimed: false, reward: 7_500 });
    now = weekStart(w + 1) + EVENT_CLAIM_MS + 1; await expect(ev.claim('P2')).rejects.toThrow(/closed|didn’t take part/) // next week's claim is for the week after;
    // under 50%: nothing
    const w2 = weekOf('mining'); at(w2); eventCredit('mining', 'Solo', 999_999); at(w2 + 1); await expect(ev.claim('Solo')).rejects.toThrow(/50%/);
  });

  it('persists counts with a capped UPSERT and claims with a guard row (pg)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const w = weekOf('harvest'); at(w); ev = resetWeekly(new WeeklyEvents(pool as never, () => now)); ev.guard.excluded = () => null; await ev.init();
    const cap = playerEventCap(EVENTS.harvest);
    eventCredit('harvest', 'Ann', 10); eventCredit('harvest', 'Ann', cap * 2); await ev.flush();
    expect(Number(db.public.one(`SELECT amount FROM wev_contrib WHERE player_key = 'ann'`).amount)).toBe(cap);
    const re = new WeeklyEvents(pool as never, () => now); await re.init(); expect(re.view('Ann').me?.amount).toBe(cap);
  });

  it('is announced in the changelog and the Co-op popup', () => {
    expectChangelogEntry(/weekly server events/i);
    expectChangelogOrder(/Factory goods sell/, /weekly server events/i, /Co-op mine raids/, /The Millionaire Update/);
  });
});
