import { lineOfSight, type ArenaMap } from '../../../shared/fps';

export const TAG_LOS_MS = 100;
export const TAG_FADE_MS = 150;

/** Whether an enemy's overhead health bar / name tag may be drawn: needs line of sight from the camera to their head or chest. */
export function tagVisible(eye: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, map: ArenaMap): boolean {
  return lineOfSight(eye, { x: p.x, y: p.y, z: p.z + 1.7 }, map) || lineOfSight(eye, { x: p.x, y: p.y, z: p.z + 1.1 }, map);
}

/** Throttled LOS per target (re-checked every TAG_LOS_MS) with a short fade; alpha() returns 0..1. */
export class TagVisibility {
  private s = new Map<string, { at: number; vis: boolean; alpha: number; t: number }>();
  alpha(id: string, now: number, check: () => boolean): number {
    let e = this.s.get(id);
    if (!e) { const vis = check(); e = { at: now, vis, alpha: vis ? 1 : 0, t: now }; this.s.set(id, e); return e.alpha; }
    if (now - e.at >= TAG_LOS_MS) { e.vis = check(); e.at = now; }
    const step = (now - e.t) / TAG_FADE_MS; e.t = now;
    e.alpha = Math.max(0, Math.min(1, e.alpha + (e.vis ? step : -step)));
    return e.alpha;
  }
  prune(ids: Set<string>) { for (const k of this.s.keys()) if (!ids.has(k)) this.s.delete(k); }
}
