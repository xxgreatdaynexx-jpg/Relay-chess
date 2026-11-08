/**
 * Purchase wealth tax (Dayne, Nov 4 2026). A buyer who already holds MORE than 100,000 in property (sum of the prices
 * they actually paid) pays 5% of the purchase price ON TOP of the price, on every taxed purchase while they stay above
 * the line. Taxed: property, cars and other big-ticket assets; items under 1,000 chips and casino bets are exempt.
 * 25% of the tax goes to the city treasury (pt2032u); the rest is shared equally among the other active players (ledger activity in the last 7 days; QA, guest/bot and jailed
 * accounts excluded), in player-key order with the rounding remainder going 1 chip each to the first recipients, so the
 * total is conserved exactly. Nobody to share with = no tax (redistributed, never burned). Separate from the daily
 * net-worth wealth tax (shared/wealthTax.ts), which still runs.
 */
import { split } from './wealthTax.js';

export const PURCHASE_TAX_RATE = 0.05;
export const PURCHASE_TAX_THRESHOLD = 100_000;
export const PURCHASE_TAX_MIN_PRICE = 1_000;
export const PURCHASE_TAX_GAME = 'wealth_tax_buy';
export const PURCHASE_SHARE_GAME = 'wealth_tax_share';

/** Tax on one purchase (rounded up), or 0 when the buyer is at/below the line or the item is under the minimum. */
/** rate = the mayor's purchase wealth tax lever (3..7%, shared/city.ts), default 5%. */
export const purchaseTaxOf = (propertyValue: number, price: number, rate = PURCHASE_TAX_RATE): number =>
  propertyValue > PURCHASE_TAX_THRESHOLD && price >= PURCHASE_TAX_MIN_PRICE ? Math.ceil(price * Math.min(0.07, Math.max(0.03, rate)) - 1e-6) : 0;

/** Equal split over recipients (already sorted and filtered); the remainder goes 1 chip each to the first ones. */
export const purchaseShares = (total: number, recipients: string[]) => split(total, recipients);

export const purchaseTaxLine = (tax: number, n: number, rate = PURCHASE_TAX_RATE, treasury = 0) =>
  `Wealth tax ${Math.round(rate * 100)}%: ${tax.toLocaleString('en-US')} chips, ${treasury > 0 ? `${treasury.toLocaleString('en-US')} to the city treasury, the rest ` : ''}shared with ${n.toLocaleString('en-US')} player${n === 1 ? '' : 's'}`;

export type PurchaseTaxQuote = { tax: number; recipients: number; propertyValue: number; line: string; treasury?: number };
