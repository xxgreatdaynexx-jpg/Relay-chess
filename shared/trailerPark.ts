/**
 * Trailer Park: one trailer per real player. ALL exclusions live here so they're easy to adjust.
 * A player is excluded when the first matching rule below applies (the reason is shown in the admin preview).
 */
import { isQaName } from './qa.js';

/** Accounts excluded by name (lower-case key → reason). Add or remove names here. */
export const TRAILER_EXCLUDED_NAMES: Readonly<Record<string, string>> = {
  chessgawd: 'cheat account (built-in chess engine hints)',
  arenagawd: 'cheat account (built-in Arena wallhack/aim assist)',
};
/** Also exclude anyone the Arena anti-cheat has flagged (arena_flags table). Set false to ignore flags. */
export const EXCLUDE_ARENA_FLAGGED = true;
/** Junk accounts whose whole name is one character, like "7" or the "A", "C" … "O" batch someone made. */
export const isSingleCharName = (name: string) => [...name.trim()].length === 1;

export function trailerExclusion(name: string, arenaFlags: readonly string[] = []): string | null {
  const key = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (isQaName(name)) return 'QA test account';
  if (isSingleCharName(name)) return 'single-character junk account';
  if (TRAILER_EXCLUDED_NAMES[key]) return TRAILER_EXCLUDED_NAMES[key];
  if (EXCLUDE_ARENA_FLAGGED && arenaFlags.length) return `Arena anti-cheat flags (${[...new Set(arenaFlags)].join(', ')})`;
  return null;
}

/** When false the public park is empty (lots aren't shown or assigned) — admin preview still works. */
export const TRAILER_PARK_LIVE = true;

export interface TrailerLot { lot: number; name: string }
