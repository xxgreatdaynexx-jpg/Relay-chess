/** Independently priced footprints for every existing physical barn. Origin field is LOCATION ONLY, never ownership. */
import { BARNS } from './farm.js';
import { bigFarms } from './bigFarms.js';
import { outskirts } from './outskirts.js';
export const BARN_COST_PER_SQUARE = 250; // 15,000 for a 60-square building: comparable to the basic 15,000-chip house.
export const barnPrice = (b: { w: number; d: number }) => Math.round(b.w * b.d * BARN_COST_PER_SQUARE / 500) * 500;
export function farmBarns() {
  const district = BARNS.map((b, i) => ({ ...b, id: `barn:district:${i + 1}`, label: `Barn by Farm plot #${i === 0 ? 10 : 20}`, family: 'district' as const }));
  // Includes the surviving barn beside former cf:23: its OWN footprint passed the existing jail clearance filter.
  const country = outskirts().buildings.filter((b) => b.kind === 'barn' && b.farmId)
    .map((b) => ({ ...b, id: `barn:country:${b.farmId!.slice(3)}`, label: `Countryside barn #${Number(b.farmId!.slice(3)) + 1}`, family: 'country' as const }));
  const big = bigFarms().map((f) => ({ ...f.barn, rot: 0, id: `barn:big:${f.n}`, label: `Barn by Big Farm #${f.n - 999}`, family: 'big' as const }));
  return [...district, ...country, ...big];
}
