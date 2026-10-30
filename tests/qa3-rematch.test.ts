import { describe, expect, it } from 'vitest';
import { Room } from '../server/rooms.js';
import { resetCheckersLeaderboard, resetLeaderboard } from '../server/leaderboard.js';

const clock = { id: 'none', label: 'No clock', initialMs: 0, incrementMs: 0 } as never;

function playOut(room: Room, humans: Record<string, string>, maxPlies = 400) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < maxPlies && room.game.status === 'playing'; i++) {
    if (room.playBot(Date.now(), rnd)) continue;
    const seat = room.game.seatToMove()!;
    const token = humans[seat];
    if (!token) throw new Error('no mover for ' + seat);
    const m = room.game.legalMoves()[0]!;
    room.move(token, { from: m.from, to: m.to, ...(m.path && m.path.length > 1 ? { via: m.path.slice(0, -1) } : {}) });
  }
}

describe('scrambled rematch with 2 humans + bots', () => {
  for (const gameType of ['checkers'] as const) {
    it(`${gameType} 2v2: natural end, scramble rematch, game keeps going`, () => {
      resetLeaderboard(null); resetCheckersLeaderboard(null);
      for (let trial = 0; trial < 6; trial++) {
        const room = new Room('RM' + trial, clock, { mode: '2v2', pairSide: null }, gameType);
        let k = 0; const seq = [0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.8]; room.random = () => seq[(k++ + trial) % seq.length]!;
        const a = room.addMember('QA-Ann'); const b = room.addMember('QA-Bob');
        room.connect(a, 'sa'); room.connect(b, 'sb');
        room.sit(a, 'white1'); room.sit(b, 'black1');
        room.addBot(a, 'white2'); room.addBot(a, 'black2');
        expect(room.game.status).toBe('playing');
        const seatOf = (t: string) => (room as any).members.get(t).seat as string;
        const map = () => ({ [seatOf(a)]: a, [seatOf(b)]: b });
        playOut(room, map());
        if (room.game.status === 'playing') room.resign(a);
        expect(room.game.status).toBe('ended');
        room.setScramble(a, true);
        room.voteRematch(a); room.voteRematch(b);
        expect(room.game.status).toBe('playing');
        expect(() => room.view('sa', 0)).not.toThrow();
        expect(() => room.summary()).not.toThrow();
        playOut(room, map(), 40);
        expect(room.anyoneConnected()).toBe(true);
      }
    });
  }
});

import { createRoom, missingRoomMessage, pruneRooms, resetRooms } from '../server/rooms.js';
describe('missing table message', () => {
  it('says the server restarted for unknown codes and expired for pruned ones', () => {
    resetRooms();
    expect(missingRoomMessage('LEJZPF')).toMatch(/restarted for an update/);
    const r = createRoom({ id: 'none', label: 'No clock', initialMs: 0, incrementMs: 0 } as never);
    pruneRooms(Date.now() + 13 * 3600 * 1000);
    expect(missingRoomMessage(r.code)).toMatch(/expired/);
  });
});
