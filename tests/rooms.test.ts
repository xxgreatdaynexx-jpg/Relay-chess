import { afterEach, describe, expect, it } from 'vitest';
import {
  createRoom,
  EMPTY_ROOM_MS,
  getRoom,
  HARD_ROOM_MS,
  pruneRooms,
  resetRooms,
  Room,
} from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { clockPreset, SEATS, type Seat } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
});

function table(clock: string, code = 'TABLE1') {
  const preset = clockPreset(clock);
  if (!preset) throw new Error('missing preset');
  return new Room(code, preset);
}

function fill(room: Room, now = 1_000) {
  const names = {
    white1: 'Ada',
    black1: 'Jules',
    white2: 'Sam',
    black2: 'Ren',
  };
  const tokens = {} as Record<Seat, string>;
  for (const seat of SEATS) {
    tokens[seat] = room.addMember(names[seat]);
    room.connect(tokens[seat], seat, now);
  }
  for (const seat of SEATS) room.sit(tokens[seat], seat, now);
  return tokens;
}

describe('rooms', () => {
  it('starts only when all four seats are filled', () => {
    const room = table('off');
    const tokens = {} as Record<Seat, string>;
    for (const seat of SEATS) tokens[seat] = room.addMember(seat);
    room.sit(tokens.white1, 'white1');
    room.sit(tokens.black1, 'black1');
    room.sit(tokens.white2, 'white2');
    expect(room.game.status).toBe('lobby');
    room.sit(tokens.black2, 'black2');
    expect(room.game.status).toBe('playing');
    expect(room.game.seatToMove()).toBe('white1');
  });

  it('lets a player switch seats in the lobby and locks them after the start', () => {
    const room = table('off');
    const ada = room.addMember('Ada');
    room.sit(ada, 'white1');
    room.sit(ada, 'black2');
    const view = room.view('missing', 0);
    expect(view.seats.white1).toBeNull();
    expect(view.seats.black2?.name).toBe('Ada');
    room.stand(ada);
    expect(room.view('missing', 0).seats.black2).toBeNull();

    const tokens = fill(room);
    expect(() => room.sit(tokens.white1, 'black1')).toThrow(/lock/i);
    expect(() => room.stand(tokens.white1)).toThrow(/stand/i);
    expect(() => room.sit(tokens.black1, 'white1')).toThrow(/taken|lock/i);
  });

  it('keeps a disconnected player’s seat and pauses only their turn', () => {
    const now = 5_000;
    const room = table('10+0', 'CLOCK1');
    const tokens = fill(room, now);
    expect(room.game.isClockRunning()).toBe(true);

    room.disconnect('black1', now + 500);
    expect(room.view('white1', now + 500).seats.black1).toMatchObject({ name: 'Jules', connected: false });
    expect(room.game.isClockRunning()).toBe(true);

    room.disconnect('white1', now + 1_000);
    expect(room.game.isClockRunning()).toBe(false);
    const paused = room.game.clockView(now + 1_000)!.whiteMs;
    room.game.tick(now + 30_000);
    expect(room.game.clockView(now + 30_000)!.whiteMs).toBe(paused);

    room.connect(tokens.white1, 'white1-again', now + 30_000);
    expect(room.view('white1-again', now + 30_000).yourSeat).toBe('white1');
    expect(room.game.isClockRunning()).toBe(true);
    expect(() => room.move(tokens.black1, { from: 'e7', to: 'e5' }, now + 30_000)).toThrow(/turn/i);
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, now + 31_000);
    expect(room.game.seatToMove()).toBe('black1');
  });

  it('drops abandoned tables and keeps a connected one', () => {
    const room = createRoom(clockPreset('off')!);
    room.lastActivity = Date.now() - EMPTY_ROOM_MS - 5_000;
    expect(pruneRooms()).toContain(room.code);
    expect(getRoom(room.code)).toBeUndefined();

    const live = createRoom(clockPreset('off')!);
    const token = live.addMember('Ada');
    live.connect(token, 'sock');
    live.lastActivity = Date.now() - EMPTY_ROOM_MS - 5_000;
    expect(pruneRooms()).not.toContain(live.code);

    live.lastActivity = Date.now() - HARD_ROOM_MS - 5_000;
    expect(pruneRooms()).toContain(live.code);
  });
});
