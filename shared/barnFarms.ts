/** Big Farms are the catalog's purchasable barn bundle (cf:1000+); decorative barns confer no ownership. */
import { bigFarms } from './bigFarms.js';
import { propertyById, type OwnedProperty } from './realEstate.js';
export const isBarnProperty = (id: string) => bigFarms().some((f) => id === `cf:${f.n}`);
export function barnFarms(me: string | null, owned: Iterable<OwnedProperty>) {
  const key = me?.trim().toLowerCase();
  const mine = key ? [...owned].filter((o) => o.owner.trim().toLowerCase() === key) : [];
  const unlocked = mine.some((o) => isBarnProperty(o.id));
  const groups = (['city', 'resort'] as const).map((map) => ({ map, label: map === 'city' ? 'Chud City (including countryside)' : 'Chud Resort',
    farms: unlocked ? mine.map((o) => propertyById(o.id)).filter((p) => p?.kind === 'farm' && (p.map ?? 'city') === map).sort((a, b) => a!.label.localeCompare(b!.label)) : [],
  }));
  return { unlocked, groups };
}
