import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { createRoom, getRoom, listRooms, resetRooms, Room, EMPTY_ROOM_MS } from '../server/rooms.js';
import { resetCheckersLeaderboard, resetLeaderboard } from '../server/leaderboard.js';
import { restoreRoom, snapshotRoom } from '../server/room-snapshot.js';
import { MemoryRoomStore, PgRoomStore, RoomPersistence } from '../server/room-store.js';
import { clockPreset } from '../shared/types.js';

const ten = clockPreset('10+0')!;
const viaJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const stable = (room: Room, now: number) => {
  const v = room.view('nobody', now) as any;
  return { fen: v.fen, ply: v.ply, moves: v.moves, seats: Object.fromEntries(Object.entries(v.seats).map(([k, s]: any) => [k, s && { name: s.name, bot: !!s.bot }])), status: v.status, result: v.result, seatToMove: v.seatToMove, legal: room.game.legalMoves().length, mode: v.mode, gameType: v.gameType, preset: v.clockPreset, scramble: v.scrambleRematch };
};

function setup(gameType: 'chess' | 'checkers', t0: number) {
  const room = new Room('PERS' + gameType[1]!.toUpperCase() + 'X', ten, { mode: '1v1', pairSide: null }, gameType);
  const human = room.addMember('QA-Human');
  room.connect(human, 's1', t0);
  room.sit(human, 'white1', t0);
  room.addBot(human, 'black1', t0);
  return { room, human };
}

describe('table snapshots', () => {
  for (const gameType of ['chess', 'checkers'] as const) {
    it(`${gameType}: human + bot mid-game round-trips through JSON`, () => {
      resetLeaderboard(null); resetCheckersLeaderboard(null);
      const t0 = 1_000_000;
      const { room, human } = setup(gameType, t0);
      let now = t0;
      for (let i = 0; i < 6; i++) {
        now += 3000;
        const m = room.game.legalMoves()[0]!;
        room.move(human, { from: m.from, to: m.to, ...(m.path && m.path.length > 1 ? { via: m.path.slice(0, -1) } : {}) }, now);
        now += 1000;
        expect(room.playBot(now, () => 0.3)).toBe(true);
      }
      const before = stable(room, now);
      const clockBefore = room.game.clockView(now)!;
      const snap = viaJson(snapshotRoom(room, now));
      // 90 s of downtime
      const back = restoreRoom(snap, now + 90_000);
      expect(stable(back, now + 90_000)).toEqual({ ...before });
      const clockAfter = back.game.clockView(now + 90_000)!;
      expect(clockAfter.whiteMs).toBe(clockBefore.whiteMs);
      expect(clockAfter.blackMs).toBe(clockBefore.blackMs);
      // human mover not connected yet: clock paused
      expect(clockAfter.running).toBe(false);
      // identity survives: same token gets the same seat back
      expect(back.has(human)).toBe(true);
      back.connect(human, 'new-socket', now + 91_000);
      expect(back.view('new-socket', now + 91_000).yourSeat).toBe('white1');
      expect(back.game.clockView(now + 91_000)!.running).toBe(true);
      // game continues: human moves, bot answers
      const m = back.game.legalMoves()[0]!;
      back.move(human, { from: m.from, to: m.to, ...(m.path && m.path.length > 1 ? { via: m.path.slice(0, -1) } : {}) }, now + 92_000);
      expect(back.botDuty()?.kind).toBe('move');
      expect(back.playBot(now + 93_000, () => 0.5)).toBe(true);
      expect(back.game.ply()).toBe(room.game.ply() + 2);
    });
  }

  it('lobby with seats, finished game and rematch votes survive', () => {
    const t0 = 5_000;
    const room = new Room('PERSLB', ten, { mode: '2v2', pairSide: null }, 'chess');
    const a = room.addMember('QA-A'); room.sit(a, 'white1', t0); room.addBot(a, 'black2', t0);
    const back = restoreRoom(viaJson(snapshotRoom(room, t0)), t0 + 10);
    expect(back.game.status).toBe('lobby');
    expect(back.openSeats().sort()).toEqual(room.openSeats().sort());
    const b = room.addMember('QA-B'); room.sit(b, 'white2', t0); room.sit(room.addMember('QA-C'), 'black1', t0);
    expect(room.game.status).toBe('playing');
    room.resign(a, t0 + 100);
    room.view('x', t0 + 100);
    const done = restoreRoom(viaJson(snapshotRoom(room, t0 + 200)), t0 + 300);
    expect(done.game.status).toBe('ended');
    expect(done.game.result?.winner).toBe('black');
    done.voteRematch(a, t0 + 400); done.voteRematch(b, t0 + 400);
    expect(done.game.rematchVotes.size).toBeGreaterThan(0);
  });
});

describe('room persistence store', () => {
  it('saves only changes, restores into the live map, deletes rows for gone tables', async () => {
    resetRooms();
    const store = new MemoryRoomStore();
    const p = new RoomPersistence(store);
    const room = createRoom(ten, { mode: '1v1', pairSide: null }, 'checkers');
    const h = room.addMember('QA-Kim'); room.sit(h, 'white1'); room.addBot(h, 'black1');
    await p.flush();
    expect(store.rows.has(room.code)).toBe(true);
    let writes = 0; const orig = store.save.bind(store); store.save = async (c, d) => { writes++; return orig(c, d); };
    await p.flush();
    expect(writes).toBe(0);
    resetRooms();
    const p2 = new RoomPersistence(store);
    expect(await p2.sweep()).toEqual([]);
    expect(getRoom(room.code)).toBeUndefined(); // lazy: nothing loaded until a player returns
    expect(await p2.loadOne(room.code)).toBe(true);
    writes = 0;
    await p2.flush();
    expect(writes).toBe(0); // a freshly loaded table is not written back until it changes
    expect(getRoom(room.code)?.gameType).toBe('checkers');
    expect(getRoom(room.code)?.has(h)).toBe(true);
    resetRooms();
    await p.flush();
    expect(store.rows.size).toBe(0);
  });

  it('drops snapshots that were already idle past the expiry rules', async () => {
    resetRooms();
    const store = new MemoryRoomStore();
    const room = createRoom(ten);
    room.addMember('QA-Old');
    room.lastActivity = Date.now() - EMPTY_ROOM_MS - 1000;
    await new RoomPersistence(store).flush();
    resetRooms();
    expect(await new RoomPersistence(store).loadOne(room.code)).toBe(false);
    expect(store.rows.size).toBe(0);
    await new RoomPersistence(store).flush();
    const r2 = createRoom(ten); r2.addMember('QA-Old2');
    await new RoomPersistence(store).flush();
    resetRooms();
    expect(await new RoomPersistence(store).sweep(Date.now() + EMPTY_ROOM_MS + 1000)).toEqual([r2.code]);
    expect(listRooms()).toEqual([]);
  });

  it('works against postgres (pg-mem)', async () => {
    resetRooms();
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const store = new PgRoomStore(new Pool());
    await store.init();
    const room = createRoom(ten, { mode: '1v1', pairSide: null }, 'chess');
    const h = room.addMember('QA-Pg'); room.sit(h, 'white1'); room.addBot(h, 'black1');
    room.move(h, { from: 'e2', to: 'e4' });
    await new RoomPersistence(store).flush();
    resetRooms();
    expect(await new RoomPersistence(store).loadOne(room.code)).toBe(true);
    expect(getRoom(room.code)!.game.history().length).toBe(1);
  });
});
