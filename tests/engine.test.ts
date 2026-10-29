import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { canPossiblyMate, LAG_GRACE_MS, RelayGame } from '../server/engine.js';
import { describeResult, seatForPly, seatLabel, SEATS, type Seat } from '../shared/types.js';

const START = new Chess().fen();

function play(game: RelayGame, moves: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }[], now = 0) {
  const seats: Seat[] = [];
  for (const move of moves) {
    const seat = game.seatToMove();
    if (!seat) throw new Error('no seat');
    seats.push(seat);
    game.move(seat, move, now);
  }
  return seats;
}

describe('relay turn order', () => {
  it('rotates White 1, Black 1, White 2, Black 2', () => {
    expect(SEATS.map((_, index) => seatForPly(index))).toEqual(['white1', 'black1', 'white2', 'black2']);
    expect(seatForPly(4)).toBe('white1');
    expect(seatForPly(7)).toBe('black2');
    expect(seatLabel('white2')).toBe('White 2');
  });

  it('rejects a move from the player who is waiting', () => {
    const game = new RelayGame(null);
    game.start(0);
    expect(() => game.move('black1', { from: 'e7', to: 'e5' }, 0)).toThrow(/turn/i);
    expect(() => game.move('white2', { from: 'e2', to: 'e4' }, 0)).toThrow(/turn/i);
    expect(game.fen()).toBe(START);
    expect(game.history()).toHaveLength(0);
  });

  it('rejects an illegal move without changing the position', () => {
    const game = new RelayGame(null);
    game.start(0);
    expect(() => game.move('white1', { from: 'e2', to: 'e5' }, 0)).toThrow(/illegal/i);
    expect(() => game.move('white1', { from: 'e7', to: 'e5' }, 0)).toThrow(/illegal/i);
    expect(game.fen()).toBe(START);
  });

  it('plays fool’s mate with each teammate moving once', () => {
    const game = new RelayGame(null);
    game.start(0);
    const seats = play(game, [
      { from: 'f2', to: 'f3' },
      { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' },
      { from: 'd8', to: 'h4' },
    ]);
    expect(seats).toEqual(['white1', 'black1', 'white2', 'black2']);
    expect(game.history().map((move) => move.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(game.result).toMatchObject({ type: 'checkmate', winner: 'black' });
    expect(game.status).toBe('ended');
    expect(game.seatToMove()).toBeNull();
  });

  it('reports check without ending the game', () => {
    const game = RelayGame.fromPosition('4k3/4Q3/8/8/8/8/8/4K3 b - - 0 1', 1);
    expect(game.inCheck()).toBe(true);
    expect(game.result).toBeNull();
    expect(game.seatToMove()).toBe('black1');
    expect(() => game.move('white2', { from: 'e1', to: 'e2' }, 0)).toThrow(/turn/i);
  });
});

describe('FIDE rules', () => {
  it('castles kingside and queenside, and refuses castle through or into check', () => {
    const kingside = RelayGame.fromPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 0);
    kingside.move('white1', { from: 'e1', to: 'g1' }, 0);
    expect(kingside.history()[0].san).toBe('O-O');
    expect(kingside.fen()).toContain('R4RK1');
    expect(kingside.fen()).toContain(' b kq ');

    const queenside = RelayGame.fromPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 0);
    queenside.move('white1', { from: 'e1', to: 'c1' }, 0);
    expect(queenside.history()[0].san).toBe('O-O-O');
    expect(queenside.fen()).toContain('2KR3R');

    const through = RelayGame.fromPosition('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1', 0);
    expect(() => through.move('white1', { from: 'e1', to: 'g1' }, 0)).toThrow(/illegal/i);

    const into = RelayGame.fromPosition('4k1r1/8/8/8/8/8/8/4K2R w K - 0 1', 0);
    expect(() => into.move('white1', { from: 'e1', to: 'g1' }, 0)).toThrow(/illegal/i);

    const checked = RelayGame.fromPosition('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1', 0);
    expect(checked.inCheck()).toBe(true);
    expect(() => checked.move('white1', { from: 'e1', to: 'g1' }, 0)).toThrow(/illegal/i);
  });

  it('allows en passant on the next ply only', () => {
    const game = new RelayGame(null);
    game.start(0);
    const seats = play(game, [
      { from: 'e2', to: 'e4' },
      { from: 'e7', to: 'e6' },
      { from: 'e4', to: 'e5' },
      { from: 'd7', to: 'd5' },
      { from: 'e5', to: 'd6' },
    ]);
    expect(seats[4]).toBe('white1');
    expect(game.history().at(-1)?.san).toBe('exd6');
    expect(game.fen().startsWith('rnbqkbnr/ppp2ppp/3Pp3/')).toBe(true);

    const expired = new RelayGame(null);
    expired.start(0);
    play(expired, [
      { from: 'e2', to: 'e4' },
      { from: 'a7', to: 'a6' },
      { from: 'e4', to: 'e5' },
      { from: 'd7', to: 'd5' },
      { from: 'a2', to: 'a3' },
      { from: 'a6', to: 'a5' },
    ]);
    expect(expired.seatToMove()).toBe('white2');
    expect(() => expired.move('white2', { from: 'e5', to: 'd6' }, 0)).toThrow(/illegal/i);
  });

  it('requires a promotion choice and keeps the chosen piece', () => {
    const fen = '8/P7/8/8/8/8/8/k6K w - - 0 1';
    const missing = RelayGame.fromPosition(fen, 0);
    expect(() => missing.move('white1', { from: 'a7', to: 'a8' }, 0)).toThrow(/illegal/i);

    for (const [promotion, piece] of [
      ['q', 'Q'],
      ['r', 'R'],
      ['b', 'B'],
      ['n', 'N'],
    ] as const) {
      const game = RelayGame.fromPosition(fen, 0);
      game.move('white1', { from: 'a7', to: 'a8', promotion }, 0);
      expect(game.fen().startsWith(`${piece}7/8`)).toBe(true);
      expect(game.history()[0].san.startsWith(`a8=${piece}`)).toBe(true);
    }

    const bad = RelayGame.fromPosition(fen, 0);
    expect(() => bad.move('white1', { from: 'a7', to: 'a8', promotion: 'k' as 'q' }, 0)).toThrow();
  });

  it('ends on stalemate, threefold repetition, the fifty-move rule, and insufficient material', () => {
    const stalemate = RelayGame.fromPosition('k7/8/2K5/8/8/8/1Q6/8 w - - 0 1', 0);
    stalemate.move('white1', { from: 'b2', to: 'b6' }, 0);
    expect(stalemate.history()[0].san).toBe('Qb6');
    expect(stalemate.result?.type).toBe('stalemate');
    expect(stalemate.result?.winner).toBeNull();

    const alreadyStale = RelayGame.fromPosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 1);
    expect(alreadyStale.result?.type).toBe('stalemate');

    const repeat = new RelayGame(null);
    repeat.start(0);
    const seats = play(repeat, [
      { from: 'g1', to: 'f3' },
      { from: 'g8', to: 'f6' },
      { from: 'f3', to: 'g1' },
      { from: 'f6', to: 'g8' },
      { from: 'g1', to: 'f3' },
      { from: 'g8', to: 'f6' },
      { from: 'f3', to: 'g1' },
      { from: 'f6', to: 'g8' },
    ]);
    expect(seats).toEqual(['white1', 'black1', 'white2', 'black2', 'white1', 'black1', 'white2', 'black2']);
    expect(repeat.result?.type).toBe('threefold');

    const fifty = RelayGame.fromPosition('k7/8/8/q7/8/8/8/7K w - - 99 80', 0);
    expect(fifty.result).toBeNull();
    fifty.move('white1', { from: 'h1', to: 'g1' }, 0);
    expect(fifty.result?.type).toBe('fifty_move');

    const claimed = RelayGame.fromPosition('k7/8/8/q7/8/8/8/7K w - - 100 80', 0);
    expect(claimed.result?.type).toBe('fifty_move');

    const traded = RelayGame.fromPosition('k7/8/8/8/8/8/7q/7K w - - 0 1', 0);
    expect(traded.result).toBeNull();
    traded.move('white1', { from: 'h1', to: 'h2' }, 0);
    expect(traded.result?.type).toBe('insufficient');

    const bare = RelayGame.fromPosition('8/8/8/8/8/8/8/k6K w - - 0 1', 0);
    expect(bare.result?.type).toBe('insufficient');
  });
});

