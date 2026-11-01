/**
 * QA r11: while a dropdown is open, swallow the first outside press (pointerdown → click) in the capture
 * phase so it only closes the dropdown and never reaches whatever is underneath. Used where a fixed
 * backdrop can't work (the top bar has backdrop-filter, which traps fixed children inside the bar).
 * Returns a cleanup function.
 */
export function swallowOutside(doc: Pick<Document, 'addEventListener' | 'removeEventListener'>, inside: (t: EventTarget | null) => boolean, close: () => void): () => void {
  let armed = false;
  const kill = (e: Event) => { e.preventDefault(); e.stopPropagation(); (e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.(); };
  const down = (e: Event) => { if (inside(e.target)) return; armed = true; kill(e); };
  const mid = (e: Event) => { if (armed) kill(e); };
  const click = (e: Event) => { if (!armed) return; armed = false; kill(e); close(); };
  const types: [string, (e: Event) => void][] = [['pointerdown', down], ['mousedown', mid], ['pointerup', mid], ['mouseup', mid], ['click', click]];
  for (const [t, f] of types) doc.addEventListener(t, f, true);
  // Some presses never produce a click (drag off / touch cancel): close on the release instead.
  const up = (e: Event) => { if (armed) window.setTimeout(() => { if (armed) { armed = false; close(); } }, 0); void e; };
  doc.addEventListener('pointerup', up, true);
  return () => { for (const [t, f] of types) doc.removeEventListener(t, f, true); doc.removeEventListener('pointerup', up, true); };
}
