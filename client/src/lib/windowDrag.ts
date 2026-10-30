import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { clampOffset, clampSize, contentScale, TOP_BAR, loadOffset, loadSize, saveOffset, saveSize, type Offset, type Size } from '../../../shared/windowPos';

const store = () => { try { return localStorage; } catch { return null; } };
const PHONE = '(max-width: 520px)';
const M = 4;
let topZ = 60;
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Dir = (typeof DIRS)[number];

/**
 * Drag a .sol-panel by its title bar and resize it from its edges / bottom-right grip.
 * Double-clicking the bar toggles maximize. Phones keep the fixed full-width layout (no drag, no resize).
 */
export function useWindowDrag(id: string, ref: RefObject<HTMLElement | null>) {
  const [off, setOff] = useState<Offset>(() => loadOffset(id, store()) ?? { dx: 0, dy: 0 });
  const [size, setSize] = useState<Size | null>(() => {
    const s = loadSize(id, store());
    if (!s) return s;
    const c = clampSize(s.w, s.h, window.innerWidth, window.innerHeight - TOP_BAR + M, M);
    return { ...s, ...c };
  });
  const [maxed, setMaxed] = useState<null | { off: Offset; size: Size | null }>(null);
  const offRef = useRef(off);
  offRef.current = off;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const drag = useRef<{ x: number; y: number; start: Offset } | null>(null);
  const rs = useRef<{ dir: Dir; x: number; y: number; r: DOMRect; w0: number; h0: number } | null>(null);
  /** Where the panel's top-left should land after the next layout (resizing changes the anchored base). */
  const pin = useRef<{ left: number; top: number } | null>(null);
  const [isPhone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);
  const phone = () => window.matchMedia?.(PHONE).matches ?? false;

  const clamp = useCallback((o: Offset): Offset => {
    const el = ref.current;
    if (!el || phone()) return o;
    const r = el.getBoundingClientRect();
    const cur = offRef.current;
    return clampOffset(o, { left: r.left - cur.dx, top: r.top - cur.dy, width: r.width, height: r.height }, window.innerWidth, window.innerHeight, M, TOP_BAR);
  }, [ref]);

  const front = useCallback(() => {
    const wrap = ref.current?.parentElement;
    if (wrap) wrap.style.zIndex = String(++topZ);
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
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

  useEffect(() => {
    const onResize = () => {
      setPhone(phone());
      setSize((s) => {
        if (!s || phone()) return s;
        const c = clampSize(s.w, s.h, window.innerWidth, window.innerHeight - TOP_BAR + M, M);
        return c.w === s.w && c.h === s.h ? s : { ...s, ...c };
      });
      setOff((o) => clamp(o));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

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

  const toggleMax = () => {
    const el = ref.current;
    if (!el || phone()) return;
    if (maxed) {
      setMaxed(null);
      setSize(maxed.size);
      saveSize(id, maxed.size, store());
      setOff(maxed.off);
      saveOffset(id, maxed.off, store());
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

  const bar = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      front();
      if (phone() || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, input, select, a, textarea')) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { x: e.clientX, y: e.clientY, start: offRef.current };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      e.stopPropagation();
      setMaxed(null);
      setOff(clamp({ dx: d.start.dx + e.clientX - d.x, dy: d.start.dy + e.clientY - d.y }));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      e.stopPropagation();
      drag.current = null;
      saveOffset(id, offRef.current, store());
    },
    onPointerCancel: () => { drag.current = null; },
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
      const el = ref.current;
      if (!el || phone() || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      front();
      const { w0, h0 } = natural();
      rs.current = { dir, x: e.clientX, y: e.clientY, r: el.getBoundingClientRect(), w0, h0 };
      setMaxed(null);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = rs.current;
      if (!s) return;
      e.stopPropagation();
      const vw = window.innerWidth, vh = window.innerHeight;
      const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
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
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (!rs.current) return;
      e.stopPropagation();
      rs.current = null;
      saveSize(id, sizeRef.current, store());
      persistOff();
    },
    onPointerCancel: () => { rs.current = null; },
  });

  const grips = isPhone ? null : DIRS.map(grip);
  const sized = !!size && !isPhone;
  const style: CSSProperties = {};
  if (off.dx || off.dy) Object.assign(style, { transform: `translate(${off.dx}px, ${off.dy}px)`, animation: 'none' });
  if (sized) Object.assign(style, { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none', animation: 'none', '--win-scale': contentScale(size) });
  return {
    style: Object.keys(style).length ? style : undefined,
    bar, front, reset, grips, toggleMax,
    sized,
    maximized: !!maxed,
    className: sized ? ' win-sized' : '',
    moved: !!(off.dx || off.dy) || sized,
  };
}
