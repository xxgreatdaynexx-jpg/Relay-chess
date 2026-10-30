import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { clampOffset, loadOffset, saveOffset, type Offset } from '../../../shared/windowPos';

const store = () => { try { return localStorage; } catch { return null; } };
const PHONE = '(max-width: 520px)';
let topZ = 60;

/** Drag a .sol-panel by its title bar. Phones keep the fixed full-width layout (no dragging). */
export function useWindowDrag(id: string, ref: RefObject<HTMLElement | null>) {
  const [off, setOff] = useState<Offset>(() => loadOffset(id, store()) ?? { dx: 0, dy: 0 });
  const offRef = useRef(off);
  offRef.current = off;
  const drag = useRef<{ x: number; y: number; start: Offset } | null>(null);
  const phone = () => window.matchMedia?.(PHONE).matches ?? false;

  const clamp = useCallback((o: Offset): Offset => {
    const el = ref.current;
    if (!el || phone()) return o;
    const r = el.getBoundingClientRect();
    const cur = offRef.current;
    return clampOffset(o, { left: r.left - cur.dx, top: r.top - cur.dy, width: r.width, height: r.height }, window.innerWidth, window.innerHeight);
  }, [ref]);

  const front = useCallback(() => {
    const wrap = ref.current?.parentElement;
    if (wrap) wrap.style.zIndex = String(++topZ);
  }, [ref]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const c = clamp(offRef.current);
    if (c.dx !== offRef.current.dx || c.dy !== offRef.current.dy) setOff(c);
  });

  useEffect(() => {
    const onResize = () => setOff((o) => clamp(o));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const reset = () => {
    setOff({ dx: 0, dy: 0 });
    saveOffset(id, null, store());
  };

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
      reset();
    },
    className: 'sol-bar win-drag',
    title: 'Drag to move · double-click to reset',
  };

  const style: CSSProperties | undefined = off.dx || off.dy ? { transform: `translate(${off.dx}px, ${off.dy}px)`, animation: 'none' } : undefined;
  return { style, bar, front, reset, moved: !!(off.dx || off.dy) };
}
