import { describe, it, expect } from 'vitest';
import { getMines } from '../server/mines.js';
import { recordSink, resetSinkRoomForTest } from '../server/sink-room.js';
import { houseRoom, allHouseRooms } from '../server/house-room.js';
import { dayKey } from '../shared/mines.js';

describe('house room', () => {
  it('reports cap, sold, refunded and left; lists active players only', () => {
    resetSinkRoomForTest(); const now = Date.now(); const m = getMines();
    m.daily.set('hrtest', { day: dayKey(now), gross: 30_000, paid: 30_000 });
    recordSink('hrtest', { game: 'property_buy', amount: -5_000 }, now);
    const r = houseRoom('hrtest', now);
    expect(r.soldToday).toBe(Math.floor(30_000 * r.index));
    expect(r.refunded).toBe(5_000);
    expect(r.left).toBeGreaterThan(r.cap - r.soldToday);
    expect(houseRoom('nobody-here', now).left).toBe(houseRoom('nobody-here', now).cap);
    expect(allHouseRooms(now).some((x) => x.player === 'hrtest')).toBe(true);
    expect(allHouseRooms(now).some((x) => x.player === 'nobody-here')).toBe(false);
    m.daily.delete('hrtest'); resetSinkRoomForTest();
  });
});
