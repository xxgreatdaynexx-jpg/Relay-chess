/** Pure helpers for draggable panels: offsets are translate(dx, dy) from the panel's default spot. */
export interface Offset { dx: number; dy: number }
export interface Box { left: number; top: number; width: number; height: number }

/** Keep the whole panel (at least `margin` px of it when larger than the screen) on screen. `base` is the un-offset rect. */
/** Height reserved for the fixed top tab bar; windows never go above it. */
export const TOP_BAR = 44;

export function clampOffset(o: Offset, base: Box, vw: number, vh: number, margin = 4, topMin = margin): Offset {
  const fit = (pos: number, size: number, view: number, min = margin) => {
    const max = Math.max(min, view - size - margin);
    return Math.min(max, Math.max(min, pos));
  };
  const left = fit(base.left + o.dx, base.width, vw);
  const top = fit(base.top + o.dy, base.height, vh, topMin);
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

/** Resizable panels: a user size plus the panel's natural size (w0/h0) so content can scale up with it. */
export interface Size { w: number; h: number; w0: number; h0: number }
export const MIN_W = 300;
export const MIN_H = 240;
export const sizeKey = (id: string) => `relay-win-size-${id}`;

/** Clamp a size to the minimum and to the viewport (minus `margin` on each side). */
export function clampSize(w: number, h: number, vw: number, vh: number, margin = 4): { w: number; h: number } {
  const maxW = Math.max(MIN_W, vw - margin * 2);
  const maxH = Math.max(MIN_H, vh - margin * 2);
  return { w: Math.round(Math.min(maxW, Math.max(MIN_W, w))), h: Math.round(Math.min(maxH, Math.max(MIN_H, h))) };
}

/** How much to scale fixed-layout content (card tables) so it fills the new size; never shrinks below 1. */
export function contentScale(s: Size | null): number {
  if (!s || s.w0 <= 0 || s.h0 <= 0) return 1;
  return Math.max(1, Math.min(s.w / s.w0, s.h / s.h0, 3));
}

export function loadSize(id: string, store: Store | null): Size | null {
  try {
    const v = JSON.parse(store?.getItem(sizeKey(id)) ?? 'null') as Size | null;
    return v && [v.w, v.h, v.w0, v.h0].every((n) => Number.isFinite(n) && n > 0) ? { w: v.w, h: v.h, w0: v.w0, h0: v.h0 } : null;
  } catch {
    return null;
  }
}

export function saveSize(id: string, s: Size | null, store: Store | null): void {
  try {
    if (!s) store?.removeItem(sizeKey(id));
    else store?.setItem(sizeKey(id), JSON.stringify(s));
  } catch {
    // storage blocked
  }
}
