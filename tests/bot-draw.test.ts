import { describe, expect, it } from 'vitest';
import { botAcceptsDraw, deadDraw } from '../server/bot-draw.js';
import { createRoom, resetRooms } from '../server/rooms.js';
import { clockPreset } from '../shared/types.js';

const preset = clockPreset('10+0')!;

describe('bot draw answers', () => {
  it('chess: accepts when clearly behind or dead drawn, declines otherwise', () => {
    expect(botAcceptsDraw('chess', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'black')).toBe(false);
    expect(botAcceptsDraw('chess', 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'black')).toBe(true);
    expect(botAcceptsDraw('chess', 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'white')).toBe(false);
    expect(deadDraw('chess', '8/8/4k3/8/8/3K4/8/8 w - - 0 1')).toBe(true);
  });
  it('checkers: material and lone kings', () => {
    const start = 'p1p1p1p1/1p1p1p1p/p1p1p1p1/8/8/1P1P1P1P/P1P1P1P1/1P1P1P1P';
    expect(botAcceptsDraw('checkers', start, 'white')).toBe(false);
    expect(botAcceptsDraw('checkers', '8/8/8/8/8/1P1P1P1P/P1P1P1P1/1P1P1P1P', 'white')).toBe(false);
    expect(botAcceptsDraw('checkers', 'p1p1p1p1/1p1p1p1p/p1p1p1p1/8/8/8/8/1P6', 'white')).toBe(true);
    expect(deadDraw('checkers', 'k7/8/8/8/8/8/8/6K1')).toBe(true);
  });

  for (const gameType of ['chess', 'checkers'] as const) {
    it(`${gameType}: an all-bot side answers with a visible note within 1–3 s`, () => {
      resetRooms();
      const room = createRoom(preset, { mode: '1v1', pairSide: null }, gameType);
      const h = room.addMember('QA-Draw'); room.sit(h, 'white1'); room.addBot(h, 'black1');
      room.offerDraw(h);
      const d = room.botDelay(() => 0.5);
      expect(d).toBeGreaterThanOrEqual(1000); expect(d).toBeLessThanOrEqual(3000);
      expect(room.playBot()).toBe(true);
      const st = room.view('x', Date.now());
      expect(st.drawOffer).toBeNull();
      expect(st.result).toBeNull();
      expect(st.drawNote).toMatch(/declined the draw\./);
    });
  }

  it('shows bots as already agreed on the rematch panel', () => {
    resetRooms();
    const room = createRoom(preset, { mode: '1v1', pairSide: null }, 'chess');
    const h = room.addMember('QA-Rem'); room.sit(h, 'white1'); room.addBot(h, 'black1');
    room.resign(h);
    expect(room.view('x', Date.now()).rematchVotes).toEqual(['black1']);
  });
});
