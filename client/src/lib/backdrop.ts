import type { MouseEvent, PointerEvent } from 'react';

/**
 * QA r9: backdrop dismiss without click-through. Closing on mousedown removed the backdrop mid-click, so the
 * mouseup/click landed on whatever was underneath (a map card, the 3D city, once the Frostbite mine). Now the
 * backdrop consumes the whole press and closes on its own click, only when the press started and ended on it.
 */
export function backdropDismiss(close: () => void) {
  let armed = false;
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { armed = e.target === e.currentTarget; if (armed) e.stopPropagation(); },
    onPointerUp: (e: PointerEvent<HTMLElement>) => { if (e.target === e.currentTarget) e.stopPropagation(); },
    onMouseDown: (e: MouseEvent<HTMLElement>) => { if (e.target === e.currentTarget) e.stopPropagation(); },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault(); e.stopPropagation();
      if (armed) { armed = false; swallowClicksAfterClose(); close(); }
    },
  };
}

/**
 * Recheck #9: after a modal closes, the next press/click within a short window (a double click, a touch ghost click,
 * or the mouseup of a press that closed it) must not fall through to whatever sat under the panel, e.g. the
 * Frostbite mine tile under the Skills close button, which opened the Mines panel. A capture-phase shield on window
 * eats pointer/mouse/touch/click events for `ms` after close; nothing else is affected.
 */
const SHIELD_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const;
let shieldUntil = 0, shieldOn = false;
function shield(e: Event) { if (performance.now() > shieldUntil) { off(); return; } e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
function off() { if (!shieldOn) return; shieldOn = false; for (const t of SHIELD_EVENTS) window.removeEventListener(t, shield, true); }
export function swallowClicksAfterClose(ms = 400) {
  if (typeof window === 'undefined') return;
  shieldUntil = performance.now() + ms;
  if (!shieldOn) { shieldOn = true; for (const t of SHIELD_EVENTS) window.addEventListener(t, shield, { capture: true, passive: false }); }
  setTimeout(() => { if (performance.now() >= shieldUntil) off(); }, ms + 20);
}

/** Props for a modal's ✕ button: the press never reaches the panel drag handle or anything behind it, and closing
 *  arms the click-through shield above. */
export function closeButton(close: () => void) {
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return {
    onPointerDown: stop, onPointerUp: stop, onMouseDown: stop, onMouseUp: stop,
    onClick: (e: MouseEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); swallowClicksAfterClose(); close(); },
  };
}
