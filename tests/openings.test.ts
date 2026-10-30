import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { useDefaultMoveRanker } from '../server/blunders.js';
import { resetHintCache, setHintFinder, useDefaultHintFinder } from '../server/hints.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { moveUci, openingName } from '../server/openings.js';
import { Room, resetRooms } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { BLUNDER_FLASH_MS, OPENING_FLASH_MS, flashIsFresh } from '../shared/flash.js';
import { clockPreset, SEATS, type Seat } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
  resetHintCache();
  useDefaultHintFinder();
  useDefaultMoveRanker();
});

function seated(names?: Partial<Record<Seat, string>>) {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-open-')), 'leaderboard.json'));
  const room = new Room('OPEN01', clockPreset('off')!);
  const tokens = {} as Record<Seat, string>;
  const chosen = {
    white1: 'Ada',
    black1: 'Jules',
    white2: 'Sam',
    black2: 'Ren',
    ...names,
  };
  for (const seat of SEATS) {
    tokens[seat] = room.addMember(chosen[seat]);
    room.connect(tokens[seat], seat);
  }
  for (const seat of SEATS) room.sit(tokens[seat], seat);
  return { room, tokens };
}

describe('opening book', () => {
  it('reads the deepest lichess name and keeps it when the line leaves the book', () => {
    expect(moveUci({ from: 'e7', to: 'e8', san: 'e8=Q+' })).toBe('e7e8q');
    expect(moveUci({ from: 'e7', to: 'e8', promotion: 'n' })).toBe('e7e8n');
    expect(openingName(['e2e4'])).toBe("King's Pawn Game");
    expect(openingName(['e2e4', 'e7e5'])).toBe("King's Pawn Game");
    expect(openingName(['e2e4', 'e7e5', 'g1f3'])).toBe("King's Knight Opening");
    expect(openingName(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'])).toBe('Italian Game');
    expect(openingName(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'])).toBe('Italian Game: Giuoco Piano');
    expect(openingName(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])).toBe('Ruy Lopez');
    expect(openingName(['e2e4', 'e7e5', 'h2h3'])).toBe("King's Pawn Game");
    expect(openingName(['h2h4'])).toBe('Kádas Opening');
  });

  it('shows a fresh mark only for the ply that introduced it', () => {
    const mark = { ply: 3, at: 1_000 };
    expect(flashIsFresh(mark, 3, 1_000, OPENING_FLASH_MS)).toBe(true);
    expect(flashIsFresh(mark, 3, 1_000 + OPENING_FLASH_MS, OPENING_FLASH_MS)).toBe(true);
    expect(flashIsFresh(mark, 3, 1_001 + OPENING_FLASH_MS, OPENING_FLASH_MS)).toBe(false);
    expect(flashIsFresh(mark, 4, 1_000, OPENING_FLASH_MS)).toBe(false);
    expect(flashIsFresh(null, 3, 1_000, BLUNDER_FLASH_MS)).toBe(false);
    expect(OPENING_FLASH_MS).toBeGreaterThanOrEqual(2_000);
    expect(OPENING_FLASH_MS).toBeLessThanOrEqual(3_000);
    expect(BLUNDER_FLASH_MS).toBe(2_000);
  });
});

describe('announcing an opening at the table', () => {
  it('tells every seat the most specific new name and does not repeat the same one', async () => {
    setHintFinder(async () => ({ from: 'e7', to: 'e5' }));
    const { room, tokens } = seated({ white1: 'ChessGawd' });
    const line = [
      { from: 'e2', to: 'e4', name: "King's Pawn Game", repeat: false },
      { from: 'e7', to: 'e5', name: "King's Pawn Game", repeat: true },
      { from: 'g1', to: 'f3', name: "King's Knight Opening", repeat: false },
      { from: 'b8', to: 'c6', name: "King's Knight Opening: Normal Variation", repeat: false },
      { from: 'f1', to: 'c4', name: 'Italian Game', repeat: false },
      { from: 'f8', to: 'c5', name: 'Italian Game: Giuoco Piano', repeat: false },
    ];

    for (let index = 0; index < line.length; index += 1) {
      const step = line[index];
      const now = 1_000 + index;
      room.move(tokens[SEATS[index % 4]], { from: step.from, to: step.to }, now);
      for (const seat of [...SEATS, 'spectator']) {
        const view = room.view(seat, now);
        expect(view.opening?.name).toBe(step.name);
        expect(view.opening?.ply).toBe(step.repeat ? index : index + 1);
        expect(view.opening?.at).toBe(step.repeat ? now - 1 : now);
      }
    }

    room.view('white1', 2_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(room.view('white1', 2_000).hints).toEqual([{ from: 'e7', to: 'e5' }]);
    expect(room.view('white2', 2_000).hints).toEqual([{ from: 'e7', to: 'e5' }]);
    expect(room.view('black1', 2_000).hints).toEqual([]);
    expect(room.view('black1', 2_000).opening?.name).toBe('Italian Game: Giuoco Piano');

    room.resign(tokens.white1);
    for (const seat of SEATS) room.voteRematch(tokens[seat], 3_000);
    expect(room.view('black2', 3_000).opening).toBeNull();
    room.move(tokens.white1, { from: 'e2', to: 'e4' }, 3_100);
    expect(room.view('white2', 3_100).opening).toEqual({
      name: "King's Pawn Game",
      ply: 1,
      at: 3_100,
    });
  });
});
