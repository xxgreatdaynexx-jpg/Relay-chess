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
      if (armed) { armed = false; close(); }
    },
  };
}
