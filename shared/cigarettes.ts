/** Cigarettes: a rare fishing drop you can smoke at the casino for a short winnings buff. */
export const CIGARETTE_ID = 'cigarette';
export const CIGARETTE_ITEM = 'good:cigarette';
export const CIGARETTE_NAME = 'Cigarette';
/** House list price: tobacco seed 30 × 1.35 raw crop × 1.08 one mill step. */
export const CIGARETTE_PRICE = 43.74;
export const CIGARETTE_COLOR = '#d8c8b0';
/** Chance a landed catch also grants one cigarette (rolled on the server, independent of the fish). */
export const CIGARETTE_DROP_RATE = 0.015;
export const CIGARETTE_BUFF_MS = 3 * 60_000;
export const CIGARETTE_BUFF_MAX_MS = 15 * 60_000;
export const CIGARETTE_BUFF_RATE = 0.10;
/** Extra chips from the buff, per UTC day (00:00 UTC / 6 PM). */
export const CIGARETTE_DAILY_CAP = 25_000;
export const CIGARETTE_GAMES = ['roulette', 'blackjack', 'holdem', 'slots', 'video-poker'] as const;
export type CigaretteGame = (typeof CIGARETTE_GAMES)[number];
export const isCigaretteGame = (g: string): g is CigaretteGame => (CIGARETTE_GAMES as readonly string[]).includes(g);

/** House-paid bonus on a net win only. Never applied to a loss or a push. */
export function cigaretteBonus(netWin: number, paidToday: number, cap = CIGARETTE_DAILY_CAP, rate = CIGARETTE_BUFF_RATE): number {
  if (!Number.isFinite(netWin) || netWin <= 0) return 0;
  const want = Math.floor(netWin * rate);
  return Math.max(0, Math.min(want, Math.max(0, Math.floor(cap) - Math.max(0, Math.floor(paidToday)))));
}

/** Smoking while the buff is active extends it; the remaining time never exceeds `max`. */
export function extendCigaretteBuff(until: number, now: number, add = CIGARETTE_BUFF_MS, max = CIGARETTE_BUFF_MAX_MS): number {
  const base = until > now ? until : now;
  return Math.min(base + add, now + max);
}

export const cigaretteDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export interface CigaretteView {
  qty: number;
  until: number;
  paid: number;
  cap: number;
  rate: number;
  durationMs: number;
  maxMs: number;
  serverNow: number;
}
