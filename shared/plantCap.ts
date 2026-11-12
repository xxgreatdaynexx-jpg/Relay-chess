/** Planting spends seed chips and adds 100% of what was actually paid as extra house-sell cap for that cap day. */
export const PLANT_CAP_RATE = 1;
/** Extra house-cap chips for a day's seed spend (100% of chips actually charged, floored). */
export function plantCapBonusFromPaid(paid: number): number {
  if (!(paid > 0) || !Number.isFinite(paid)) return 0;
  return Math.floor(paid * PLANT_CAP_RATE);
}
/** Convert a chip bonus into house capBase units (payoutFor is in pre-index units). */
export function plantCapToBase(bonusChips: number, priceIdx: number): number {
  if (!(bonusChips > 0)) return 0;
  return bonusChips / (priceIdx > 0 ? priceIdx : 1);
}
