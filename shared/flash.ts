export const OPENING_FLASH_MS = 2600;
export const BLUNDER_FLASH_MS = 2000;
export const CHAD_FLASH_MS = 2000;
export const BOOM_FLASH_MS = 1800;
export const FORK_FLASH_MS = 1500;
export const FORK_SOUND_DELAY_MS = 240;
export const FORK_SOUND_WAIT_MS = 520;

export interface TimedMark {
  ply: number;
  at: number;
}

export function flashIsFresh(mark: TimedMark | null, ply: number, serverNow: number, windowMs: number): boolean {
  if (!mark || mark.ply !== ply) return false;
  const age = serverNow - mark.at;
  return age >= 0 && age <= windowMs;
}
