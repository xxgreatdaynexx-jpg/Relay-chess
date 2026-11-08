/** Barn click targets refer to EXISTING farm deeds, never a new priced property or ownership row. */
import { BARNS, farmPlots } from './farm.js';
import { bigFarms } from './bigFarms.js';
import { outskirts } from './outskirts.js';
export function farmBarns() {
  const district = BARNS.map((b, i) => {
    // The terminal field in each barnyard column: currently f:10 and f:20.
    const field = farmPlots().filter((p) => Math.abs(p.x - b.x) < b.w / 2).sort((a, z) => z.z - a.z)[0]!;
    return { ...b, id: `district-barn:${i + 1}`, farmId: `f:${field.n}`, family: 'district' as const };
  });
  const country = outskirts().buildings.filter((b) => b.kind === 'barn' && b.farmId && outskirts().fields.some((f) => `cf:${f.n}` === b.farmId))
    .map((b) => ({ ...b, id: `country-barn:${b.farmId}`, farmId: b.farmId!, family: 'country' as const }));
  const big = bigFarms().map((f) => ({ ...f.barn, rot: 0, id: `big-barn:cf:${f.n}`, farmId: `cf:${f.n}`, family: 'big' as const }));
  return [...district, ...country, ...big];
}
