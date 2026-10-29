import { afterEach, describe, expect, it } from 'vitest';
import {
  arrowFromBestmove,
  arrowFromCloud,
  peekHint,
  requestHint,
  resetHintCache,
  resolveBestMove,
  setHintFinder,
  useDefaultHintFinder,
} from '../server/hints.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { Room, resetRooms } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { clockPreset, SEATS, type Seat } from '../shared/types.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach(() => {
  stopMaintenance();
  resetRooms();
  resetHintCache();
  useDefaultHintFinder();
});

function tempBoard() {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-hint-')), 'leaderboard.json'));
}

function seated(names: Record<Seat, string>) {
  tempBoard();
  const room = new Room('HINT01', clockPreset('off')!);
  const tokens = {} as Record<Seat, string>;
  for (const seat of SEATS) {
    tokens[seat] = room.addMember(names[seat]);
    room.connect(tokens[seat], seat);
  }
  for (const seat of SEATS) room.sit(tokens[seat], seat);
  return { room, tokens };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('engine hint parsing', () => {
  it('reads the first cloud-eval move and a Stockfish bestmove', () => {
    expect(arrowFromCloud({ pvs: [{ moves: 'e2e4 e7e5' }] })).toEqual({ from: 'e2', to: 'e4' });
    expect(arrowFromCloud({ pvs: [{ moves: 'e7e8q' }] })).toEqual({ from: 'e7', to: 'e8' });
    expect(arrowFromCloud({})).toBeNull();
    expect(arrowFromBestmove('bestmove g1f3 ponder g8f6')).toEqual({ from: 'g1', to: 'f3' });
    expect(arrowFromBestmove('bestmove (none)')).toBeNull();
  });

  it('uses Stockfish when the public eval has no move', async () => {
    const tried: string[] = [];
    const move = await resolveBestMove(
      'fen',
      async () => {
        tried.push('cloud');
        return null;
      },
      async () => {
        tried.push('stockfish');
        return { from: 'b1', to: 'c3' };
      },
    );
    expect(move).toEqual({ from: 'b1', to: 'c3' });
    expect(tried).toEqual(['cloud', 'stockfish']);

    const cloud = await resolveBestMove(
      'fen',
      async () => ({ from: 'e2', to: 'e4' }),
      async () => {
        throw new Error('should not run');
      },
    );
    expect(cloud).toEqual({ from: 'e2', to: 'e4' });
  });
});

describe('who can see the arrow', () => {
  it('shows the hint only to the team that has chessgawd, including the teammate', async () => {
    const calls: string[] = [];
    setHintFinder(async (fen) => {
      calls.push(fen);
      return fen.includes(' w ') ? { from: 'e2', to: 'e4' } : { from: 'e7', to: 'e5' };
    });
    const { room, tokens } = seated({
      white1: 'ChessGawd',
      black1: 'Jules',
      white2: 'Sam',
      black2: 'Ren',
    });

    expect(room.view('white1', 1).hints).toEqual([]);
    expect(calls).toHaveLength(1);
    await settle();
    expect(room.view('white1', 1).hints).toEqual([{ from: 'e2', to: 'e4' }]);
    expect(room.view('white2', 1).hints).toEqual([{ from: 'e2', to: 'e4' }]);
    expect(room.view('black1', 1).hints).toEqual([]);
    expect(room.view('black2', 1).hints).toEqual([]);
    expect(JSON.stringify(room.view('black1', 1))).not.toContain('e2e4');

    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 2);
    room.view('black1', 2);
    await settle();
    expect(room.view('black1', 2).hints).toEqual([]);
    expect(room.view('white1', 2).hints).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('does not ask the engine when nobody is named chessgawd', async () => {
    let calls = 0;
    setHintFinder(async () => {
      calls += 1;
      return { from: 'e2', to: 'e4' };
    });
    const { room } = seated({
      white1: 'Ada',
      black1: 'Jules',
      white2: 'Sam',
      black2: 'Ren',
    });
    room.view('white1', 1);
    await settle();
    expect(calls).toBe(0);
    expect(room.view('white1', 1).hints).toEqual([]);
    expect(peekHint(room.game.fen())).toBeUndefined();
  });

  it('asks again on the other team’s turn when that team has chessgawd', async () => {
    setHintFinder(async (fen) => (fen.includes(' w ') ? { from: 'g1', to: 'f3' } : { from: 'g8', to: 'f6' }));
    const { room, tokens } = seated({
      white1: 'Ada',
      black1: 'chessgawd',
      white2: 'Sam',
      black2: 'Ren',
    });
    room.view('black1', 1);
    await settle();
    expect(room.view('black1', 1).hints).toEqual([]);
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 2);
    room.view('black1', 2);
    await settle();
    expect(room.view('black1', 2).hints).toEqual([{ from: 'g8', to: 'f6' }]);
    expect(room.view('black2', 2).hints).toEqual([{ from: 'g8', to: 'f6' }]);
    expect(room.view('white1', 2).hints).toEqual([]);
    expect(requestHint).toBeTypeOf('function');
  });
});
