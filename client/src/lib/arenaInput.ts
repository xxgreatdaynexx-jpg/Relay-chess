/** Pure helpers for the Arena's pointer-lock / hotkey state, kept DOM-free so they can be unit-tested. */

export const FPS_KEY = 'relay.arena.fps';

/** True only when the browser really holds the lock on our canvas; app state must always follow this. */
export function isLockedTo(lockEl: unknown, canvas: unknown): boolean {
  return !!canvas && lockEl === canvas;
}

export type ArenaHotkey = 'picker' | 'fps' | 'release' | null;

/** Map a keydown to a UI action. M opens the map picker (releasing the lock), F3 toggles fps, Esc always releases. */
export function hotkeyFor(key: string, repeat = false): ArenaHotkey {
  if (repeat) return null;
  const k = key.toLowerCase();
  if (k === 'm') return 'picker';
  if (k === 'f3') return 'fps';
  if (k === 'escape') return 'release';
  return null;
}

/** Rolling fps from frame timestamps (ms); returns the rounded rate over the samples kept. */
export function fpsFrom(times: number[]): number {
  if (times.length < 2) return 0;
  const span = times[times.length - 1] - times[0];
  return span > 0 ? Math.round(((times.length - 1) * 1000) / span) : 0;
}

export function readFpsPref(store: Pick<Storage, 'getItem'> | undefined): boolean {
  try { return store?.getItem(FPS_KEY) === '1'; } catch { return false; }
}
