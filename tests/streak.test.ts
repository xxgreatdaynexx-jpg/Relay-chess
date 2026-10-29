import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { setMoveRanker, useDefaultMoveRanker, type MoveScore } from '../server/blunders.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { Room, resetRooms } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { recordStreak } from '../shared/streak.js';
import { clockPreset, SEATS, type MoveGrade, type Seat } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
  useDefaultMoveRanker();
});

describe('best-move streak', () => {
  it('calls double on the second best move and streak on the third, per player', () => {
    const streaks = new Map<string, number>();

    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBeNull();
    expect(streaks.get('white1')).toBe(1);
    expect(recordStreak(streaks, 'white2', 'brilliant', 20)).toBeNull();
    expect(recordStreak(streaks, 'white2', 'blunder', 18)).toBeNull();
    expect(streaks.get('white1')).toBe(1);
    expect(streaks.get('white2')).toBe(0);

    expect(recordStreak(streaks, 'white1', 'brilliant', 4)).toBeNull();
    expect(recordStreak(streaks, 'white1', 'blunder', 2)).toBeNull();
    expect(streaks.get('white1')).toBe(1);

    expect(recordStreak(streaks, 'white1', 'good', 20)).toBeNull();
    expect(streaks.get('white1')).toBe(0);
    expect(recordStreak(streaks, 'white1', null, 12)).toBeNull();
    expect(streaks.get('white1')).toBe(0);

    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBeNull();
    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBe('double');
    expect(streaks.get('white1')).toBe(2);
    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBe('streak');
    expect(streaks.get('white1')).toBe(0);
    expect(streaks.get('white2')).toBe(0);

    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBeNull();
    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBe('double');
    expect(recordStreak(streaks, 'black1', 'brilliant', 20)).toBeNull();
    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBe('streak');
    expect(streaks.get('white1')).toBe(0);
    expect(streaks.get('black1')).toBe(1);
    expect(recordStreak(streaks, 'white1', 'brilliant', 20)).toBeNull();
    expect(streaks.get('white1')).toBe(1);
  });

  it('announces only that player after three of their own best moves', async () => {
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-streak-')), 'leaderboard.json'));
    const room = new Room('STREAK', clockPreset('off')!);
    const names: Record<Seat, string> = { white1: 'Ada', black1: 'Jules', white2: 'Sam', black2: 'Ren' };
    const tokens = {} as Record<Seat, string>;
    for (const seat of SEATS) {
      tokens[seat] = room.addMember(names[seat]);
      room.connect(tokens[seat], seat);
    }
    for (const seat of SEATS) room.sit(tokens[seat], seat);

    setMoveRanker(async (_fen, ucis) => {
      const played = room.game.history().at(-1);
      const uci = played ? `${played.from}${played.to}` : '';
      const grade: MoveGrade = played?.seat === 'white2' ? 'blunder' : 'brilliant';
      return scoresFor(ucis, uci, grade);
    });

    const line = [
      ['white1', 'e2', 'e4'],
      ['black1', 'e7', 'e5'],
      ['white2', 'd2', 'd4'],
      ['black2', 'd7', 'd5'],
      ['white1', 'g1', 'f3'],
      ['black1', 'b8', 'c6'],
      ['white2', 'b1', 'c3'],
      ['black2', 'g8', 'f6'],
      ['white1', 'a2', 'a3'],
    ] as const;

    for (const [seat, from, to] of line) {
      room.move(tokens[seat], { from, to });
      await flush();
      await flush();
      const now = Date.now();
      if (from === 'e2') expect(room.view('white1', now).streak).toBeNull();
      if (from === 'g1') {
        for (const viewer of [...SEATS, 'guest' as const]) {
          expect(room.view(viewer, now).streak).toMatchObject({ name: 'Ada', seat: 'white1', ply: 5, kind: 'double' });
        }
      }
    }

    const seenAt = Date.now();
    for (const seat of [...SEATS, 'guest' as const]) {
      expect(room.view(seat, seenAt).streak).toMatchObject({ name: 'Ada', seat: 'white1', ply: 9, kind: 'streak' });
    }
    expect(room.view('white2', seenAt).mark).toMatchObject({ grade: 'brilliant', square: 'a3' });

    room.resign(tokens.black1);
    for (const seat of SEATS) room.voteRematch(tokens[seat], seenAt);
    expect(room.view('white1', seenAt).streak).toBeNull();
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, seenAt);
    await flush();
    await flush();
    expect(room.view('black1', seenAt).streak).toBeNull();
  });
});

function scoresFor(ucis: string[], played: string, grade: MoveGrade): MoveScore[] {
  return ucis.map((uci) => {
    if (uci === played) return { uci, score: grade === 'brilliant' ? 80 : -80 };
    return { uci, score: 10 };
  });
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}
