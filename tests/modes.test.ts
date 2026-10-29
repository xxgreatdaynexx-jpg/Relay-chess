import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { onBlunderReady, setMoveRanker, useDefaultMoveRanker, type MoveScore } from '../server/blunders.js';
import { RelayGame } from '../server/engine.js';
import { resetHintCache, setHintFinder, useDefaultHintFinder } from '../server/hints.js';
import { getLeaderboard, resetLeaderboard } from '../server/leaderboard.js';
import { Room, resetRooms, setupOrThrow } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { clockPreset, seatForSetup, seatsFor, type Seat, type TableSetup } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
  resetHintCache();
  useDefaultHintFinder();
  useDefaultMoveRanker();
  onBlunderReady(() => undefined);
});

function roomFor(setup: TableSetup, code = 'MODE01') {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-mode-')), 'leaderboard.json'));
  return new Room(code, clockPreset('off')!, setup);
}

function sit(room: Room, names: Partial<Record<Seat, string>>) {
  const tokens = {} as Partial<Record<Seat, string>>;
  for (const [seat, name] of Object.entries(names) as [Seat, string][]) {
    const token = room.addMember(name);
    tokens[seat] = token;
    room.connect(token, seat);
    room.sit(token, seat);
  }
  return tokens as Record<Seat, string>;
}

describe('mode setup', () => {
  it('defaults a missing mode to 2v2 and requires a color for 2v1', () => {
    expect(setupOrThrow(undefined, undefined)).toEqual({ mode: '2v2', pairSide: null });
    expect(setupOrThrow('1v1', 'white')).toEqual({ mode: '1v1', pairSide: null });
    expect(setupOrThrow('2v1', 'black')).toEqual({ mode: '2v1', pairSide: 'black' });
    expect(() => setupOrThrow('2v1', undefined)).toThrow(/mode/i);
    expect(() => setupOrThrow('blitz', null)).toThrow(/mode/i);
  });

  it('rotates seats for 2v2, 1v1, and both 2v1 colors', () => {
    const relay: TableSetup = { mode: '2v2', pairSide: null };
    const solo: TableSetup = { mode: '1v1', pairSide: null };
    const whitePair: TableSetup = { mode: '2v1', pairSide: 'white' };
    const blackPair: TableSetup = { mode: '2v1', pairSide: 'black' };
    expect(seatsFor(relay)).toEqual(['white1', 'black1', 'white2', 'black2']);
    expect(seatsFor(solo)).toEqual(['white1', 'black1']);
    expect(seatsFor(whitePair)).toEqual(['white1', 'white2', 'black1']);
    expect(seatsFor(blackPair)).toEqual(['white1', 'black1', 'black2']);
    expect([0, 1, 2, 3, 4].map((ply) => seatForSetup(ply, relay))).toEqual([
      'white1',
      'black1',
      'white2',
      'black2',
      'white1',
    ]);
    expect([0, 1, 2, 3].map((ply) => seatForSetup(ply, solo))).toEqual(['white1', 'black1', 'white1', 'black1']);
    expect([0, 1, 2, 3, 4, 5].map((ply) => seatForSetup(ply, whitePair))).toEqual([
      'white1',
      'black1',
      'white2',
      'black1',
      'white1',
      'black1',
    ]);
    expect([0, 1, 2, 3, 4, 5].map((ply) => seatForSetup(ply, blackPair))).toEqual([
      'white1',
      'black1',
      'white1',
      'black2',
      'white1',
      'black1',
    ]);
  });
});

