import { describe, it, expect, beforeEach } from 'vitest';
import { sinkLoss, SinkDay, effectiveAlready } from '../shared/sinkRoom';
import { payoutFor, HOUSE_DAILY_BASE } from '../shared/mines';
import { recordSink, sinkLostToday, resetSinkRoomForTest } from '../server/sink-room';

describe('sink room', () => {
  beforeEach(() => resetSinkRoomForTest());
  it('P2P trades, gifts, market buys and wealth tax shares free no room', () => {
    expect(sinkLoss([
      { game: 'trade', amount: -5000 }, { game: 'gift', amount: -100 }, { game: 'tip', amount: -10 }, { game: 'transfer', amount: -7 }, { game: 'p2p', amount: -3 },
      { game: 'market', amount: -900, memo: 'Bought 3 Gold Bar' }, { game: 'wealth_tax', amount: 500, memo: 'Wealth tax share' },
      { game: 'holdem', amount: -400 }, { game: 'stocks', amount: -1000 },
    ])).toBe(0);
  });
  it('counts casino NET losses, market fees, wealth tax, admin removals, cars and property tax; not other purchases, upkeep or wages', () => {
    expect(sinkLoss([{ game: 'blackjack', amount: -100 }, { game: 'blackjack', amount: 60 }])).toBe(40);
    expect(sinkLoss([{ game: 'slots', amount: -100 }, { game: 'slots', amount: 300 }])).toBe(0);
    expect(sinkLoss([{ game: 'property_buy', amount: -5000 }, { game: 'property_tax', amount: -25 }, { game: 'admin', amount: -10 }, { game: 'wealth_tax', amount: -99, memo: 'Wealth tax' }])).toBe(134);
    expect(sinkLoss([{ game: 'resort_ticket', amount: -100 }, { game: 'race_entry', amount: -20 }, { game: 'mayor_filing', amount: -5 }, { game: 'car_mod', amount: -1 }])).toBe(126);
    for (const g of ['property_buy', 'farm_seed', 'farm_upgrade', 'mine_tool', 'mines', 'grocery', 'employ_wage', 'employ_hire']) expect(sinkLoss([{ game: g, amount: -2000 }]), g).toBe(0);
    expect(sinkLoss([{ game: 'market', amount: 950, memo: 'Sold 1 Gold Bar (50 fee)' }])).toBe(50);
  });
  it('running accumulator matches the batch rule and resets each day', () => {
    const d = new SinkDay(); d.add('d1', { game: 'roulette', amount: -100 }); d.add('d1', { game: 'roulette', amount: 30 }); d.add('d1', { game: 'car_buy', amount: -10 });
    expect(d.lost('d1')).toBe(80); // car purchases still free room expect(d.lost('d2')).toBe(0); d.add('d2', { game: 'admin', amount: -1 }); d.add('d2', { game: 'grocery', amount: -5 }); expect(d.lost('d2')).toBe(1);
  });
  it('lost chips widen the cap, at most cap + lost, never beyond today', () => {
    const t = Date.UTC(2026, 10, 3, 12);
    recordSink('Bob', { game: 'slots', amount: -10_000, key: 'k1' }, t);
    recordSink('Bob', { game: 'slots', amount: -10_000, key: 'k1' }, t); // same ledger row twice: counted once
    recordSink('Bob', { game: 'trade', amount: -50_000, key: 'k2' }, t);
    expect(sinkLostToday('bob', t)).toBe(10_000);
    expect(sinkLostToday('bob', t + 86_400_000)).toBe(0);
    const eff = effectiveAlready(HOUSE_DAILY_BASE, 10_000, 1);
    expect(payoutFor(50_000, eff)).toBe(10_000);
    expect(payoutFor(10 ** 9, effectiveAlready(0, 10_000, 1))).toBe(HOUSE_DAILY_BASE + 10_000);
    expect(payoutFor(5_000, effectiveAlready(HOUSE_DAILY_BASE, 10_500, 1.05))).toBe(5_000);
  });
});
