/**
 * Factory area-select clipboard (pt / Liam #65): relative blueprints for copy/paste.
 * Paste consumes kit via fac_place; move uses fac_move (no kit). Contents on belts are not copied.
 */
import { KINDS, type Dir, type Ent, type Kind } from './factory.js';

export type ClipItem = { k: Kind; ox: number; oy: number; d: Dir; r?: string; f?: string; w?: [number, number, number] };
export type FactoryClip = { items: ClipItem[] };

export function entsToClip(ents: Ent[]): FactoryClip {
  if (!ents.length) return { items: [] };
  const ax = Math.min(...ents.map((e) => e.x));
  const ay = Math.min(...ents.map((e) => e.y));
  return {
    items: ents.map((e) => {
      const it: ClipItem = { k: e.k, ox: e.x - ax, oy: e.y - ay, d: e.d };
      if (e.r) it.r = e.r;
      if (e.f) it.f = e.f;
      if (e.w) it.w = [e.w[0], e.w[1], e.w[2]];
      return it;
    }),
  };
}

/** Place payloads for fac_place at an anchor cell. Caps at `max` (server place limit). */
export function clipToPlaceItems(clip: FactoryClip, ax: number, ay: number, max = 64): Array<Record<string, unknown>> {
  return clip.items.slice(0, max).map((it) => {
    const o: Record<string, unknown> = { k: it.k, x: ax + it.ox, y: ay + it.oy, d: it.d };
    if (it.r) o.r = it.r;
    if (it.f) o.f = it.f;
    if (it.w) o.w = it.w;
    return o;
  });
}

/** Kit counts required to paste (by kind). */
export function clipKitNeed(clip: FactoryClip): Record<Kind, number> {
  const need = {} as Record<Kind, number>;
  for (const it of clip.items) need[it.k] = (need[it.k] ?? 0) + 1;
  return need;
}

export function clipKitMissing(clip: FactoryClip, kit: Partial<Record<Kind, number>>): string | null {
  const need = clipKitNeed(clip);
  const short: string[] = [];
  for (const k of Object.keys(need) as Kind[]) {
    const n = need[k] ?? 0; const have = kit[k] ?? 0;
    if (have < n) short.push(`${KINDS[k].name} ×${n - have}`);
  }
  return short.length ? `Need in kit: ${short.join(', ')}` : null;
}