describe('starting and playing each mode', () => {
  it('starts 1v1 when both sides sit and alternates those two seats', () => {
    const room = roomFor({ mode: '1v1', pairSide: null });
    const white = room.addMember('Ada');
    room.sit(white, 'white1');
    expect(room.game.status).toBe('lobby');
    expect(() => room.sit(white, 'white2')).toThrow(/not in this game/i);
    const black = room.addMember('Jules');
    room.sit(black, 'black1');
    expect(room.game.status).toBe('playing');
    expect(room.view('x', 1).mode).toBe('1v1');
    expect(room.view('x', 1).seats.white2).toBeNull();

    const game = new RelayGame(null, { mode: '1v1', pairSide: null });
    game.start(0);
    const played: Seat[] = [];
    for (const move of [
      { from: 'f2', to: 'f3' },
      { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' },
      { from: 'd8', to: 'h4' },
    ] as const) {
      const seat = game.seatToMove();
      if (!seat) throw new Error('no seat');
      played.push(seat);
      game.move(seat, move, 0);
    }
    expect(played).toEqual(['white1', 'black1', 'white1', 'black1']);
    expect(game.bailout?.side).toBe('white');
    game.acceptMate('white1');
    expect(game.result).toMatchObject({ type: 'checkmate', winner: 'black' });
    game.voteRematch('white1', 1);
    expect(game.status).toBe('ended');
    game.voteRematch('black1', 1);
    expect(game.status).toBe('playing');
    expect(game.seatToMove()).toBe('white1');
  });

  it('starts 2v1 when the pair and the solo player are seated, and the solo moves every time', () => {
    const whitePair = roomFor({ mode: '2v1', pairSide: 'white' }, 'PAIRW');
    sit(whitePair, { white1: 'Ada', black1: 'Jules' });
    expect(whitePair.game.status).toBe('lobby');
    const extra = whitePair.addMember('Sam');
    whitePair.sit(extra, 'white2');
    expect(whitePair.game.status).toBe('playing');
    expect(() => whitePair.sit(extra, 'black2')).toThrow(/lock|not in this game/i);

    const asWhite = new RelayGame(null, { mode: '2v1', pairSide: 'white' });
    asWhite.start(0);
    const whiteSeats: (Seat | null)[] = [];
    for (const move of [
      { from: 'f2', to: 'f3' },
      { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' },
      { from: 'd8', to: 'h4' },
    ] as const) {
      whiteSeats.push(asWhite.seatToMove());
      asWhite.move(asWhite.seatToMove()!, move, 0);
    }
    expect(whiteSeats).toEqual(['white1', 'black1', 'white2', 'black1']);

    const asBlack = new RelayGame(null, { mode: '2v1', pairSide: 'black' });
    asBlack.start(0);
    const blackSeats: (Seat | null)[] = [];
    for (const move of [
      { from: 'e2', to: 'e4' },
      { from: 'e7', to: 'e5' },
      { from: 'g1', to: 'f3' },
      { from: 'b8', to: 'c6' },
    ] as const) {
      blackSeats.push(asBlack.seatToMove());
      asBlack.move(asBlack.seatToMove()!, move, 0);
    }
    expect(blackSeats).toEqual(['white1', 'black1', 'white1', 'black2']);
    expect(() => asBlack.move('white2', { from: 'f1', to: 'c4' }, 0)).toThrow(/turn/i);
  });

  it('records every seated player, shows openings, hints, and blunders outside 2v2', async () => {
    setHintFinder(async () => ({ from: 'e2', to: 'e4' }));
    const room = roomFor({ mode: '1v1', pairSide: null }, 'HINT11');
    const tokens = sit(room, { white1: 'ChessGawd', black1: 'Jules' });
    expect(room.game.status).toBe('playing');
    room.view(tokens.white1 ? 'white1' : 'white1', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(room.view('white1', 1).hints).toEqual([{ from: 'e2', to: 'e4' }]);
    expect(room.view('black1', 1).hints).toEqual([]);

    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 5);
    expect(room.view('black1', 5).opening).toMatchObject({ name: "King's Pawn Game", ply: 1 });
    expect(room.view('white1', 5).opening?.name).toBe("King's Pawn Game");

    const announced: string[] = [];
    onBlunderReady((code) => announced.push(code));
    const gate: { finish: ((scores: MoveScore[]) => void) | null } = { finish: null };
    setMoveRanker(
      (_fen, ucis) =>
        new Promise((resolve) => {
          gate.finish = () => resolve(ucis.map((uci) => ({ uci, score: uci === 'e7e5' ? -400 : 30 })));
        }),
    );
    room.move(tokens.black1, { from: 'e7', to: 'e5' }, 6);
    expect(room.game.seatToMove()).toBe('white1');
    expect(room.view('white1', 6).mark).toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    const finish = gate.finish;
    if (!finish) throw new Error('search did not start');
    finish([]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(room.view('white1', 6).mark).toMatchObject({ square: 'e5', ply: 2, grade: 'blunder' });
    expect(room.view('black1', 6).mark).toMatchObject({ square: 'e5', ply: 2, grade: 'blunder' });
    expect(announced).toEqual(['HINT11']);

    room.resign(tokens.white1);
    room.view('black1', 7);
    const solo = getLeaderboard().standings();
    expect(solo.find((row) => row.name === 'Jules')).toMatchObject({ wins: 1, played: 1 });
    expect(solo.find((row) => row.name === 'ChessGawd')).toMatchObject({ losses: 1, played: 1 });
    expect(solo).toHaveLength(2);

    const trio = roomFor({ mode: '2v1', pairSide: 'black' }, 'TRIO');
    const seats = sit(trio, { white1: 'Ada', black1: 'Bea', black2: 'Cam' });
    trio.resign(seats.white1);
    trio.view('white1', 1);
    const rows = getLeaderboard().standings();
    expect(rows.find((row) => row.name === 'Ada')).toMatchObject({ losses: 1 });
    expect(rows.find((row) => row.name === 'Bea')).toMatchObject({ wins: 1 });
    expect(rows.find((row) => row.name === 'Cam')).toMatchObject({ wins: 1 });
    trio.voteRematch(seats.white1, 2);
    trio.voteRematch(seats.black1, 2);
    expect(trio.game.status).toBe('ended');
    trio.voteRematch(seats.black2, 2);
    expect(trio.game.status).toBe('playing');
    expect(trio.game.ply()).toBe(0);
    expect(trio.view('black2', 2).opening).toBeNull();
  });
});
