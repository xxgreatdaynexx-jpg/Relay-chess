import { isHomeProperty } from '../../../shared/homes';
import { propertyById, type OwnedProperty } from '../../../shared/realEstate';

/** Apply owned-property diamonds and home owner tags to a 3D world. Must run after every
 *  createWorld, not only when `owned`/`loading` change: switching 2D→3D (or any remount)
 *  leaves `loading` already false, so the effect would skip the new world and owned
 *  markers would never appear. */
export function applyWorldOwned(
  world: { setOwned: (ids: string[]) => void; setOwnerLabels: (list: Array<{ id: string; owner: string }>) => void } | null,
  owned: Map<string, OwnedProperty>,
) {
  if (!world) return;
  world.setOwned([...owned.keys()]);
  world.setOwnerLabels([...owned.values()].filter((o) => isHomeProperty(propertyById(o.id))).map((o) => ({ id: o.id, owner: o.owner })));
}
