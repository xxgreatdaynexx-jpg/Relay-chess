import { useState } from 'react';
import { FarmStatusSummary, useBarnFarmStatus } from './BarnFarmStatus';
import { barnFarms } from '../../../shared/barnFarms';
import { emptyTiles, harvestableTiles, tilesAt } from '../../../shared/barnFarmStatus';
import type { OwnedProperty } from '../../../shared/realEstate';
import { CROPS as CITY_CROPS, cropById, harvestFailedNote } from '../../../shared/farm';
import { TROPICAL_CROPS } from '../../../shared/resort';
import { indexed } from '../../../shared/priceIndex';
import { socket } from '@/lib/net';
import { MapSheet } from './MapSheet';

type Ownership = { me: string | null; owned: Map<string, OwnedProperty> };
const chips = (n: number) => n.toLocaleString('en-US');
type Ack = { ok: boolean; error?: string; harvested?: number; paid?: number; failed?: number; planted?: number; cost?: number; cleared?: number; errors?: Array<{ id: string; error: string }> };

export function FarmOverviewButton({ me, owned, onOpen }: Ownership & { onOpen: () => void }) {
  return barnFarms(me, owned.values()).unlocked ? <button type="button" onClick={onOpen} data-testid="all-farms-open">🏡 Barn · All my farms</button> : null;
}

