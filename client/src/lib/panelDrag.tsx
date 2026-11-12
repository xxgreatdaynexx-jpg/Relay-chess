import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { clampOffset, loadOffset, saveOffset, type Offset } from '../../../shared/windowPos';

const store = () => { try { return localStorage; } catch { return null; } };
const M = 4;
/** Drag starts only after this much travel, so a plain tap/click still works. */
export const PANEL_DRAG_SLOP = 4;
/** Headings within this many px of the panel top also act as the header (mouse and touch). */
export const PANEL_HEAD_PX = 64;
const NO_DRAG = 'input, select, textarea, button, a, label, [contenteditable], [data-no-drag]';

/** Can a press on `t` start dragging the panel? Never on form controls/buttons; yes on the grip or a header heading. */
export function panelDragAllowed(t: Element | null, panelTop: number, y: number): boolean {
  if (!t) return false;
  if (t.closest(NO_DRAG)) return false;
  if (t.closest('[data-drag-handle]')) return true;
  return y - panelTop <= PANEL_HEAD_PX;
}

/**
 * Shared drag-by-header behaviour for every floating panel/modal that is not a .sol-panel window (those use
 * useWindowDrag). Pointer events (mouse, pen, touch), clamped on screen, offset kept per panel in localStorage.
 * Usage: const d = usePanelDrag('grocery'); <div ref={d.ref} style={d.style()} onPointerDown={d.onPointerDown} data-drag-panel="grocery">{d.handle}...
 */

/** True when CSS pins a full-bleed sheet so a JS translate cannot move it (phone menus). */
export function sheetPinned(el: HTMLElement): boolean {
  if (typeof window === 'undefined') return false;
  const s = getComputedStyle(el);
  // `none` or the two-value form some engines report. A real translate is a matrix().
  if (s.transform !== 'none' && s.transform !== 'none none') return false;
  const r = el.getBoundingClientRect();
  return r.width >= window.innerWidth - 2 && r.left <= 2 && r.top <= 2;
}

export function usePanelDrag<T extends HTMLElement = HTMLDivElement>(id: string) {
  const key = `panel-${id}`;
  const ref = useRef<T | null>(null);
  const [off, setOff] = useState<Offset>(() => loadOffset(key, store()) ?? { dx: 0, dy: 0 });
  const offRef = useRef(off);
  offRef.current = off;

  const clamp = useCallback((o: Offset): Offset => {
    const el = ref.current;
    if (!el) return o;
    const r = el.getBoundingClientRect();
    const cur = offRef.current;
    if (!r.width && !r.height) return o; // not laid out (jsdom / hidden)
    // Mobile viewport sheets set `transform: none !important` and pin to the screen. If we
    // still clamp, getBoundingClientRect never moves (CSS ignores our translate) and the
    // offset grows every layout — React "Maximum update depth exceeded", which is the
    // panel crash on phones. 100dvh is also often a few px shorter than innerHeight
    // (mobile Chrome URL bar), so the old "fills the viewport" short-circuit missed them.
    if (sheetPinned(el) || (r.width >= window.innerWidth && r.height >= window.innerHeight)) return { dx: 0, dy: 0 };
    return clampOffset(o, { left: r.left - cur.dx, top: r.top - cur.dy, width: r.width, height: r.height }, window.innerWidth, window.innerHeight, M, M);
  }, []);

  // Keep a restored/old offset on screen (window resized since, panel grew). At most two
  // automatic corrections per settle so a pinned/oscillating clamp cannot loop.
  const clampPasses = useRef(0);
  useLayoutEffect(() => {
    const c = clamp(offRef.current);
    if (c.dx === offRef.current.dx && c.dy === offRef.current.dy) { clampPasses.current = 0; return; }
    if (clampPasses.current >= 2) return;
    clampPasses.current += 1;
    setOff(c);
  });

  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const t = e.target as Element;
    if (!panelDragAllowed(t, el.getBoundingClientRect().top, e.clientY)) return;
    if (!t.closest(NO_DRAG)) e.preventDefault();
    const s = { x: e.clientX, y: e.clientY, start: offRef.current, live: false, pid: e.pointerId };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pid) return;
      if (!s.live) {
        if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < PANEL_DRAG_SLOP) return;
        s.live = true;
        clampPasses.current = 0;
      }
      ev.preventDefault();
      const n = clamp({ dx: s.start.dx + ev.clientX - s.x, dy: s.start.dy + ev.clientY - s.y });
      offRef.current = n;
      setOff(n);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (s.live) saveOffset(key, offRef.current, store());
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const reset = () => { setOff({ dx: 0, dy: 0 }); saveOffset(key, null, store()); };
  const moved = !!(off.dx || off.dy);
  const style = (extra?: CSSProperties): CSSProperties | undefined => {
    if (!moved) return extra;
    return { ...extra, transform: `translate(${off.dx}px, ${off.dy}px)`, animation: 'none' };
  };
  const handle = <div className="panel-drag-handle" data-drag-handle="" data-testid={`panel-drag-${id}`} title="Drag to move" onDoubleClick={reset} aria-hidden="true" />;
  return { ref, style, onPointerDown, handle, reset, moved, offset: off };
}
