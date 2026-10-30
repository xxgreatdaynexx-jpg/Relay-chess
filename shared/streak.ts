import type { MoveGrade, StreakKind } from './types.js';

/** Best-move marks in a row before the double clip fires. */
export const DOUBLE_LENGTH = 5;

/** Best-move marks in a row before the on-fire banner fires. */
export const STREAK_LENGTH = 6;

/**
 * Update one player's best-move streak.
 * A brilliant move counts. The fifth in a row is a double, the sixth is
 * on fire and the count resets so the cycle can repeat.
 * Any other graded move clears that player.
 * Fewer than five legal moves are forced, so they neither count nor clear.
 * Other players' entries are left alone.
 */
export function recordStreak<Player extends string>(
  streaks: Map<Player, number>,
  player: Player,
  grade: MoveGrade | null,
  legalCount: number,
): StreakKind | null {
  if (legalCount < 5) return null;
  if (grade !== 'brilliant') {
    streaks.set(player, 0);
    return null;
  }
  const next = (streaks.get(player) ?? 0) + 1;
  if (next >= STREAK_LENGTH) {
    streaks.set(player, 0);
    return 'streak';
  }
  streaks.set(player, next);
  return next === DOUBLE_LENGTH ? 'double' : null;
}
