import { describe, expect, it } from 'vitest';
import { RelayGame } from '../server/engine.js';
import { formatThink, rankThinkTimes, slowestSeat } from '../shared/thinkTime.js';
import type { TableSetup } from '../shared/types.js';

const ONE: TableSetup = { mode: '1v1', pairSide: null };
const stat = (g: RelayGame, seat: string, now: number) => g.thinkTimes(now).find((t) => t.seat === seat);

describe('per-player thinking time', () => {
  it('credits each seat from the start of its turn to its move, without a clock', () => {
    const g = new RelayGame(null, ONE);
    g.start(0);
    g.move('white1', { from: 'e2', to: 'e4' }, 3000, 'Ann');
    g.move('black1', { from: 'e7', to: 'e5' }, 4000, 'Bo');
    g.move('white1', { from: 'g1', to: 'f3' }, 9000, 'Ann');
    const ann = stat(g, 'white1', 9500)!;
    expect(ann).toMatchObject({ totalMs: 8000, moves: 2, longestMs: 5000, name: 'Ann', currentMs: 0 });
    const bo = stat(g, 'black1', 9500)!;
    expect(bo).toMatchObject({ totalMs: 1000, moves: 1, currentMs: 500 });
    expect(slowestSeat(g.thinkTimes(9500))).toBe('white1');
  });

  it('attributes relay time to the seat that actually moved', () => {
    const g = new RelayGame(null);
    g.start(0);
    const order: string[] = [];
    const moves = [['e2', 'e4'], ['e7', 'e5'], ['d2', 'd4'], ['d7', 'd5']];
    let t = 0;
    for (const [i, [from, to]] of moves.entries()) {
      const seat = g.seatToMove()!;
      order.push(seat);
      t += (i + 1) * 1000;
      g.move(seat, { from, to }, t);
    }
    expect(new Set(order).size).toBe(4);
    for (const [i, seat] of order.entries()) expect(stat(g, seat, t)!.totalMs).toBe((i + 1) * 1000);
  });

  it('counts an unfinished think on resignation but not as a move, and resets on rematch', () => {
    const g = new RelayGame(null, ONE);
    g.start(0);
    g.move('white1', { from: 'e2', to: 'e4' }, 1000);
    g.resign('black1', 8000);
    expect(stat(g, 'black1', 9000)).toMatchObject({ totalMs: 7000, moves: 0, currentMs: 0 });
    g.voteRematch('white1', 10_000);
    g.voteRematch('black1', 10_000);
    expect(g.status).toBe('playing');
    expect(g.thinkTimes(11_000)).toEqual([expect.objectContaining({ seat: 'white1', totalMs: 0, currentMs: 1000 })]);
  });

  it('does not count the checkmate bailout window', () => {
    const g = new RelayGame(null, ONE);
    g.start(0);
    g.move('white1', { from: 'f2', to: 'f3' }, 1000);
    g.move('black1', { from: 'e7', to: 'e5' }, 2000);
    g.move('white1', { from: 'g2', to: 'g4' }, 3000);
    g.move('black1', { from: 'd8', to: 'h4' }, 4000);
    expect(g.bailout).toBeTruthy();
    expect(g.thinkTimes(50_000).every((t) => t.currentMs === 0)).toBe(true);
    g.payBailout('white1', 'Ann', 60_000);
    const total = () => g.thinkTimes(61_000).reduce((n, t) => n + t.totalMs + t.currentMs, 0);
    expect(total()).toBe(4000 + 1000);
  });

  it('ranks and formats', () => {
    const rows = rankThinkTimes([
      { seat: 'white1', name: 'A', totalMs: 1000, moves: 2, longestMs: 800, currentMs: 0 },
      { seat: 'black1', name: 'B', totalMs: 500, moves: 1, longestMs: 500, currentMs: 400 },
    ], 200);
    expect(rows.map((r) => r.name)).toEqual(['B', 'A']);
    expect(rows[0]).toMatchObject({ usedMs: 1100, longestMs: 600, averageMs: 500 });
    expect(formatThink(65_000)).toBe('1:05');
    expect(formatThink(3_725_000)).toBe('1:02:05');
  });
});
