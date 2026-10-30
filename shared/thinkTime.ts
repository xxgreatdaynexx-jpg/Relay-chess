import type { Seat, ThinkTime } from './types.js';

export interface ThinkRow extends ThinkTime {
  /** Total including any think still in progress. */
  usedMs: number;
  averageMs: number;
}

/** Players ranked by most thinking time used. `extraMs` advances the live think. */
export function rankThinkTimes(times: ThinkTime[], extraMs = 0): ThinkRow[] {
  return times
    .map((t) => {
      const current = t.currentMs > 0 ? t.currentMs + Math.max(0, extraMs) : 0;
      const usedMs = t.totalMs + current;
      return {
        ...t,
        currentMs: current,
        usedMs,
        longestMs: Math.max(t.longestMs, current),
        averageMs: t.moves > 0 ? Math.round(t.totalMs / t.moves) : 0,
      };
    })
    .sort((a, b) => b.usedMs - a.usedMs || a.seat.localeCompare(b.seat));
}

/** The seat that has used the most time, or null when nobody has used any (or it is tied). */
export function slowestSeat(times: ThinkTime[], extraMs = 0): Seat | null {
  const ranked = rankThinkTimes(times, extraMs);
  if (ranked.length === 0 || ranked[0].usedMs < 1000) return null;
  if (ranked[1] && ranked[1].usedMs === ranked[0].usedMs) return null;
  return ranked[0].seat;
}

export function formatThink(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
