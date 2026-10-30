import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { botElo, botProfile, chooseChessMove, chooseCheckersMove, isBotName } from '../server/bots.js';
import { isBotName as accountBotName } from '../server/accounts.js';
import { getCheckersLeaderboard, getLeaderboard, resetCheckersLeaderboard, resetLeaderboard } from '../server/leaderboard.js';
import { getChessStats, resetChessStats } from '../server/chess-stats.js';
import { Room, resetRooms } from '../server/rooms.js';
import { stopMaintenance } from '../server/sockets.js';
import { INITIAL_CHECKERS_FEN } from '../shared/checkers.js';
import { clockPreset, seatsFor, type Seat, type TableSetup } from '../shared/types.js';

afterEach(() => {
  stopMaintenance();
  resetRooms();
});

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function tempFile() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'relay-bots-')), 'lb.json');
}

function room(setup: TableSetup, gameType: 'chess' | 'checkers' = 'chess', clock = 'off') {
  return new Room('BOTS01', clockPreset(clock)!, setup, gameType);
}

describe('bot profile', () => {
  it('maps BOT_ELO to depth, blunder rate and noise (default 650)', () => {
    expect(botElo({})).toBe(650);
    expect(botElo({ BOT_ELO: '1200' })).toBe(1200);
    expect(botElo({ BOT_ELO: 'nope' })).toBe(650);
    const weak = botProfile(650);
    expect(weak).toMatchObject({ depth: 1, minDelayMs: 1000, maxDelayMs: 3000 });
    expect(weak.blunderRate).toBeCloseTo(0.225);
    const strong = botProfile(1600);
    expect(strong.depth).toBe(3);
    expect(strong.blunderRate).toBeLessThan(weak.blunderRate);
    expect(strong.noiseCp).toBeLessThan(weak.noiseCp);
  });

  it('plays legal moves and sometimes misses a free queen at 650', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/3P3q/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1';
    const rand = seeded(3);
    let missed = 0;
    for (let i = 0; i < 200; i += 1) {
      const m = chooseChessMove('rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1', botProfile(650), rand);
      expect(m).not.toBeNull();
      if (!(m!.from === 'c1' && m!.to === 'g5')) missed += 1;
    }
    expect(missed).toBeGreaterThan(10); // weak: misses simple tactics often
    expect(missed).toBeLessThan(195); // but not a pure random mover
    expect(chooseChessMove(fen, botProfile(650), rand)).not.toBeNull();
    expect(chooseCheckersMove(INITIAL_CHECKERS_FEN, botProfile(650), rand)).not.toBeNull();
  });

  it('bot names are reserved', () => {
    expect(isBotName('Bot 650 · Rook')).toBe(true);
    expect(accountBotName('bot 1')).toBe(true);
    expect(accountBotName('Botany')).toBe(false);
  });
});

function playRelay(gameType: 'chess' | 'checkers', mode: TableSetup['mode'], humanSeat: Seat) {
  const setup = { mode, pairSide: null } as TableSetup;
  const r = room(setup, gameType);
  r.botProfile = botProfile(650);
  const human = r.addMember('Ada');
  r.connect(human, 'sock-ada');
  r.sit(human, humanSeat);
  const seats = seatsFor(setup);
  const names: string[] = [];
  for (const seat of seats) if (seat !== humanSeat) names.push(r.addBot(human, seat));
  expect(new Set(names).size).toBe(names.length);
  expect(names[0]).toMatch(/^Bot 650 · /);
  expect(r.game.status).toBe('playing');
  const view = r.view('sock-ada', 1);
  expect(view.seats[seats.find((s) => s !== humanSeat)!]).toMatchObject({ bot: true, connected: true });
  const rand = seeded(11);
  for (let i = 0; i < 40 && r.game.status === 'playing'; i += 1) {
    if (r.game.seatToMove() === humanSeat) {
      const legal = r.game.legalMoves();
      const m = legal[Math.floor(rand() * legal.length)]!;
      r.move(human, { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}), ...(m.path && m.path.length > 1 ? { via: m.path.slice(0, -1) } : {}) });
    } else if (r.botDuty()) {
      expect(r.playBot(Date.now(), rand)).toBe(true);
    } else if (r.game.bailout) {
      r.acceptMate(human);
    }
  }
  return { r, seats, human };
}

