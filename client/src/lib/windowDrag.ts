import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { clampOffset, clampSize, contentScale, edgeAt, TOP_BAR, loadOffset, loadSize, restoreKey, saveOffset, saveSize, type Offset, type Size } from '../../../shared/windowPos';

const store = () => { try { return localStorage; } catch { return null; } };
const PHONE = '(max-width: 520px)';
const M = 4;
/** Drag only starts after the pointer travels this far, so pressing a title-bar button still clicks it. */
const DRAG_SLOP = 4;
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Dir = (typeof DIRS)[number];

/** Window stacking: the last-focused window is on top. Kept below the top bar (z 48) is not needed since windows never go under it. */
const Z_BASE = 46;
const stack: HTMLElement[] = [];
function bringToFront(el: HTMLElement) {
  const i = stack.indexOf(el);
  if (i >= 0) stack.splice(i, 1);
  for (let j = stack.length - 1; j >= 0; j--) if (!stack[j].isConnected) stack.splice(j, 1);
  stack.push(el);
  stack.forEach((p, k) => {
    p.style.zIndex = String(Z_BASE + k);
    // Narrow screens stack every window in the same spot: hide the ones behind (CSS) so no stale window peeks out.
    if (k < stack.length - 1) p.dataset.behind = '1'; else delete p.dataset.behind;
  });
}

/** True when `el` is the top window (or no window has been stacked yet). Background 3D panels throttle on this. */
export function isFrontWindow(el: HTMLElement | null): boolean {
  if (!el) return false;
  for (let j = stack.length - 1; j >= 0; j--) if (stack[j].isConnected) return stack[j] === el;
  return true;
}

function dropFromStack(el: HTMLElement) {
  const i = stack.indexOf(el);
  if (i >= 0) stack.splice(i, 1);
  const top = stack[stack.length - 1];
  if (top) delete top.dataset.behind;
}

type Restore = { off: Offset; size: Size | null };
function loadRestore(id: string): Restore | null {
  try {
    const v = JSON.parse(store()?.getItem(restoreKey(id)) ?? 'null') as Restore | null;
    return v && v.off && Number.isFinite(v.off.dx) && Number.isFinite(v.off.dy) ? v : null;
  } catch { return null; }
}
function saveRestore(id: string, r: Restore | null) {
  try { if (r) store()?.setItem(restoreKey(id), JSON.stringify(r)); else store()?.removeItem(restoreKey(id)); } catch { /* blocked */ }
}

const CURSOR: Record<Dir, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

/**
 * Drag a .sol-panel by its title bar (anywhere on it, including its labels/tab chips) and resize it from any edge or corner.
 * Double-clicking the bar toggles maximize; restore returns to the user's last size and spot. Phones keep the fixed layout.
 */
