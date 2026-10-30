export interface ArenaRow { name: string; kills: number; deaths: number; kd: number; bestStreak: number; nukes: number; matches: number; rounds: number }
export type ArenaSort = 'kills' | 'deaths' | 'kd' | 'bestStreak' | 'nukes' | 'matches' | 'rounds';
export const ARENA_COLS: Array<[ArenaSort, string, string]> = [
  ['kills', 'Kills', 'K'], ['deaths', 'Deaths', 'D'], ['kd', 'K/D', 'K/D'], ['bestStreak', 'Best streak', 'Strk'],
  ['nukes', 'Nukes', '☢'], ['matches', 'Matches', 'M'], ['rounds', 'Rounds', 'R'],
];
/** Sort rows by a column, highest first; ties fall back to kills then name. Deaths sort lowest first. */
export function sortArena(rows: ArenaRow[], key: ArenaSort): ArenaRow[] {
  const dir = key === 'deaths' ? -1 : 1;
  return [...rows].sort((a, b) => dir * (b[key] - a[key]) || b.kills - a.kills || a.name.localeCompare(b.name));
}

