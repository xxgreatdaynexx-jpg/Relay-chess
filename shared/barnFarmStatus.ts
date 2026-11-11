import { cropById, type FarmView } from './farm.js';
export type BarnFarmPlot = Pick<FarmView, 'id' | 'cols' | 'rows' | 'tiles'>;
export interface BarnFarmOverview { now: number; plots: BarnFarmPlot[]; index?: number }
/** Use authoritative tile deadlines (already include planting modifiers), never recalculate crop growth on the client. */
export function tileStage(t: { readyAt: number; witherAt: number; failed?: boolean; stage?: string }, now: number): 'growing' | 'ready' | 'withered' | 'failed' {
  if (t.failed === true || t.stage === 'failed') return now >= t.witherAt ? 'withered' : 'failed';
  return now >= t.witherAt ? 'withered' : now >= t.readyAt ? 'ready' : 'growing';
}
/** Ready-window tiles that harvest will pick up (healthy ready + failed-but-due). */
export function isHarvestable(t: { readyAt: number; witherAt: number; failed?: boolean; stage?: string }, now: number): boolean {
  if (now < t.readyAt || now >= t.witherAt) return false;
  return t.failed === true || t.stage === 'failed' || t.stage === 'ready' || (!t.stage && !t.failed);
}
export function emptyTiles(plot: BarnFarmPlot, now: number): number[] {
  const occ = new Set(plot.tiles.map((t) => t.tile));
  const n = plot.cols * plot.rows;
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (!occ.has(i)) out.push(i);
  return out;
}
export function tilesAt(plot: BarnFarmPlot, now: number, stage: 'growing' | 'ready' | 'withered' | 'failed'): number[] {
  return plot.tiles.filter((t) => tileStage(t, now) === stage).map((t) => t.tile);
}
export function harvestableTiles(plot: BarnFarmPlot, now: number): number[] {
  return plot.tiles.filter((t) => isHarvestable(t, now)).map((t) => t.tile);
}
/** Use authoritative tile deadlines (already include planting modifiers), never recalculate crop growth on the client. */
export function barnFarmStatus(plot: BarnFarmPlot, now: number) {
  const count = { empty: Math.max(0, plot.cols * plot.rows - plot.tiles.length), growing: 0, ready: 0, withered: 0, failed: 0 };
  const crops = new Map<string, number>(); const growing: number[] = []; const ripe: number[] = [];
  for (const t of plot.tiles) {
    const stage = tileStage(t, now); count[stage]++;
    if (stage === 'growing') growing.push(t.readyAt);
    if (stage === 'ready') ripe.push(t.witherAt);
    const label = cropById(t.crop)?.label ?? t.crop; crops.set(label, (crops.get(label) ?? 0) + 1);
  }
  return { count, crops: [...crops].map(([label, n]) => `${n} ${label}`).join(' · '),
    nextReady: growing.length ? Math.min(...growing) : null, lastReady: growing.length ? Math.max(...growing) : null,
    nextWither: ripe.length ? Math.min(...ripe) : null };
}
export function barnTimeLeft(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}
