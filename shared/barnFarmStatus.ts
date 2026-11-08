import { cropById, type FarmView } from './farm.js';
export type BarnFarmPlot = Pick<FarmView, 'id' | 'cols' | 'rows' | 'tiles'>;
export interface BarnFarmOverview { now: number; plots: BarnFarmPlot[] }
/** Use authoritative tile deadlines (already include planting modifiers), never recalculate crop growth on the client. */
export function barnFarmStatus(plot: BarnFarmPlot, now: number) {
  const count = { empty: Math.max(0, plot.cols * plot.rows - plot.tiles.length), growing: 0, ready: 0, withered: 0 };
  const crops = new Map<string, number>(); const growing: number[] = [];
  for (const t of plot.tiles) {
    const stage = now >= t.witherAt ? 'withered' : now >= t.readyAt ? 'ready' : 'growing'; count[stage]++;
    if (stage === 'growing') growing.push(t.readyAt);
    const label = cropById(t.crop)?.label ?? t.crop; crops.set(label, (crops.get(label) ?? 0) + 1);
  }
  return { count, crops: [...crops].map(([label, n]) => `${n} ${label}`).join(' · '),
    nextReady: growing.length ? Math.min(...growing) : null, lastReady: growing.length ? Math.max(...growing) : null };
}
export function barnTimeLeft(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}
