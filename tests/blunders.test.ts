import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginBlunderCheck,
  gradeMove,
  isBottomTwentieth,
  onBlunderReady,
  parseSearchScores,
  setMoveRanker,
  useDefaultMoveRanker,
  type MoveScore,
} from '../server/blunders.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { Room, resetRooms } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { clockPreset, SEATS, type Seat } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
  useDefaultMoveRanker();
  onBlunderReady(() => undefined);
});

function seated() {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-blunder-')), 'leaderboard.json'));
  const room = new Room('BLND01', clockPreset('off')!);
  const tokens = {} as Record<Seat, string>;
  const names = { white1: 'Ada', black1: 'Jules', white2: 'Sam', black2: 'Ren' };
  for (const seat of SEATS) {
    tokens[seat] = room.addMember(names[seat]);
    room.connect(tokens[seat], seat);
  }
  for (const seat of SEATS) room.sit(tokens[seat], seat);
  return { room, tokens };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ranking a move against the alternatives', () => {
  it('parses the deepest score for each root move, including mate', () => {
    const scores = parseSearchScores([
      'info depth 1 seldepth 1 multipv 1 score cp 10 pv e2e4',
      'info depth 2 currmove d2d4 currmovenumber 2',
      'info depth 2 multipv 1 score cp 34 pv e2e4 e7e5',
      'info depth 2 multipv 2 score mate -1 pv f2f3',
      'info depth 2 multipv 3 score mate 2 pv g2g4',
      'bestmove e2e4',
    ]);
    expect(scores).toEqual([
      { uci: 'e2e4', score: 34 },
      { uci: 'f2f3', score: -999_999 },
      { uci: 'g2g4', score: 999_998 },
    ]);
  });

  it('flags only a move in the bottom fifth, and never when fewer than five exist', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((uci, index) => ({ uci, score: index }));
    expect(isBottomTwentieth(five, 'a', 5)).toBe(true);
    expect(isBottomTwentieth(five, 'b', 5)).toBe(false);
    expect(isBottomTwentieth(five, 'a', 4)).toBe(false);

    const ten = Array.from({ length: 10 }, (_, index) => ({ uci: `m${index}`, score: index }));
    expect(isBottomTwentieth(ten, 'm1', 10)).toBe(true);
    expect(isBottomTwentieth(ten, 'm2', 10)).toBe(false);
    const tied = ten.map((row) => (row.uci === 'm0' || row.uci === 'm1' ? { ...row, score: 8 } : row));
    expect(isBottomTwentieth(tied, 'm0', 10)).toBe(false);
    expect(isBottomTwentieth(ten, 'missing', 10)).toBe(false);
  });

  it('gives one marker: brilliant, good, or blunder, and skips thin positions', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ uci: `m${index}`, score: index }));
    expect(gradeMove(ten, 'm9', 10)).toBe('brilliant');
    expect(gradeMove(ten, 'm8', 10)).toBe('good');
    expect(gradeMove(ten, 'm7', 10)).toBeNull();
    expect(gradeMove(ten, 'm1', 10)).toBe('blunder');
    expect(gradeMove(ten, 'm0', 4)).toBeNull();
    expect(gradeMove(ten, 'm9', 1)).toBeNull();
    expect(gradeMove([], 'm9', 10)).toBeNull();
    const tiedBest = ten.map((row) => (row.score >= 8 ? { ...row, score: 9 } : row));
    expect(gradeMove(tiedBest, 'm9', 10)).toBe('good');
    expect(gradeMove(ten.map((row) => ({ ...row, score: 3 })), 'm4', 10)).toBeNull();
  });

  it('does not ask the engine when there are fewer than five legal moves', () => {
    const calls: number[] = [];
    setMoveRanker(async (_fen, ucis) => {
      calls.push(ucis.length);
      return [];
    });
    const marks: unknown[] = [];
    beginBlunderCheck({
      code: 'X',
      fen: 'fen',
      ucis: ['a2a3', 'a2a4', 'b2b3', 'b2b4'],
      playedUci: 'a2a4',
      ply: 3,
      destination: 'a4',
      accept: (mark) => {
        marks.push(mark);
        return false;
      },
    });
    expect(calls).toEqual([]);
    expect(marks).toEqual([null]);
  });
});

