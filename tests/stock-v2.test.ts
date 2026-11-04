import { describe, expect, it } from 'vitest';
import { toCandles, intervalMs, defaultInterval, seriesChange } from '../shared/stockStats';
import { GLOSSARY, TERM } from '../shared/stockGlossary';

describe('MU #9 v2 candles', () => {
  it('buckets OHLC and joins bodies', () => {
    const H = 3_600_000;
    const c = toCandles([[0, 10], [600_000, 12], [1_200_000, 9], [H, 11], [H + 600_000, 13]], H, [[100, 5], [H + 1, 7]]);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ o: 10, h: 12, l: 9, c: 9, v: 5 });
    expect(c[1]).toMatchObject({ o: 9, h: 13, l: 9, c: 13, v: 7 });
  });
  it('intervals', () => { expect(intervalMs('4h')).toBe(4 * 3_600_000); expect(intervalMs('bad')).toBe(3_600_000); expect(defaultInterval('1d')).toBe('10m'); });
  it('24h badge equals the 1D chart change', () => { expect(seriesChange([[0, 100], [1, 105]]).pct).toBe(5); });
});
describe('MU #9 v2 glossary', () => {
  it('has unique ids and every stat explainer used in the grid', () => {
    expect(new Set(GLOSSARY.map((t) => t.id)).size).toBe(GLOSSARY.length);
    for (const id of ['cap', 'pe', 'eps', 'yield', 'open', 'dayRange', 'volume', 'avgVolume', 'beta', 'volatility', 'realizedVol', 'sharesOut', 'range30', 'chg24', 'candle']) expect(TERM.get(id)?.short).toBeTruthy();
  });
});
