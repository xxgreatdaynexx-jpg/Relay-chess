import { describe, expect, it } from 'vitest';
import { NO_SHOW_MS, Tournament, type MatchRoomStatus, type MatchRooms } from '../server/tournament.js';

class FakeRooms implements MatchRooms {
  n = 0;
  made: { code: string; white: string; black: string }[] = [];
  st = new Map<string, MatchRoomStatus>();
  create(_clock: string, white: string, black: string): string {
    const code = `R${(this.n += 1)}`;
    this.made.push({ code, white, black });
    this.st.set(code, { started: false, ended: false, winner: null, present: { white: false, black: false }, usedMs: { white: 0, black: 0 } });
    return code;
  }
  status(code: string) {
    return this.st.get(code) ?? null;
  }
  finish(code: string, patch: Partial<MatchRoomStatus>) {
    this.st.set(code, { ...this.st.get(code)!, started: true, ended: true, ...patch });
  }
}
const noShuffle = () => 0.999999;
function make(size: 4 | 8, names: string[]) {
  const t = new Tournament('TEST', names[0]!, 'none', size, 0);
  names.slice(1).forEach((n) => t.join(n));
  return t;
}

describe('tournament bracket', () => {
  it('plays a full 4-player bracket to a champion', () => {
    const rooms = new FakeRooms();
    const t = make(4, ['A', 'B', 'C', 'D']);
    t.start(rooms, 0, noShuffle);
    expect(rooms.made).toHaveLength(2);
    for (const m of rooms.made.slice()) rooms.finish(m.code, { winner: 'white' });
    expect(t.sync(rooms, 1000)).toBe(true);
    expect(rooms.made).toHaveLength(3);
    const final = rooms.made[2]!;
    rooms.finish(final.code, { winner: 'black' });
    t.sync(rooms, 2000);
    expect(t.status).toBe('done');
    expect(t.champion).toBe(final.black);
    expect(t.view().rounds[1]![0]!.how).toBe('win');
  });

  it('gives byes to distinct matches and advances them', () => {
    const rooms = new FakeRooms();
    const t = make(8, ['A', 'B', 'C', 'D', 'E']);
    t.start(rooms, 0, noShuffle);
    const r1 = t.view().rounds[0]!;
    expect(r1.filter((m) => m.how === 'bye')).toHaveLength(3);
    expect(r1.every((m) => m.white)).toBe(true);
    expect(rooms.made).toHaveLength(2); // the real match + the two bye winners meeting in round 2
    rooms.finish(rooms.made[0]!.code, { winner: 'white' });
    t.sync(rooms, 10);
    expect(rooms.made).toHaveLength(3);
  });

  it('two entrants in an 8 bracket meet once byes clear, and the winner is champion', () => {
    const rooms = new FakeRooms();
    const t = make(8, ['A', 'B']);
    t.start(rooms, 0, noShuffle);
    expect(rooms.made).toHaveLength(1);
    expect(t.view().rounds[1]![0]!.room).toBe(rooms.made[0]!.code);
    rooms.finish(rooms.made[0]!.code, { winner: 'white' });
    t.sync(rooms, 1);
    expect(t.champion).toBe(rooms.made[0]!.white);
  });

  it('forfeits no-shows after two minutes, favouring whoever showed up', () => {
    const rooms = new FakeRooms();
    const t = make(4, ['A', 'B', 'C', 'D']);
    t.start(rooms, 0, noShuffle);
    const [m1] = rooms.made;
    rooms.st.get(m1!.code)!.present.black = true;
    expect(t.sync(rooms, NO_SHOW_MS - 1)).toBe(false);
    t.sync(rooms, NO_SHOW_MS);
    const v = t.view().rounds[0]!;
    expect(v[0]).toMatchObject({ how: 'forfeit', winner: m1!.black });
    expect(v[1]).toMatchObject({ how: 'forfeit', winner: rooms.made[1]!.white });
  });

  it('lets only the host forfeit a player', () => {
    const rooms = new FakeRooms();
    const t = make(4, ['A', 'B', 'C', 'D']);
    t.start(rooms, 0, noShuffle);
    const m = rooms.made[0]!;
    expect(() => t.forfeit('nope', m.white, rooms)).toThrow();
    t.forfeit(t.hostKey, m.white, rooms, 5);
    expect(t.view().rounds[0]![0]).toMatchObject({ how: 'forfeit', winner: m.black });
  });

  it('breaks draws by less thinking time used', () => {
    const rooms = new FakeRooms();
    const t = make(4, ['A', 'B', 'C', 'D']);
    t.start(rooms, 0, noShuffle);
    const [a, b] = rooms.made;
    rooms.finish(a!.code, { winner: null, usedMs: { white: 90_000, black: 40_000 } });
    rooms.finish(b!.code, { winner: null, usedMs: { white: 5000, black: 5000 } });
    t.sync(rooms, 1);
    const v = t.view().rounds[0]!;
    expect(v[0]).toMatchObject({ how: 'draw-time', winner: a!.black });
    expect(v[1]).toMatchObject({ how: 'draw-time', winner: b!.white });
  });

  it('rejects joining after start and duplicate names', () => {
    const t = make(4, ['A', 'B']);
    t.join('a');
    expect(t.entrants).toEqual(['A', 'B']);
    t.start(new FakeRooms(), 0, noShuffle);
    expect(() => t.join('Z')).toThrow();
    expect(t.view('B').yourMatch?.room).toBeTruthy();
  });
});

import { matchRooms } from '../server/sockets.js';
import { getRoom, openRooms, resetRooms } from '../server/rooms.js';

describe('tournament match rooms', () => {
  it('reserve seats by name, hide from Quick Join, and block rematch', () => {
    resetRooms();
    const code = matchRooms.create('off', 'Ann', 'Bo');
    const room = getRoom(code)!;
    const intruder = room.addMember('Zed');
    expect(() => room.sit(intruder, 'white1')).toThrow(/reserved/);
    const ann = room.addMember('ann');
    room.connect(ann, 's1');
    room.sit(ann, 'white1');
    expect(openRooms()).toHaveLength(0);
    const bo = room.addMember('Bo');
    room.sit(bo, 'black1');
    expect(matchRooms.status(code)).toMatchObject({ started: true, ended: false });
    room.resign(bo);
    expect(matchRooms.status(code)).toMatchObject({ ended: true, winner: 'white' });
    expect(() => room.voteRematch(ann)).toThrow(/rematch/);
    resetRooms();
  });
});
