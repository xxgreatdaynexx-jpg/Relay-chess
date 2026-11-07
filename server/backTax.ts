/** Dayne Nov 7: historical back-tax permanently canceled, including unpaid assessments.
 * Compatibility events remain harmless for cached clients. Never reconstruct debt with the new surcharge rate.
 * Refunds are a separate explicit ledger-audited admin operation (backTaxRefund.ts), never an automatic boot write.
 */
export const BACKTAX_GAME = 'property_backtax';
export const BACKTAX_SHARE_GAME = 'property_backtax_share';
export const BACKTAX_CUTOFF = Date.parse('2026-11-05T01:30:00Z');
export const WTAX_START = Date.parse('2026-11-04T17:28:00Z');
export const HISTORICAL_BACKTAX_CANCELED = true;
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> };
export type BackTax = { debt: number; surcharge: number; wealthTax: number; paid: number; buys: number };
export class BackTaxError extends Error {}
export async function backTaxOf(_db: Q, _name: string): Promise<BackTax> {
  return { debt: 0, surcharge: 0, wealthTax: 0, paid: 0, buys: 0 };
}
export const backTaxBlockMsg = (_b: BackTax) => 'Historical property back-tax is canceled.';
export async function backTaxMoves(db: Q, name: string, _now = Date.now()) {
  return { b: await backTaxOf(db, name), moves: [] as Array<{ name: string; amount: number; key: string; game: string; memo?: string }> };
}
