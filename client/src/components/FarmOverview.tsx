import { FarmStatusSummary, useBarnFarmStatus } from './BarnFarmStatus';
import { barnFarms } from '../../../shared/barnFarms';
import type { OwnedProperty } from '../../../shared/realEstate';
import { MapSheet } from './MapSheet';
type Ownership = { me: string | null; owned: Map<string, OwnedProperty> };
export function FarmOverviewButton({ me, owned, onOpen }: Ownership & { onOpen: () => void }) {
  return barnFarms(me, owned.values()).unlocked ? <button type="button" onClick={onOpen} data-testid="all-farms-open">🏡 Barn · All my farms</button> : null;
}
/** Navigation only: no harvest, stock transfers or cross-map farm actions are introduced here. */
export function FarmOverview({ me, owned, map, onOpenFarm, onClose }: Ownership & { map: 'city' | 'resort'; onOpenFarm: (id: string) => void; onClose: () => void }) {
  const { unlocked, groups } = barnFarms(me, owned.values());
  const status = useBarnFarmStatus(me, unlocked, groups.flatMap((g) => g.farms.flatMap((p) => p ? [p.id] : [])));
  return <MapSheet className="world-deed world-deeds farm-overview" data-testid="all-farms">
    <button type="button" className="world-deed-x" aria-label="Close" onClick={onClose}>✕</button>
    <h3>🏡 Barn · All my farms</h3>
    {!unlocked ? <small>Purchase a separate barn deed to unlock this overview. Your usual individual farm access is unchanged.</small> : <>
      <small>Your separately owned barn brings your own farms into one menu. Farm ownership alone does not include a barn. Inventories stay separate by map. Travel before opening a farm on another map.</small>
      {status.error && <small role="status">{status.error}</small>}
      {groups.map((g) => <section key={g.map} data-testid={`all-farms-${g.map}`}><h4>{g.label}</h4>
        {!g.farms.length && <small>No farms owned here.</small>}
        {g.farms.map((p) => p && <p key={p.id}><button type="button" data-testid={`all-farms-${p.id}`} disabled={g.map !== map}
          onClick={() => { if (g.map === map) onOpenFarm(p.id); }}>{p.label}{g.map !== map ? ` — travel to ${g.map === 'resort' ? 'Chud Resort' : 'Chud City'} to open` : ' — Open farm'}</button>{status.plots.get(p.id) ? <FarmStatusSummary plot={status.plots.get(p.id)!} now={status.now} /> : <small className="barn-farm-status">{status.error ? 'Status unavailable' : 'Loading status…'}</small>}</p>)}
      </section>)}
    </>}
  </MapSheet>;
}
