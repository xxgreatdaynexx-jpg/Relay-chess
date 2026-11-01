/**
 * Chud Hub price index: one multiplier applied to house-set payouts (Arena, Mines, daily bonus) AND house-set
 * expenses (spawn costs, factory buildings/machines), so purchasing power stays roughly constant.
 * Casino games, player-set market prices and stocks are NOT indexed.
 *
 * Damping (feedback-loop safety): indexed payouts mint more nominal chips, which reads as inflation next day.
 *  - raw daily rate = (cash today - cash yesterday - admin grants/debits) / cash yesterday
 *  - raw rate clipped to ±RAW_CLIP before smoothing (one whale day can't spike it)
 *  - EMA with alpha = 2/(EMA_DAYS+1)
 *  - only PASS_THROUGH of the smoothed rate moves the index
 *  - the applied daily change is capped at ±MAX_DAILY
 *  - the index never goes below FLOOR (deflation allowed only back down to 1.00) or above CEIL
 */
export const PI_EMA_DAYS = 5;
export const PI_PASS_THROUGH = 0.5;
export const PI_RAW_CLIP = 0.25;
export const PI_MAX_DAILY = 0.03;
export const PI_FLOOR = 1.0;
export const PI_CEIL = 10;

export interface IndexState { index: number; ema: number | null }
export interface IndexStep { index: number; ema: number; raw: number; applied: number }

const clip = (x: number, a: number) => Math.max(-a, Math.min(a, x));

/** One UTC day forward from `prev`, given that day's raw cash growth rate (fraction, e.g. 0.10 = 10%). */
export function stepIndex(prev: IndexState, raw: number | null): IndexStep {
  const r = raw == null || !Number.isFinite(raw) ? 0 : clip(raw, PI_RAW_CLIP);
  const a = 2 / (PI_EMA_DAYS + 1);
  const ema = prev.ema == null ? r : a * r + (1 - a) * prev.ema;
  const want = clip(ema * PI_PASS_THROUGH, PI_MAX_DAILY);
  const index = Math.min(PI_CEIL, Math.max(PI_FLOOR, Math.round(prev.index * (1 + want) * 10000) / 10000));
  return { index, ema, raw: r, applied: prev.index ? index / prev.index - 1 : 0 };
}

/** Scale a house-set chip amount by the index (whole chips, never below 1 when the base is positive). */
export function indexed(base: number, index: number): number {
  if (!(base > 0)) return base;
  return Math.max(1, Math.round(base * (Number.isFinite(index) && index > 0 ? index : 1)));
}

export function fmtIndex(index: number, appliedPct: number | null): string {
  const p = appliedPct == null ? '' : ` (${appliedPct >= 0 ? '+' : ''}${appliedPct.toFixed(1)}% today)`;
  return `Prices & payouts: x${index.toFixed(2)}${p}`;
}
