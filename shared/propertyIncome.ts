/** Seven calendar days of gross income repay the city-paid deed basis (including land surcharge).
 * Hostile buyout premiums are player-to-player transfers, not new investment paid to the city.
 * Ordinary property / purchase taxes remain separate. No new income fee, operating cost or payback cap. */
import { propertyById } from './realEstate.js';
export const PROPERTY_PAYBACK_MS = 7 * 24 * 60 * 60_000;
export const PROPERTY_INCOME_EVERY_MS = 10 * 60_000;
export const incomeEligible = (id: unknown) => {
  const p = propertyById(id); return !!p && ['gas', 'depot', 'warehouse'].includes(p.type);
};
/** Same anti-circular-buyout basis as city sell-back: a premium paid to another player cannot raise minting. */
export const incomeBasisOf = (paid: number, cityPaid?: number | null) => Math.min(paid, cityPaid ?? paid);
/** Integer cumulative entitlement preserves every fractional chip across ticks/restarts. */
export function incomeEntitlement(basis: number, start: number, now: number): bigint {
  if (!Number.isSafeInteger(basis) || basis <= 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(now)) throw Error('Invalid property income basis/time');
  return BigInt(basis) * BigInt(Math.max(0, now - start)) / BigInt(PROPERTY_PAYBACK_MS);
}