/** Dashboard of every owned plot: crop counts, grow timers, and harvest-all / replant-all on the map you are on. */
export function FarmOverview({ me, owned, map, onOpenFarm, onClose }: Ownership & { map: 'city' | 'resort'; onOpenFarm: (id: string) => void; onClose: () => void }) {
  const { unlocked, groups } = barnFarms(me, owned.values());
  const ids = groups.flatMap((g) => g.farms.flatMap((p) => p ? [p.id] : []));
  const status = useBarnFarmStatus(me, unlocked, ids);
  const CROPS = map === 'resort' ? TROPICAL_CROPS : CITY_CROPS;
  const [seed, setSeed] = useState(CROPS[0]!.id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const crop = cropById(seed) ?? CROPS[0]!;
  const index = status.index && status.index > 0 ? status.index : 1;
  const local = groups.find((g) => g.map === map)?.farms.flatMap((p) => p ? [p] : []) ?? [];
  const localPlots = local.map((p) => ({ p, plot: status.plots.get(p.id), now: status.now }));
  const readyIds = localPlots.filter((x) => x.plot && harvestableTiles(x.plot, x.now).length).map((x) => x.p.id);
  const emptyIds = localPlots.filter((x) => x.plot && emptyTiles(x.plot, x.now).length).map((x) => x.p.id);
  const witherIds = localPlots.filter((x) => x.plot && tilesAt(x.plot, x.now, 'withered').length).map((x) => x.p.id);
  const readyN = localPlots.reduce((n, x) => n + (x.plot ? harvestableTiles(x.plot, x.now).length : 0), 0);
  const emptyN = localPlots.reduce((n, x) => n + (x.plot ? emptyTiles(x.plot, x.now).length : 0), 0);
  const witherN = localPlots.reduce((n, x) => n + (x.plot ? tilesAt(x.plot, x.now, 'withered').length : 0), 0);
  const seedCost = (n: number) => indexed(crop.seed, index) * n;
  const plantAfterHarvestN = localPlots.reduce((n, x) => {
    if (!x.plot) return n;
    return n + emptyTiles(x.plot, x.now).length + harvestableTiles(x.plot, x.now).length;
  }, 0);

  const act = (action: string, ids: string[], ok: (r: Ack) => string, extra: Record<string, unknown> = {}) => {
    if (!ids.length || busy) return;
    setBusy(true); setMsg(null);
    socket.timeout(20_000).emit('farm_dash', { action, ids, crop: seed, ...extra }, (err: Error | null, r?: Ack) => {
      setBusy(false);
      if (err) { setMsg('No answer from the server. Nothing else was changed.'); return; }
      if (!r?.ok) { setMsg(r?.error ?? 'Something went wrong.'); return; }
      const notes = (r.errors ?? []).map((e) => e.error);
      setMsg([ok(r), ...notes].filter(Boolean).join(' '));
    });
  };

  return <MapSheet className="world-deed world-deeds farm-overview" data-testid="all-farms">
    <button type="button" className="world-deed-x" aria-label="Close" onClick={onClose}>✕</button>
    <h3>🏡 Barn · All my farms</h3>
    {!unlocked ? <small>Purchase a separate barn deed to unlock this overview. Your usual individual farm access is unchanged.</small> : <>
      <small>A dashboard of every farm you own: crops, grow timers, and ripe or withered counts. Harvest, clear, and replant from here only work on the map you are on — travel first for the other map. Seeds are charged the same as planting on the field. Inventories stay separate by map.</small>
      {status.error && <small role="status">{status.error}</small>}
      {unlocked && local.length > 0 && <div className="farm-dash-tools" data-testid="all-farms-tools">
        <h4>This map</h4>
        <div className="farm-seeds" data-testid="all-farms-seeds">
          {CROPS.map((c) => <button key={c.id} type="button" className={seed === c.id ? 'on' : ''} onClick={() => setSeed(c.id)} data-testid={`all-farms-seed-${c.id}`} disabled={busy}>
            <b>{c.emoji} {c.label}</b><span>🪙{chips(indexed(c.seed, index))}</span>
          </button>)}
        </div>
        <div className="farm-dash-actions">
          <button type="button" disabled={busy || !readyN} onClick={() => act('harvest', readyIds, (r) => `Harvested ${r.harvested} for 🪙 ${chips(Number(r.paid))}.${harvestFailedNote(Number(r.failed) || 0)}`)} data-testid="all-farms-harvest-map">Harvest all {readyN || ''} ready</button>
          <button type="button" disabled={busy || !readyN} onClick={() => act('pantry', readyIds, (r) => `🧺 ${r.harvested} crop${r.harvested === 1 ? '' : 's'} into the pantry.${harvestFailedNote(Number(r.failed) || 0)}`)} data-testid="all-farms-pantry-map">All ready to pantry</button>
          <button type="button" disabled={busy || !witherN} onClick={() => act('clear', witherIds, (r) => `Cleared ${r.cleared} withered.`)} data-testid="all-farms-clear-map">Clear {witherN || ''} withered</button>
          <button type="button" disabled={busy || !emptyN} onClick={() => act('plant', emptyIds, (r) => `Planted ${r.planted} × ${crop.label} for 🪙 ${chips(Number(r.cost))}.`)} data-testid="all-farms-plant-map">Replant all {emptyN || ''} empty<span>🪙 {chips(seedCost(emptyN))}</span></button>
          <button type="button" disabled={busy || !plantAfterHarvestN} onClick={() => act('harvest_replant', local.map((p) => p.id).filter((id) => readyIds.includes(id) || emptyIds.includes(id)), (r) => `Harvested ${r.harvested ?? 0} (🪙 ${chips(Number(r.paid ?? 0))})${harvestFailedNote(Number(r.failed) || 0)} and planted ${r.planted ?? 0} × ${crop.label} for 🪙 ${chips(Number(r.cost ?? 0))}.`)} data-testid="all-farms-harvest-replant-map">Harvest ready &amp; replant<span>🪙 {chips(seedCost(plantAfterHarvestN))}</span></button>
        </div>
      </div>}
      {groups.map((g) => <section key={g.map} data-testid={`all-farms-${g.map}`}><h4>{g.label}</h4>
        {!g.farms.length && <small>No farms owned here.</small>}
        {g.map !== map && g.farms.length > 0 && <small>Travel to {g.map === 'resort' ? 'Chud Resort' : 'Chud City'} to harvest or replant these farms.</small>}
        {g.farms.map((p) => p && <article key={p.id} className="farm-dash-card">
          <p><button type="button" data-testid={`all-farms-${p.id}`} disabled={g.map !== map}
            onClick={() => { if (g.map === map) onOpenFarm(p.id); }}>{p.label}{g.map !== map ? ` — travel to ${g.map === 'resort' ? 'Chud Resort' : 'Chud City'} to open` : ' — Open farm'}</button>
          {status.plots.get(p.id) ? <FarmStatusSummary plot={status.plots.get(p.id)!} now={status.now} /> : <small className="barn-farm-status">{status.error ? 'Status unavailable' : 'Loading status…'}</small>}</p>
          {g.map === map && status.plots.get(p.id) && (() => {
            const plot = status.plots.get(p.id)!;
            const ready = harvestableTiles(plot, status.now).length;
            const empty = emptyTiles(plot, status.now).length;
            const withered = tilesAt(plot, status.now, 'withered').length;
            return <div className="farm-dash-actions">
              <button type="button" disabled={busy || !ready} onClick={() => act('harvest', [p.id], (r) => `Harvested ${r.harvested} for 🪙 ${chips(Number(r.paid))}.${harvestFailedNote(Number(r.failed) || 0)}`)} data-testid={`all-farms-harvest-${p.id}`}>Harvest {ready || ''} ready</button>
              <button type="button" disabled={busy || !ready} onClick={() => act('pantry', [p.id], (r) => `🧺 ${r.harvested} into the pantry.${harvestFailedNote(Number(r.failed) || 0)}`)} data-testid={`all-farms-pantry-${p.id}`}>To pantry</button>
              <button type="button" disabled={busy || !withered} onClick={() => act('clear', [p.id], (r) => `Cleared ${r.cleared} withered.`)} data-testid={`all-farms-clear-${p.id}`}>Clear {withered || ''} withered</button>
              <button type="button" disabled={busy || !empty} onClick={() => act('plant', [p.id], (r) => `Planted ${r.planted} × ${crop.label} for 🪙 ${chips(Number(r.cost))}.`)} data-testid={`all-farms-plant-${p.id}`}>Replant {empty || ''} empty<span>🪙 {chips(seedCost(empty))}</span></button>
            </div>;
          })()}
        </article>)}
      </section>)}
      {msg && <small data-testid="all-farms-msg">{msg}</small>}
    </>}
  </MapSheet>;
}
