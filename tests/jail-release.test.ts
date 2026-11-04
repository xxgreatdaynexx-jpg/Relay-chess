import { describe, it, expect, beforeEach } from 'vitest';
import { Jail } from '../server/jail';
import { JAIL_PHRASE } from '../shared/jail';
import { HOUSE_SELL_BLOCKED, MARKET_BLOCKED } from '../server/house-cap-index';
import { recordSink, sinkLostToday, resetSinkRoomForTest, isPenaltyRow } from '../server/sink-room';

const GANG = ['jay', 'conner', 'carter2'];

describe('release restores everything (Dayne, Nov 3 2026)', () => {
  it('no per-player block besides jail remains on the exploit gang', () => {
    for (const k of GANG) { expect(HOUSE_SELL_BLOCKED.has(k)).toBe(false); expect(MARKET_BLOCKED.has(k)).toBe(false); }
  });
  it('timer, unjail and finished lines all fully release', async () => {
    const j = new Jail(null); const t0 = 1_000_000;
    await j.jail('Jay', 1, 'x', t0, 3);
    expect(j.isJailed('jay', t0)).toBe(true);
    expect(j.isJailed('jay', t0 + 3_600_001)).toBe(false);
    await j.jail('Conner', null, 'x', t0, 3);
    expect(await j.release('Conner', 'admin')).toBe(true);
    expect(j.isJailed('conner', t0)).toBe(false);
    await j.jail('carter2', null, 'x', t0, 2);
    await j.apologize('carter2', JAIL_PHRASE, t0);
    const r = await j.apologize('carter2', JAIL_PHRASE, t0 + 1000);
    expect(r.released).toBe(true); expect(j.isJailed('carter2', t0 + 1000)).toBe(false);
  });
});

describe('admin clawbacks never free house-sell room', () => {
  beforeEach(() => resetSinkRoomForTest());
  it('ignores penalty debits and gang admin debits, keeps real sinks', () => {
    const now = Date.UTC(2026, 10, 4, 3);
    expect(isPenaltyRow({ game: 'admin', amount: -5, memo: 'Stock exploit clawback part 1' })).toBe(true);
    recordSink('Jay', { game: 'admin', amount: -10_000, memo: 'Stock exploit clawback part 1', key: 'a1' }, now);
    recordSink('Conner', { game: 'admin', amount: -7_000, memo: 'removed', key: 'a2' }, now);
    expect(sinkLostToday('jay', now)).toBe(0); expect(sinkLostToday('conner', now)).toBe(0);
    recordSink('dayne', { game: 'admin', amount: -500, memo: 'fee', key: 'a3' }, now);
    recordSink('Jay', { game: 'car_buy', amount: -300, key: 'a4' }, now);
    expect(sinkLostToday('dayne', now)).toBe(500); expect(sinkLostToday('jay', now)).toBe(300);
  });
});
