import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { classifyMove, sortChess } from '../shared/chessStats';
import { ChessStatsLedger, PgChessStatsStore } from '../server/chess-stats';

const scores = (vals: number[]) => vals.map((score, i) => ({ uci: `m${i}`, score }));
const ten = scores([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);

describe('classifyMove', () => {
  it('grades brilliant, great, mistake, blunder and neutral', () => {
    expect(classifyMove(ten, 'm0', 10)).toEqual({ percentile: 100, kind: 'brilliant' });
    expect(classifyMove(ten, 'm1', 10)?.kind).toBe('great');
    expect(classifyMove(ten, 'm4', 10)?.kind).toBeNull();
    expect(classifyMove(ten, 'm6', 10)?.kind).toBe('mistake');
    expect(classifyMove(ten, 'm9', 10)).toEqual({ percentile: 0, kind: 'blunder' });
  });
  it('skips forced or unscored moves', () => {
    expect(classifyMove(ten.slice(0, 4), 'm0', 4)).toBeNull();
    expect(classifyMove(ten, 'zz', 10)).toBeNull();
    expect(classifyMove([], 'm0', 10)).toBeNull();
  });
});

describe('ChessStatsLedger', () => {
  it('averages accuracy, counts kinds, merges by case and persists to postgres', async () => {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool();
    const ledger = new ChessStatsLedger();
    expect(await ledger.attach(new PgChessStatsStore(pool))).toBe(true);
    ledger.record('Ann', { percentile: 100, kind: 'brilliant' });
    ledger.record('ann', { percentile: 0, kind: 'blunder' });
    await ledger.flush();
    expect(ledger.statsFor('ANN')).toEqual({ moves: 2, accuracy: 50, brilliant: 1, great: 0, mistake: 0, blunder: 1 });
    const saved = await new PgChessStatsStore(pool).loadAll();
    expect(saved).toEqual([{ key: 'ann', name: 'ann', moves: 2, percentileSum: 100, brilliant: 1, great: 0, mistake: 0, blunder: 1 }]);
    expect(ledger.statsFor('nobody')).toEqual({ moves: 0, accuracy: null, brilliant: 0, great: 0, mistake: 0, blunder: 0 });
  });
});

describe('sortChess', () => {
  it('sorts by column and keeps missing accuracy last', () => {
    const rows = [{ name: 'A', accuracy: 40 }, { name: 'B', accuracy: null }, { name: 'C', accuracy: 90 }];
    expect(sortChess(rows, 'accuracy', 'desc').map((r) => r.name)).toEqual(['C', 'A', 'B']);
    expect(sortChess(rows, 'accuracy', 'asc').map((r) => r.name)).toEqual(['A', 'C', 'B']);
    expect(sortChess(rows, 'name', 'desc').map((r) => r.name)).toEqual(['C', 'B', 'A']);
  });
});