describe('blunder marker at the table', () => {
  it('does not wait on the search before the next seat can move', () => {
    setMoveRanker(() => new Promise(() => undefined));
    const { room, tokens } = seated();
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 10);
    expect(room.game.seatToMove()).toBe('black1');
    expect(room.view('black1', 10).mark).toBeNull();
    expect(room.view('white2', 10).opening?.name).toBe("King's Pawn Game");
    room.move(tokens.black1, { from: 'e7', to: 'e5' }, 20);
    expect(room.game.seatToMove()).toBe('white2');
    expect(room.game.history().map((move) => move.san)).toEqual(['e4', 'e5']);
  });

  it('shows the mark to every seat only after the search says the move is in the bottom fifth', async () => {
    const gate: { finish: ((scores: MoveScore[]) => void) | null } = { finish: null };
    const announced: string[] = [];
    onBlunderReady((code) => announced.push(code));
    setMoveRanker(
      (_fen, ucis) =>
        new Promise((resolve) => {
          gate.finish = () => resolve(ucis.map((uci) => ({ uci, score: uci === 'e2e4' ? -900 : 50 })));
        }),
    );
    const { room, tokens } = seated();
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 10);
    expect(room.view('white1', 10).mark).toBeNull();
    await flush();
    const finish = gate.finish;
    if (!finish) throw new Error('search did not start');
    finish([]);
    await flush();
    for (const seat of [...SEATS, 'guest']) {
      expect(room.view(seat, 10).mark).toMatchObject({ square: 'e4', ply: 1, grade: 'blunder' });
    }
    expect(announced).toEqual(['BLND01']);
  });

  it('marks the unique best move brilliant and a lesser top-fifth move good', async () => {
    const gate: { finish: ((scores: MoveScore[]) => void) | null } = { finish: null };
    const announced: string[] = [];
    onBlunderReady((code) => announced.push(code));
    setMoveRanker(
      (_fen, ucis) =>
        new Promise((resolve) => {
          gate.finish = () => resolve(ucis.map((uci) => ({ uci, score: uci === 'e2e4' ? 80 : 15 })));
        }),
    );
    const { room, tokens } = seated();
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 10);
    await flush();
    const finish = gate.finish;
    if (!finish) throw new Error('search did not start');
    finish([]);
    await flush();
    for (const seat of SEATS) {
      expect(room.view(seat, 10).mark).toMatchObject({ square: 'e4', ply: 1, grade: 'brilliant' });
    }
    expect(announced).toEqual(['BLND01']);

    const goodGate: { finish: ((scores: MoveScore[]) => void) | null } = { finish: null };
    setMoveRanker(
      (_fen, ucis) =>
        new Promise((resolve) => {
          goodGate.finish = () => {
            let crowned = false;
            resolve(
              ucis.map((uci) => {
                if (uci === 'e7e5') return { uci, score: 50 };
                if (!crowned) {
                  crowned = true;
                  return { uci, score: 90 };
                }
                return { uci, score: 10 };
              }),
            );
          };
        }),
    );
    room.move(tokens.black1, { from: 'e7', to: 'e5' }, 20);
    await flush();
    const finishGood = goodGate.finish;
    if (!finishGood) throw new Error('search did not start');
    finishGood([]);
    await flush();
    expect(room.view('white1', 20).mark).toMatchObject({ square: 'e5', ply: 2, grade: 'good' });

    setMoveRanker(async () => []);
    const quiet = seated();
    const heard: string[] = [];
    onBlunderReady((code) => heard.push(code));
    quiet.room.move(quiet.tokens.white1, { from: 'e2', to: 'e4' }, 30);
    await flush();
    await flush();
    expect(quiet.room.view('white1', 30).opening?.name).toBe("King's Pawn Game");
    expect(quiet.room.view('black2', 30).mark).toBeNull();
    expect(quiet.room.view('white2', 30).mark).toBeNull();
    expect(heard).toEqual([]);
  });

  it('drops a late result after another move, and ignores a move that ties the field', async () => {
    const pending: { ucis: string[]; resolve: (scores: MoveScore[]) => void }[] = [];
    setMoveRanker(
      (_fen, ucis) =>
        new Promise((resolve) => {
          pending.push({ ucis, resolve });
        }),
    );
    const { room, tokens } = seated();
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 10);
    await flush();
    room.move(tokens.black1, { from: 'e7', to: 'e5' }, 20);
    await flush();
    expect(pending).toHaveLength(2);
    pending[0].resolve(pending[0].ucis.map((uci) => ({ uci, score: uci === 'e2e4' ? -1000 : 10 })));
    await flush();
    expect(room.view('white1', 20).mark).toBeNull();

    pending[1].resolve(pending[1].ucis.map((uci) => ({ uci, score: 0 })));
    await flush();
    expect(room.view('black2', 20).mark).toBeNull();
    expect(room.view('white2', 20).seatToMove).toBe('white2');
  });
});