describe('draws, resignation, and rematch', () => {
  it('lets only the other team accept a draw, and a reply move declines it', () => {
    const game = new RelayGame(null);
    game.start(0);
    expect(() => game.offerDraw('black1', 0)).toThrow(/turn/i);
    game.offerDraw('white1', 0);
    expect(game.drawOffer).toMatchObject({ seat: 'white1', side: 'white' });
    expect(() => game.answerDraw('white2', true, 0)).toThrow(/other team/i);
    game.offerDraw('white1', 0);
    expect(game.drawOffer).toBeNull();

    game.offerDraw('white1', 0);
    game.move('white1', { from: 'e2', to: 'e4' }, 0);
    expect(game.drawOffer?.side).toBe('white');
    game.answerDraw('black2', false, 0);
    expect(game.drawOffer).toBeNull();
    expect(game.status).toBe('playing');

    game.offerDraw('black1', 0);
    game.answerDraw('white2', true, 0);
    expect(game.result?.type).toBe('draw_agreed');
    expect(game.result?.winner).toBeNull();
  });

  it('resigns for the player’s team and rematches only after all four seats agree', () => {
    const game = new RelayGame(null);
    game.start(0);
    game.move('white1', { from: 'e2', to: 'e4' }, 0);
    game.resign('black2');
    expect(game.result).toMatchObject({ type: 'resignation', winner: 'white', bySeat: 'black2' });
    const text = describeResult(game.result!, () => 'Jules');
    expect(text.headline).toBe('Resignation');
    expect(text.detail).toContain('Jules resigned');

    for (const seat of ['white1', 'black1', 'white2'] as const) {
      game.voteRematch(seat, 50);
      expect(game.status).toBe('ended');
    }
    game.voteRematch('black2', 50);
    expect(game.status).toBe('playing');
    expect(game.fen()).toBe(START);
    expect(game.history()).toHaveLength(0);
    expect(game.seatToMove()).toBe('white1');
    expect(game.rematchVotes.size).toBe(0);
  });
});

