import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RelayGame } from '../server/engine.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { Room, liveRooms, openRooms, resetRooms, setupOrThrow } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { clockPreset, modeLabel, seatForSetup, seatLabel, seatsFor, teamSizes, type Seat, type TableSetup } from '../shared/types.js';

const T33: TableSetup = { mode: '3v3', pairSide: null };
const T32W: TableSetup = { mode: '3v2', pairSide: 'white' };
const T32B: TableSetup = { mode: '3v2', pairSide: 'black' };

afterEach(() => {
  stopMaintenance();
  resetRooms();
});

function roomFor(setup: TableSetup, clock = 'off', code = 'THREE1') {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-3-')), 'leaderboard.json'));
  return new Room(code, clockPreset(clock)!, setup);
}

function seatAll(room: Room, setup: TableSetup) {
  const tokens = {} as Partial<Record<Seat, string>>;
  for (const seat of seatsFor(setup)) {
    const token = room.addMember(`P ${seat}`);
    room.connect(token, `sock-${seat}`);
    room.sit(token, seat);
    tokens[seat] = token;
  }
  return tokens as Record<Seat, string>;
}

describe('3v3 and 3v2 setup', () => {
  it('parses the new modes', () => {
    expect(setupOrThrow('3v3', 'white')).toEqual(T33);
    expect(setupOrThrow('3v2', 'black')).toEqual(T32B);
    expect(setupOrThrow('3v2', undefined)).toEqual(T32W);
    expect(teamSizes(T32B)).toEqual({ white: 2, black: 3 });
    expect(modeLabel(T32W)).toBe('3v2 · three on White');
  });

  it('rotates 3v3 as W1 B1 W2 B2 W3 B3', () => {
    expect(seatsFor(T33)).toEqual(['white1', 'black1', 'white2', 'black2', 'white3', 'black3']);
    expect(Array.from({ length: 8 }, (_, p) => seatForSetup(p, T33))).toEqual([
      'white1', 'black1', 'white2', 'black2', 'white3', 'black3', 'white1', 'black1',
    ]);
    expect(seatLabel('white3', seatsFor(T33))).toBe('White 3');
  });

  it('cycles each 3v2 team on its own', () => {
    expect(seatsFor(T32W)).toEqual(['white1', 'white2', 'white3', 'black1', 'black2']);
    const w = Array.from({ length: 12 }, (_, p) => seatForSetup(p, T32W));
    expect(w.filter((_, p) => p % 2 === 0)).toEqual(['white1', 'white2', 'white3', 'white1', 'white2', 'white3']);
    expect(w.filter((_, p) => p % 2 === 1)).toEqual(['black1', 'black2', 'black1', 'black2', 'black1', 'black2']);
    const b = Array.from({ length: 6 }, (_, p) => seatForSetup(p, T32B));
    expect(b).toEqual(['white1', 'black1', 'white2', 'black2', 'white1', 'black3']);
  });
});

describe('filling 3-player tables', () => {
  it('starts 3v3 only when all six seats are filled and plays in order', () => {
    const room = roomFor(T33, '5+0');
    const tokens: Record<string, string> = {};
    const seats = seatsFor(T33);
    for (const [i, seat] of seats.entries()) {
      const t = room.addMember(`P${i}`);
      room.connect(t, `s${i}`);
      tokens[seat] = t;
      expect(room.openSeats()).toHaveLength(seats.length - i);
      room.sit(t, seat);
      expect(room.game.status).toBe(i === seats.length - 1 ? 'playing' : 'lobby');
    }
    expect(room.openSeats()).toEqual([]);
    const moves = [
      { from: 'e2', to: 'e4' }, { from: 'e7', to: 'e5' }, { from: 'g1', to: 'f3' },
      { from: 'b8', to: 'c6' }, { from: 'f1', to: 'c4' }, { from: 'g8', to: 'f6' }, { from: 'd2', to: 'd3' },
    ];
    for (const move of moves) {
      const seat = room.game.seatToMove()!;
      const wrong = seats.find((s) => s !== seat)!;
      expect(() => room.move(tokens[wrong], move)).toThrow();
      room.move(tokens[seat], move);
    }
    expect(room.game.history().map((m) => m.seat)).toEqual([...seats, 'white1']);
    expect(room.view('s0', Date.now()).clock?.active).toBe('black');
  });

  it('rejects seats outside 3v2 and lists open ones', () => {
    const room = roomFor(T32W);
    const t = room.addMember('Ada');
    room.connect(t, 'a');
    expect(() => room.sit(t, 'black3')).toThrow(/not in this game/i);
    room.sit(t, 'white3');
    expect(room.openSeats()).toEqual(['white1', 'white2', 'black1', 'black2']);
  });

  it('rematches a 3v3 only when all six vote', () => {
    const game = new RelayGame(null, T33);
    game.start(0);
    game.resign('white2');
    const seats = seatsFor(T33);
    for (const seat of seats.slice(0, 5)) game.voteRematch(seat, 1);
    expect(game.status).toBe('ended');
    game.voteRematch(seats[5], 1);
    expect(game.status).toBe('playing');
  });
});

describe('spectators', () => {
  it('join and leave without touching the game, and see no legal moves', () => {
    const room = roomFor(T33, '5+0');
    const tokens = seatAll(room, T33);
    room.addSpectator('watcher');
    room.addSpectator('watcher2');
    expect(room.watching()).toBe(2);
    const seen = room.view('watcher', Date.now());
    expect(seen.spectating).toBe(true);
    expect(seen.yourSeat).toBeNull();
    expect(seen.legalMoves).toEqual([]);
    expect(seen.hints).toEqual([]);
    expect(seen.watching).toBe(2);
    const player = room.view('sock-white1', Date.now());
    expect(player.spectating).toBe(false);
    expect(player.legalMoves.length).toBeGreaterThan(0);
    room.move(tokens.white1, { from: 'e2', to: 'e4' });
    room.disconnect('watcher');
    room.removeSpectator('watcher2');
    expect(room.watching()).toBe(0);
    expect(room.game.status).toBe('playing');
    expect(room.game.ply()).toBe(1);
  });

  it('a seated socket cannot also spectate', () => {
    const room = roomFor(T33);
    seatAll(room, T33);
    expect(() => room.addSpectator('sock-white1')).toThrow();
  });

  it('summaries cover waiting and running tables', () => {
    const playing = roomFor(T33, '5+0', 'PLAY01');
    seatAll(playing, T33);
    playing.addSpectator('w');
    const s = playing.summary();
    expect(s).toMatchObject({ code: 'PLAY01', mode: '3v3', status: 'playing', filled: 6, total: 6, openSeats: 0, watching: 1 });
    expect(s.players).toHaveLength(6);
    expect(s.clock?.whiteMs).toBeGreaterThan(299_900); // wall-clock: a ms can tick under suite load
    expect(s.clock?.whiteMs).toBeLessThanOrEqual(300_000);
    const waiting = roomFor(T32W, 'off', 'WAIT01');
    const t = waiting.addMember('Ada');
    waiting.connect(t, 'a');
    expect(waiting.summary()).toMatchObject({ status: 'lobby', filled: 0, total: 5, openSeats: 5, clock: null });
    expect(liveRooms()).toEqual([]);
    expect(openRooms()).toEqual([]);
  });
});
