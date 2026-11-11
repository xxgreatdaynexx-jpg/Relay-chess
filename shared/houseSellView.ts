/**
 * House "Sell to the house" status line, in chips (today's price index), from the server quote.
 * Sales are tracked server-side in base units (chips / price index); the cap shown to players is in chips.
 * Every figure here converts the same way the server does, so "sold", "room left" and "paying %" agree
 * with server enforcement (payoutFor(gross, effAlready, capBase)).
 */
export type HouseSellQuote = { already: number; effAlready?: number; lost?: number; capBase: number; index: number };
export type HouseSellStatus = {
  /** House gross sold today, in chips. */
  soldChips: number;
  /** Room refunded by chips lost to house sinks today, in chips. */
  refunded: number;
  /** Sold today minus refunded room, in chips (what counts against the cap). */
  countedChips: number;
  /** Full-price room left today, in chips. */
  leftChips: number;
  /** 1 while there is room left under the cap, else 0. */
  rate: number;
};

export function houseSellStatus(q: HouseSellQuote): HouseSellStatus {
  const idx = q.index > 0 ? q.index : 1;
  const eff = q.effAlready ?? q.already;
  const room = q.capBase - eff;
  return {
    soldChips: Math.floor(q.already * idx),
    refunded: Math.floor(Math.max(0, q.lost ?? 0)),
    countedChips: Math.max(0, Math.floor(eff * idx)),
    leftChips: Math.max(0, Math.floor(room * idx)),
    rate: room > 0 ? 1 : 0,
  };
}