describe('bots in relay modes', () => {
  for (const gameType of ['chess', 'checkers'] as const) {
    for (const mode of ['2v1', '2v2', '3v3'] as const) {
      it(`${gameType} ${mode}: bots move in relay order`, () => {
        const { r, seats } = playRelay(gameType, mode, 'white1');
        const order = (side: 'white' | 'black') => seats.filter((s) => s.startsWith(side));
        const hist = r.game.history();
        expect(hist.length).toBeGreaterThan(4);
        const counters = { white: 0, black: 0 };
        for (const mv of hist) {
          const side = mv.seat.startsWith('white') ? 'white' : 'black';
          const team = order(side);
          expect(mv.seat).toBe(team[counters[side] % team.length]);
          counters[side] += 1;
        }
      });
    }
  }

  it('bots can be removed before start, not after, and not in tournaments', () => {
    const r = room({ mode: '2v2', pairSide: null });
    const t = r.addMember('Ada');
    r.addBot(t, 'black1');
    expect(r.view('x', 1).seats.black1?.bot).toBe(true);
    r.removeBot(t, 'black1');
    expect(r.view('x', 1).seats.black1).toBeNull();
    expect(() => r.removeBot(t, 'black1')).toThrow();
    const tr = room({ mode: '1v1', pairSide: null });
    tr.tournament = { code: 'T', seats: {} };
    expect(() => tr.addBot(tr.addMember('Ada'), 'black1')).toThrow(/Tournament/);
  });

  it('an all-bot game runs to the end without hanging, and keeps going with nobody connected', () => {
    for (const gameType of ['chess', 'checkers'] as const) {
      const r = room({ mode: '2v2', pairSide: null }, gameType);
      const t = r.addMember('Host'); // creator stays unseated and offline
      for (const seat of seatsFor({ mode: '2v2', pairSide: null })) r.addBot(t, seat);
      const rand = seeded(5);
      let guard = 0;
      while (r.game.status === 'playing' && guard < 400) {
        guard += 1;
        expect(r.botDuty()).not.toBeNull();
        r.playBot(Date.now(), rand);
      }
      if (r.game.status === 'playing') r.game.resign('white1');
      expect(r.game.status).toBe('ended');
      expect(r.botDuty()).toBeNull();
    }
  });

  it('a bot whose engine fails still resolves its turn', () => {
    const r = room({ mode: '1v1', pairSide: null });
    const t = r.addMember('Ada');
    r.connect(t, 's');
    r.sit(t, 'black1');
    r.addBot(t, 'white1');
    const before = r.game.ply();
    expect(r.playBot(Date.now(), () => Number.NaN)).toBe(true);
    expect(r.game.ply() > before || r.game.status === 'ended').toBe(true);
  });

  it('bot clocks keep running while the human is the one disconnected', () => {
    const r = room({ mode: '1v1', pairSide: null }, 'chess', '3+2');
    const t = r.addMember('Ada');
    r.connect(t, 's');
    r.sit(t, 'black1');
    r.addBot(t, 'white1');
    r.disconnect('s');
    expect(r.botDuty()?.kind).toBe('move');
    expect(r.game.clockView(Date.now())?.running).toBe(true);
    expect(r.playBot()).toBe(true);
    expect(r.game.seatToMove()).toBe('black1');
  });
});

describe('leaderboard and stats exclusion', () => {
  it('a chess game with a bot is never scored and records no move stats', () => {
    resetLeaderboard(tempFile());
    const stats = resetChessStats();
    const r = room({ mode: '1v1', pairSide: null });
    const t = r.addMember('Ada');
    r.connect(t, 's');
    r.sit(t, 'white1');
    r.addBot(t, 'black1');
    r.move(t, { from: 'e2', to: 'e4' });
    r.resign(t);
    r.view('s', Date.now());
    r.view('s', Date.now());
    expect(getLeaderboard().standings().find((row) => row.name === 'Ada')).toBeUndefined();
    expect(getLeaderboard().standings().some((row) => row.name.startsWith('Bot'))).toBe(false);
    expect(stats).toBe(getChessStats());
    expect(JSON.stringify((stats as unknown as { records: Map<string, unknown> }).records.size)).toBe('0');
  });

  it('a checkers game with a bot is never scored; a human-only one is', () => {
    resetCheckersLeaderboard(tempFile());
    const r = room({ mode: '1v1', pairSide: null }, 'checkers');
    const t = r.addMember('Ada');
    r.connect(t, 's');
    r.sit(t, 'white1');
    r.addBot(t, 'black1');
    r.resign(t);
    r.view('s', Date.now());
    expect(getCheckersLeaderboard().standings().length).toBe(0);

    const h = room({ mode: '1v1', pairSide: null }, 'checkers');
    const a = h.addMember('Ada');
    const b = h.addMember('Jules');
    h.sit(a, 'white1');
    h.sit(b, 'black1');
    h.resign(a);
    h.view('s', Date.now());
    expect(getCheckersLeaderboard().standings().length).toBe(2);
  });

  it('rematch: bots vote along with the human', () => {
    const r = room({ mode: '1v1', pairSide: null });
    const t = r.addMember('Ada');
    r.connect(t, 's');
    r.sit(t, 'white1');
    r.addBot(t, 'black1');
    r.resign(t);
    r.voteRematch(t);
    expect(r.game.status).toBe('playing');
  });
});
