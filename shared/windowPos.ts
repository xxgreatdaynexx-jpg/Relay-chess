/** Pure helpers for draggable panels: offsets are translate(dx, dy) from the panel's default spot. */
export interface Offset { dx: number; dy: number }
export interface Box { left: number; top: number; width: number; height: number }

/** Keep the whole panel (at least `margin` px of it when larger than the screen) on screen. `base` is the un-offset rect. */
export function clampOffset(o: Offset, base: Box, vw: number, vh: number, margin = 4): Offset {
  const fit = (pos: number, size: number, view: number) => {
    const min = margin;
    const max = Math.max(min, view - size - margin);
    return Math.min(max, Math.max(min, pos));
  };
  const left = fit(base.left + o.dx, base.width, vw);
  const top = fit(base.top + o.dy, base.height, vh);
  return { dx: Math.round(left - base.left), dy: Math.round(top - base.top) };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const posKey = (id: string) => `relay-win-${id}`;

export function loadOffset(id: string, store: Store | null): Offset | null {
  try {
    const v = JSON.parse(store?.getItem(posKey(id)) ?? 'null') as Offset | null;
    return v && Number.isFinite(v.dx) && Number.isFinite(v.dy) ? { dx: v.dx, dy: v.dy } : null;
  } catch {
    return null;
  }
}

export function saveOffset(id: string, o: Offset | null, store: Store | null): void {
  try {
    if (!o || (o.dx === 0 && o.dy === 0)) store?.removeItem(posKey(id));
    else store?.setItem(posKey(id), JSON.stringify(o));
  } catch {
    // storage blocked
  }
}
