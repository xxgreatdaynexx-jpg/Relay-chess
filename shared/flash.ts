export const OPENING_FLASH_MS = 2600;
export const BLUNDER_FLASH_MS = 2000;
export const CHAD_FLASH_MS = 2000;
export const BOOM_FLASH_MS = 1800;
export const FORK_FLASH_MS = 1500;
export const FORK_SOUND_DELAY_MS = 240;
export const FORK_SOUND_WAIT_MS = 520;
/** Gap so a queen's own capture clip starts after another effect on the same move. */
export const QUEEN_CAPTURE_SOUND_DELAY_MS = 240;
/** Gap so the mate-in-one clip starts after the other effects on that move. */
export const MATE_IN_ONE_SOUND_DELAY_MS = 240;
export const POOF_FLASH_MS = 1200;
export const DOUBLE_FLASH_MS = 1500;
export const STREAK_FLASH_MS = 2000;
/** Start the streak clip after the brilliant-move "nice" so the two don't pile up. */
export const STREAK_SOUND_DELAY_MS = 520;
/** How long a bailout teleport can still sparkle after the server applied it. */
export const POOF_HOLD_MS = 6000;

export interface TimedMark {
  ply: number;
  at: number;
}

export function flashIsFresh(mark: TimedMark | null, ply: number, serverNow: number, windowMs: number): boolean {
  if (!mark || mark.ply !== ply) return false;
  const age = serverNow - mark.at;
  return age >= 0 && age <= windowMs;
}
