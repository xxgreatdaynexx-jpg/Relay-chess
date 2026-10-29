import type { MoveGrade } from './types.js';

/** Best-move marks in a row before the streak banner fires. */
export const STREAK_LENGTH = 3;

/**
 * Update one player's best-move streak.
 * A brilliant move counts. Any other graded move clears that player.
 * Fewer than five legal moves are forced, so they neither count nor clear.
 * Firing resets the count so the next three can fire again.
 * Other players' entries are left alone.
 */
export function recordStreak<Player extends string>(
  streaks: Map<Player, number>,
  player: Player,
  grade: MoveGrade | null,
  legalCount: number,
): boolean {
  if (legalCount < 5) return false;
  if (grade !== 'brilliant') {
    streaks.set(player, 0);
    return false;
  }
  const next = (streaks.get(player) ?? 0) + 1;
  if (next >= STREAK_LENGTH) {
    streaks.set(player, 0);
    return true;
  }
  streaks.set(player, next);
  return false;
}
