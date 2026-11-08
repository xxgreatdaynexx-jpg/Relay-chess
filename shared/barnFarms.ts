/** All physical farm barns are bundled with their existing field deed; no separate barn purchase or price. */
import { farmBarns } from './farmBarns.js';
import { propertyById, type OwnedProperty } from './realEstate.js';
export const isBarnProperty = (id: string) => farmBarns().some((b) => id === b.farmId);
export function barnFarms(me: string | null, owned: Iterable<OwnedProperty>) {
  const key = me?.trim().toLowerCase();
  const mine = key ? [...owned].filter((o) => o.owner.trim().toLowerCase() === key) : [];
  const unlocked = mine.some((o) => isBarnProperty(o.id));
  const groups = (['city', 'resort'] as const).map((map) => ({ map, label: map === 'city' ? 'Chud City (including countryside)' : 'Chud Resort',
    farms: unlocked ? mine.map((o) => propertyById(o.id)).filter((p) => p?.kind === 'farm' && (p.map ?? 'city') === map).sort((a, b) => a!.label.localeCompare(b!.label)) : [],
  }));
  return { unlocked, groups };
}
