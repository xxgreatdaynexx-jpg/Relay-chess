/**
 * Sink room (pt1405u): chips a player LOST to the economy today free up room under their daily house-sell cap.
 * Only chips that leave the economy count. Player-to-player moves never count.
 */
/** House casino games: count today's NET loss per game (wins offset losses). */
export const SINK_NET_GAMES = new Set(['blackjack', 'roulette', 'slots', 'video-poker', 'solitro', 'casino']);
/** House purchases, fees, taxes and removals: every debit counts (credits in the same game, e.g. house sales, don't offset). */
/** House debits that free room (Dayne, Nov 2): admin, wealth tax, cars, car mods, property tax, resort tickets, race entries, mayor filing, private-jet upkeep (#11) and yacht/superyacht upkeep (NOT jet/boat purchases, which sell back at 70%), furniture (Millionaire Update: no resale, so it is a pure burn). NOT: property purchases, farm seeds/upgrades, mine tools, factory builds, groceries, wages, hiring. */
export const SINK_DEBIT_GAMES = new Set(['car_buy', 'car_mod', 'property_tax', 'resort_ticket', 'fortmc_ticket', 'fortmc_upkeep', 'race_entry', 'mayor_filing', 'admin', 'wealth_tax', 'jet_upkeep', 'boat_upkeep', 'furniture_buy']);
/** Player-to-player market: only the burned fee (in the seller's "Sold … (N fee)" memo) counts. */
export const MARKET_GAME = 'market';

export type LedgerRow = { game: string; amount: number; memo?: string | null };
const FEE_RE = /\((\d+) fee\)/;

/** Chips this player lost to sinks over a set of today's ledger rows. */
export function sinkLoss(rows: LedgerRow[]): number {
  const net = new Map<string, number>(); let lost = 0;
  for (const r of rows) {
    if (SINK_NET_GAMES.has(r.game)) net.set(r.game, (net.get(r.game) ?? 0) + r.amount);
    else if (SINK_DEBIT_GAMES.has(r.game)) { if (r.amount < 0) lost -= r.amount; }
    else if (r.game === MARKET_GAME && r.amount > 0) { const m = r.memo ? FEE_RE.exec(r.memo) : null; if (m) lost += Number(m[1]); }
  }
  for (const v of net.values()) if (v < 0) lost -= v;
  return lost;
}

/** Running per-day accumulator (same result as sinkLoss over the day's rows, updated one row at a time). */
export class SinkDay {
  day = ''; private net = new Map<string, number>(); private flat = 0;
  add(day: string, r: LedgerRow) {
    if (day !== this.day) { this.day = day; this.net.clear(); this.flat = 0; }
    if (SINK_NET_GAMES.has(r.game)) this.net.set(r.game, (this.net.get(r.game) ?? 0) + r.amount);
    else this.flat += sinkLoss([r]);
  }
  lost(day: string) { if (day !== this.day) return 0; let l = this.flat; for (const v of this.net.values()) if (v < 0) l -= v; return l; }
}

/** Effective "already sold" (base chips) once lost chips (converted to base by the price index) free up room; may go
 * negative, so remaining room is at most cap + lost. */
export const effectiveAlready = (already: number, lostChips: number, index: number) => already - Math.floor(lostChips / (index || 1));
