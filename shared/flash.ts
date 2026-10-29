export const OPENING_FLASH_MS = 2600;
export const BLUNDER_FLASH_MS = 2000;

export interface TimedMark {
  ply: number;
  at: number;
}

export function flashIsFresh(mark: TimedMark | null, ply: number, serverNow: number, windowMs: number): boolean {
  if (!mark || mark.ply !== ply) return false;
  const age = serverNow - mark.at;
  return age >= 0 && age <= windowMs;
}
