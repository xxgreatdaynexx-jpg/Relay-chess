/**
 * pt2037u: shows the decorative city riot joke only while the server says it is active, and latches OFF for the rest of
 * the session once any snapshot says a mayor ended it (a later stale/offline/cached answer can never bring it back).
 * Starts hidden so a resolved riot never flashes on load; no answer = stays hidden.
 */
export interface RiotView { riot?: { active: boolean } | null }
export function cityRiotGate(joke: { setEnabled(on: boolean): void }) {
  let ended = false, shown = false;
  return {
    apply(view: RiotView | null | undefined) {
      const r = view?.riot; if (!r || typeof r.active !== 'boolean') return;
      if (!r.active) { ended = true; if (shown) { shown = false; } joke.setEnabled(false); return; }
      if (!ended && !shown) { shown = true; joke.setEnabled(true); }
    },
    get ended() { return ended; }, get shown() { return shown; },
  };
}
