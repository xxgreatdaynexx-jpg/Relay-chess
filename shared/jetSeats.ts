/**
 * Jet passenger seats (Millionaire Update, mu-jet-seats). A jet owner opens boarding for a flight (to any jet
 * destination, or home to Chud City); nearby/online players request a seat; the owner accepts or declines each one.
 * Seats scale with the jet tier. Passengers fly free or pay the owner a capped seat price (wallet + ledger).
 */
export const JET_SEATS: Record<string, number> = { citation: 2, g700: 6, chudone: 12 };
export const jetSeats = (model: string) => JET_SEATS[model] ?? 0;
/** Max seat price, BASE chips (the server caps at px(MAX_SEAT_PRICE)). */
export const MAX_SEAT_PRICE = 2_000;
/** A seat request the owner has not answered expires after this long. */
export const SEAT_REQUEST_TTL_MS = 60_000;
/** Open boarding that never departs closes (and refunds) after this long. */
export const BOARDING_TTL_MS = 10 * 60_000;
export type SeatStatus = 'pending' | 'seated';
export interface BoardingView {
  id: string; owner: string; jet: string; model: string; from: 'city' | 'resort' | 'fortmc'; to: 'city' | 'resort' | 'fortmc';
  seats: number; price: number; openedAt: number; expiresAt: number;
  seated: string[]; pending: Array<{ name: string; at: number; expiresAt: number }>;
}