describe('clock', () => {
  it('charges the side that moved and adds the increment', () => {
    const game = RelayGame.fromPosition(START, 0, { initialMs: 60_000, incrementMs: 2_000 }, 0);
    game.move('white1', { from: 'e2', to: 'e4' }, 10_000);
    expect(game.clockView(10_000)).toMatchObject({
      whiteMs: 52_000,
      blackMs: 60_000,
      active: 'black',
      running: true,
    });
    game.move('black1', { from: 'e7', to: 'e5' }, 13_000);
    expect(game.clockView(13_000)?.blackMs).toBe(59_000);
    expect(game.clockView(13_000)?.whiteMs).toBe(52_000);
  });

  it('pauses while the player to move is disconnected', () => {
    const now = 10_000;
    const game = RelayGame.fromPosition(START, 0, { initialMs: 60_000, incrementMs: 0 }, now);
    game.setMoverConnected(false, now + 1_500);
    expect(game.isClockRunning()).toBe(false);
    expect(game.clockView(now + 1_500)?.whiteMs).toBe(58_500);
    game.tick(now + 9_000);
    expect(game.clockView(now + 9_000)?.whiteMs).toBe(58_500);
    game.setMoverConnected(true, now + 9_000);
    game.tick(now + 10_000);
    expect(game.clockView(now + 10_000)?.whiteMs).toBe(57_500);
  });

  it('allows a move inside the lag grace and flags just beyond it', () => {
    const allowed = RelayGame.fromPosition(START, 0, { initialMs: 1_000, incrementMs: 0 }, 0);
    allowed.move('white1', { from: 'e2', to: 'e4' }, 1_000 + LAG_GRACE_MS - 1);
    expect(allowed.history()).toHaveLength(1);
    expect(allowed.result).toBeNull();

    const flagged = RelayGame.fromPosition(START, 0, { initialMs: 1_000, incrementMs: 0 }, 0);
    expect(() => flagged.move('white1', { from: 'e2', to: 'e4' }, 1_000 + LAG_GRACE_MS)).toThrow(/time/i);
    expect(flagged.history()).toHaveLength(0);
    expect(flagged.result).toMatchObject({ type: 'timeout', winner: 'black' });
  });

  it('draws a flag fall when the opponent cannot mate, and awards a win when they can', () => {
    const queen = new Chess('k7/8/8/8/8/8/8/6QK w - - 0 1');
    expect(canPossiblyMate(queen, 'w')).toBe(true);
    expect(canPossiblyMate(queen, 'b')).toBe(false);
    const knights = new Chess('k7/8/8/8/8/8/6N1/6NK w - - 0 1');
    expect(canPossiblyMate(knights, 'w')).toBe(true);

    const draw = RelayGame.fromPosition('k7/8/8/8/8/8/8/6QK w - - 0 1', 0, { initialMs: 400, incrementMs: 0 }, 0);
    expect(draw.result).toBeNull();
    draw.tick(400 + LAG_GRACE_MS);
    expect(draw.result).toMatchObject({ type: 'timeout', winner: null });

    const win = RelayGame.fromPosition('k7/8/8/8/8/8/8/6QK b - - 0 1', 1, { initialMs: 400, incrementMs: 0 }, 0);
    win.tick(400 + LAG_GRACE_MS);
    expect(win.result).toMatchObject({ type: 'timeout', winner: 'white' });

    const rookVsKnight = RelayGame.fromPosition(
      '8/8/8/4n3/8/8/8/R3K2k w - - 0 1',
      0,
      { initialMs: 400, incrementMs: 0 },
      0,
    );
    rookVsKnight.tick(400 + LAG_GRACE_MS);
    expect(rookVsKnight.result).toMatchObject({ type: 'timeout', winner: null });
  });
});