export function useWindowDrag(id: string, ref: RefObject<HTMLElement | null>) {
  const [off, setOff] = useState<Offset>(() => loadOffset(id, store()) ?? { dx: 0, dy: 0 });
  const [size, setSize] = useState<Size | null>(() => {
    const s = loadSize(id, store());
    if (!s) return s;
    const c = clampSize(s.w, s.h, window.innerWidth, window.innerHeight - TOP_BAR + M, M);
    return { ...s, ...c };
  });
  const [maxed, setMaxedState] = useState<Restore | null>(() => loadRestore(id));
  const setMaxed = (r: Restore | null) => { setMaxedState(r); saveRestore(id, r); };
  const offRef = useRef(off);
  offRef.current = off;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const maxedRef = useRef(maxed);
  maxedRef.current = maxed;
  const drag = useRef<{ x: number; y: number; start: Offset; live: boolean; pid: number; el: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  /** Where the panel's top-left should land after the next layout (resizing changes the anchored base). */
  const pin = useRef<{ left: number; top: number } | null>(null);
  const [isPhone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);
  const phone = () => window.matchMedia?.(PHONE).matches ?? false;

  // A fullscreen panel ignores our transform (the browser pins it to the screen), so clamping it would chase a
  // moving base forever (React "maximum update depth"): leave the offset alone until it exits fullscreen.
  const inFs = (el: Element | null) => !!el && typeof document !== 'undefined' && document.fullscreenElement === el;
  const clamp = useCallback((o: Offset): Offset => {
    const el = ref.current;
    if (!el || phone() || inFs(el)) return o;
    const r = el.getBoundingClientRect();
    const cur = offRef.current;
    return clampOffset(o, { left: r.left - cur.dx, top: r.top - cur.dy, width: r.width, height: r.height }, window.innerWidth, window.innerHeight, M, TOP_BAR);
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!stack.includes(el)) bringToFront(el);
    if (inFs(el)) return;
    const p = pin.current;
    if (p && !phone()) {
      pin.current = null;
      const r = el.getBoundingClientRect();
      const next = { dx: Math.round(offRef.current.dx + p.left - r.left), dy: Math.round(offRef.current.dy + p.top - r.top) };
      if (next.dx !== offRef.current.dx || next.dy !== offRef.current.dy) { offRef.current = next; setOff(next); }
      return;
    }
    const c = clamp(offRef.current);
    if (c.dx !== offRef.current.dx || c.dy !== offRef.current.dy) setOff(c);
  });

  // When this window closes (its element goes away), let the next one down show again.
  const lastEl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (lastEl.current && lastEl.current !== el) dropFromStack(lastEl.current);
    lastEl.current = el;
  });
  useEffect(() => () => { if (lastEl.current) dropFromStack(lastEl.current); }, []);

  useEffect(() => {
    const onResize = () => {
      setPhone(phone());
      setSize((s) => {
        if (!s || phone() || inFs(ref.current)) return s;
        // Clamp from the size the user chose (saved), not the current one, so zooming back out restores it.
        const vw = window.innerWidth, vh = window.innerHeight - TOP_BAR + M;
        const want = maxedRef.current ? { w: vw, h: vh } : (loadSize(id, store()) ?? s);
        const c = clampSize(want.w, want.h, vw, vh, M);
        return c.w === s.w && c.h === s.h ? s : { ...s, ...c };
      });
      setOff((o) => clamp(o));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp, id]);

  const reset = () => {
    setOff({ dx: 0, dy: 0 });
    setSize(null);
    setMaxed(null);
    saveOffset(id, null, store());
    saveSize(id, null, store());
  };

  const natural = () => {
    const el = ref.current!;
    const s = sizeRef.current;
    const r = el.getBoundingClientRect();
    return { w0: s?.w0 ?? r.width, h0: s?.h0 ?? r.height };
  };

  /** Leaving the maximized state by dragging/resizing keeps the current geometry; just forget the restore point. */
  const unmax = () => { if (maxedRef.current) { maxedRef.current = null; setMaxed(null); } };

  const toggleMax = () => {
    const el = ref.current;
    if (!el || phone()) return;
    const m = maxedRef.current;
    if (m) {
      setMaxed(null);
      setSize(m.size);
      saveSize(id, m.size, store());
      setOff(m.off);
      saveOffset(id, m.off, store());
      return;
    }
    const { w0, h0 } = natural();
    setMaxed({ off: offRef.current, size: sizeRef.current });
    const c = clampSize(window.innerWidth, window.innerHeight - TOP_BAR + M, window.innerWidth, window.innerHeight - TOP_BAR + M, M);
    const next = { ...c, w0, h0 };
    setSize(next);
    saveSize(id, next, store());
    pin.current = { left: M, top: TOP_BAR };
  };

  const persistOff = () => setTimeout(() => saveOffset(id, offRef.current, store()), 0);

  /** Resize from `dir`, tracking the pointer on window so it works from grips, edges under scrollbars, anywhere. */
  const startResize = (dir: Dir, e: { clientX: number; clientY: number; pointerId: number; preventDefault(): void; stopPropagation(): void }) => {
    const el = ref.current;
    if (!el || phone()) return;
    e.preventDefault();
    e.stopPropagation();
    bringToFront(el);
    const { w0, h0 } = natural();
    const s = { dir, x: e.clientX, y: e.clientY, r: el.getBoundingClientRect(), w0, h0 };
    unmax();
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = CURSOR[dir];
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const ddx = ev.clientX - s.x, ddy = ev.clientY - s.y;
      let { left, top, right, bottom } = s.r;
      if (s.dir.includes('e')) right = Math.min(vw - M, right + ddx);
      if (s.dir.includes('w')) left = Math.max(M, left + ddx);
      if (s.dir.includes('s')) bottom = Math.min(vh - M, bottom + ddy);
      if (s.dir.includes('n')) top = Math.max(TOP_BAR, top + ddy);
      const c = clampSize(right - left, bottom - top, vw, vh - TOP_BAR + M, M);
      if (s.dir.includes('w')) left = right - c.w;
      if (s.dir.includes('n')) top = bottom - c.h;
      pin.current = { left, top };
      setSize({ ...c, w0: s.w0, h0: s.h0 });
    };
    const up = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.cursor = prevCursor;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      saveSize(id, sizeRef.current, store());
      persistOff();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Panel-level pointerdown (capture): bring to front, and start an edge resize if the press is on any edge. */
  const front = (e?: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (el) bringToFront(el);
    if (!e || !el || phone() || e.button !== 0) return;
    const dir = edgeAt(e.clientX, e.clientY, el.getBoundingClientRect());
    if (dir) startResize(dir, e);
  };

  /** Hover cursor for edges (grips can scroll away or sit under a scrollbar). */
  const onPanelMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || phone() || e.buttons) return;
    const dir = edgeAt(e.clientX, e.clientY, el.getBoundingClientRect());
    el.style.cursor = dir ? CURSOR[dir] : '';
  };

  const bar = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (phone() || e.button !== 0) return;
      const t = e.target as HTMLElement;
      // Text inputs/selects keep their own behaviour; buttons and labels in the bar drag once the pointer moves.
      if (t.closest('input, select, textarea, [contenteditable]')) return;
      if (!t.closest('button, a')) e.preventDefault();
      const d0 = { x: e.clientX, y: e.clientY, start: offRef.current, live: false, pid: e.pointerId, el: e.currentTarget };
      drag.current = d0;
      // Until the drag goes live there's no pointer capture, so a fast first move can leave the bar; watch the window.
      const pre = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== d0.pid || drag.current !== d0) return done();
        if (d0.live || Math.hypot(ev.clientX - d0.x, ev.clientY - d0.y) < DRAG_SLOP) return;
        d0.live = true;
        unmax();
        d0.el.setPointerCapture?.(ev.pointerId);
        setOff(clamp({ dx: d0.start.dx + ev.clientX - d0.x, dy: d0.start.dy + ev.clientY - d0.y }));
        done();
      };
      const end = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== d0.pid) return;
        // Released outside the bar before capture: finish here so the drag can't linger.
        if (drag.current === d0) {
          drag.current = null;
          if (d0.live) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); saveOffset(id, offRef.current, store()); }
        }
        done();
      };
      const done = () => {
        window.removeEventListener('pointermove', pre);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', pre);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid) return;
      if (!d.live) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_SLOP) return;
        d.live = true;
        unmax();
        d.el.setPointerCapture?.(e.pointerId);
      }
      e.stopPropagation();
      setOff(clamp({ dx: d.start.dx + e.clientX - d.x, dy: d.start.dy + e.clientY - d.y }));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (!d.live) return;
      e.stopPropagation();
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      saveOffset(id, offRef.current, store());
    },
    onPointerCancel: () => { drag.current = null; },
    /** Swallow the click that ends a drag started on a title-bar button. */
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
    },
    onDoubleClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      toggleMax();
    },
    className: 'sol-bar win-drag',
    title: 'Drag to move · double-click to maximize/restore',
  };

  const grip = (dir: Dir) => createElement('div', {
    key: dir,
    className: `win-grip win-grip-${dir}`,
    'data-testid': dir === 'se' ? 'win-resize' : undefined,
    'aria-hidden': true,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      startResize(dir, e);
    },
  });

  const grips = isPhone ? null : DIRS.map(grip);
  const sized = !!size && !isPhone;
  const style: CSSProperties = {};
  if (off.dx || off.dy) Object.assign(style, { transform: `translate(${off.dx}px, ${off.dy}px)`, animation: 'none' });
  if (sized) Object.assign(style, { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none', animation: 'none', '--win-scale': contentScale(size) });
  return {
    style: Object.keys(style).length ? style : undefined,
    bar, front, reset, grips, toggleMax, onPanelMove,
    sized,
    maximized: !!maxed,
    className: sized ? ' win-sized' : '',
    moved: !!(off.dx || off.dy) || sized,
  };
}
