/**
 * Nightly 10x reward event (request #35, chessguy2). Every night from 8:00 to 9:00 PM Alberta time (02:00–03:00 UTC,
 * Alberta stays on UTC-6 all year) one game is picked at random from chess, checkers, arena and poker. During that hour
 * winners of the picked game get paid 10x what they won: the normal payout plus a 9x house bonus, paid through the
 * wallet + ledger (game 'nightly_10x'). Caps keep it from being farmed with alts: the bonus per win and the bonus per
 * player per night are capped (base chips × price index). Casino odds, rakes and stakes are untouched.
 *
 * The pick is a deterministic hash of the night's date, so every server instance agrees and restarts can't reroll it.
 */
export type NightlyGame = 'chess' | 'checkers' | 'arena' | 'poker';
export const NIGHTLY_GAMES: NightlyGame[] = ['chess', 'checkers', 'arena', 'poker'];
export const NIGHTLY_LABEL: Record<NightlyGame, string> = { chess: '♟ Chess', checkers: '⛀ Checkers', arena: '🔫 Arena', poker: '🃏 Poker' };
export const NIGHTLY_MULT = 10;
/** Start hour (UTC) and length of the nightly window: 02:00 UTC = 8:00 PM Alberta (UTC-6). */
export const NIGHTLY_START_UTC_HOUR = 2, NIGHTLY_LEN_MS = 60 * 60 * 1000;
/** Caps on the extra (9x) bonus, in base chips (× price index on the server). */
export const NIGHTLY_BONUS_CAP_PER_WIN = 25_000, NIGHTLY_BONUS_CAP_PER_NIGHT = 100_000;
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; };
/** The game for the event that starts on UTC day `day` (YYYY-MM-DD). */
export const nightlyGameFor = (day: string): NightlyGame => NIGHTLY_GAMES[hash(`chud-nightly:${day}`) % NIGHTLY_GAMES.length]!;
export interface NightlyEvent { game: NightlyGame; startsAt: number; endsAt: number; active: boolean; day: string }
/** The event that is live now, or the next one coming up. */
export function nightlyEvent(now: number): NightlyEvent {
  const d = new Date(now); const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), NIGHTLY_START_UTC_HOUR);
  const s = now < start + NIGHTLY_LEN_MS ? start : start + 86_400_000;
  const day = new Date(s).toISOString().slice(0, 10);
  return { game: nightlyGameFor(day), startsAt: s, endsAt: s + NIGHTLY_LEN_MS, active: now >= s && now < s + NIGHTLY_LEN_MS, day };
}
/** Extra bonus (on top of the normal win) for a net win, given what the player already got tonight. */
export const nightlyBonus = (netWin: number, alreadyTonight: number, perWinCap: number, perNightCap: number) =>
  Math.max(0, Math.min(Math.floor(netWin) * (NIGHTLY_MULT - 1), perWinCap, perNightCap - alreadyTonight));
