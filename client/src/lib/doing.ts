/**
 * Client side of chat activity presence. Components that are on screen register what the player is doing with
 * useDoing(); ChatDrawer reports the most relevant one over the existing 'presence' socket event.
 */
import { useEffect, useRef } from 'react';
import { topDoing, IDLE_AFTER_MS, type Doing, type DoingKind } from '../../../shared/doing';

const live = new Map<number, Doing>();
let seq = 0;
let lastInput = Date.now();
if (typeof window !== 'undefined') {
  const bump = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']) window.addEventListener(ev, bump, { passive: true, capture: true });
}

/** Register "doing" while `active`. Later registrations of the same rank win (the panel opened last). */
export function useDoing(kind: DoingKind, detail?: string | null, active = true): void {
  const id = useRef(0);
  useEffect(() => {
    if (!active) return;
    id.current = ++seq;
    live.set(id.current, detail ? { kind, detail } : { kind });
    const mine = id.current;
    return () => { live.delete(mine); };
  }, [kind, detail, active]);
}

/** The single status to report right now. */
export function currentDoing(now = Date.now()): Doing {
  if (typeof document !== 'undefined' && document.hidden && now - lastInput > 60_000) return { kind: 'idle' };
  if (now - lastInput > IDLE_AFTER_MS) return { kind: 'idle' };
  return topDoing([...live.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d)) ?? { kind: 'city' };
}
