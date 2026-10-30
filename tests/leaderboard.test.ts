import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Leaderboard, getLeaderboard, resetLeaderboard } from '../server/leaderboard.js';
import { Room, resetRooms } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { clockPreset, SEATS, type Seat } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
});

function tempFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-lb-'));
  return path.join(dir, 'leaderboard.json');
}

describe('leaderboard store', () => {
  it('merges names without case and keeps the latest spelling', () => {
    const board = resetLeaderboard(tempFile());
    board.record({ winner: 'white', white: ['Ada'], black: ['Jules'] });
    board.record({ winner: 'black', white: ['ada'], black: ['JULES'] });
    const rows = board.standings();
    expect(rows.map((row) => row.name).sort()).toEqual(['JULES', 'ada']);
    board.rememberName('Ada Lovelace');
    expect(board.standings().some((row) => row.name === 'Ada Lovelace')).toBe(false);
    board.rememberName('ADa');
    expect(board.standings().find((row) => row.wins === 1 && row.losses === 1)?.name).toBe('ADa');
    expect(rows.find((row) => row.name === 'ada')).toMatchObject({
      wins: 1,
      losses: 1,
      draws: 0,
      played: 2,
      winRate: 0.5,
    });
  });

  it('gives both teammates the result and sorts by wins, then win rate', () => {
    const board = resetLeaderboard(tempFile());
    board.record({ winner: 'white', white: ['Ada', 'Sam'], black: ['Jules', 'Ren'] });
    board.record({ winner: 'white', white: ['Ada', 'Sam'], black: ['Jules', 'Ren'] });
    board.record({ winner: null, white: ['Ada', 'Sam'], black: ['Jules', 'Ren'] });
    board.record({ winner: 'black', white: ['Bea', 'Cam'], black: ['Jules', 'Ren'] });

    const rows = board.standings();
    expect(rows.map((row) => row.name)).toEqual(['Ada', 'Sam', 'Jules', 'Ren', 'Bea', 'Cam']);
    expect(rows[0]).toMatchObject({ wins: 2, losses: 0, draws: 1, played: 3 });
    expect(rows[2]).toMatchObject({ wins: 1, losses: 2, draws: 1, played: 4 });
    expect(rows[4]).toMatchObject({ wins: 0, losses: 1, draws: 0, played: 1, winRate: 0 });

    const tied = resetLeaderboard(tempFile());
    tied.record({ winner: 'white', white: ['Ann'], black: ['Bea'] });
    tied.record({ winner: 'white', white: ['Bea'], black: ['Cy'] });
    tied.record({ winner: 'black', white: ['Bea'], black: ['Cy'] });
    expect(tied.standings().map((row) => row.name)).toEqual(['Ann', 'Cy', 'Bea']);
    expect(tied.standings()[0].winRate).toBe(1);
    expect(tied.standings()[1].winRate).toBe(0.5);
  });

  it('survives a new store reading the same file', () => {
    const file = tempFile();
    const first = new Leaderboard(file);
    first.record({ winner: 'black', white: ['Ada', 'Sam'], black: ['Jules', 'Ren'] });
    const second = new Leaderboard(file);
    expect(second.standings().map((row) => [row.name, row.wins, row.losses])).toEqual([
      ['Jules', 1, 0],
      ['Ren', 1, 0],
      ['Ada', 0, 1],
      ['Sam', 0, 1],
    ]);
  });
});

describe('finished relay games', () => {
  it('records checkmate, a draw, and a resignation once each', () => {
    resetLeaderboard(tempFile());
    const room = new Room('MATE01', clockPreset('off')!);
    room.scrambleRematch = false; // these checks assume rematch keeps seats
    const names = { white1: 'Ada', black1: 'Jules', white2: 'Sam', black2: 'Ren' };
    const tokens = {} as Record<Seat, string>;
    for (const seat of SEATS) {
      tokens[seat] = room.addMember(names[seat]);
      room.connect(tokens[seat], seat);
    }
    for (const seat of SEATS) room.sit(tokens[seat], seat);

    const moves = [
      ['white1', 'f2', 'f3'],
      ['black1', 'e7', 'e5'],
      ['white2', 'g2', 'g4'],
      ['black2', 'd8', 'h4'],
    ] as const;
    for (const [seat, from, to] of moves) room.move(tokens[seat], { from, to });
    expect(room.view('white1', 1).result).toBeNull();
    expect(room.view('white1', 1).bailout?.side).toBe('white');
    room.acceptMate(tokens.white1);
    room.view('white1', 1);
    room.view('white1', 1);

    let scored = getLeaderboard().standings();
    expect(scored.find((row) => row.name === 'Jules')).toMatchObject({ wins: 1, losses: 0, played: 1 });
    expect(scored.find((row) => row.name === 'Ren')).toMatchObject({ wins: 1, losses: 0, played: 1 });
    expect(scored.find((row) => row.name === 'Ada')).toMatchObject({ wins: 0, losses: 1, played: 1 });
    expect(scored.find((row) => row.name === 'Sam')).toMatchObject({ wins: 0, losses: 1, played: 1 });

    for (const seat of SEATS) room.voteRematch(tokens[seat], 2);
    room.view('white1', 2);
    expect(getLeaderboard().standings().every((row) => row.played === 1)).toBe(true);

    room.offerDraw(tokens.white1, 3);
    room.answerDraw(tokens.black1, true, 3);
    room.view('white1', 3);
    expect(getLeaderboard().standings().every((row) => row.draws === 1 && row.played === 2)).toBe(true);

    for (const seat of SEATS) room.voteRematch(tokens[seat], 4);
    room.resign(tokens.white2);
    room.view('black1', 4);
    scored = getLeaderboard().standings();
    expect(scored.find((row) => row.name === 'Jules')).toMatchObject({ wins: 2, losses: 0, draws: 1, played: 3 });
    expect(scored.find((row) => row.name === 'Ada')).toMatchObject({ wins: 0, losses: 2, draws: 1, played: 3 });
  });
});
