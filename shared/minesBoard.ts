/** Mining leaderboard: periods are UTC (same clock as the Mines daily sell cap). */
export type MinePeriod = 'today' | 'week' | 'all';
export type MineMetric = 'chips' | 'ore' | 'haul';
export const MINE_PERIODS: Array<[MinePeriod, string]> = [['today', 'Today'], ['week', 'This week'], ['all', 'All time']];
export const MINE_METRICS: Array<[MineMetric, string, string]> = [
  ['chips', 'Chips earned', 'Chips paid by the house for ore and factory goods'],
  ['ore', 'Ore mined', 'Ore banked at the EXIT lift'],
  ['haul', 'Best haul', 'Most valuable single trip banked at the EXIT lift'],
];
export interface MineBoardRow { name: string; chips: number; ore: number; haul: number }
export const isMinePeriod = (v: unknown): v is MinePeriod => v === 'today' || v === 'week' || v === 'all';
/** Start (ms) of the period containing `now`: UTC midnight, or Monday 00:00 UTC for the week. */
export function periodStart(period: MinePeriod, now: number): number {
  if (period === 'all') return 0;
  const d = new Date(now); const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return period === 'today' ? day : day - ((d.getUTCDay() + 6) % 7) * 86_400_000;
}
