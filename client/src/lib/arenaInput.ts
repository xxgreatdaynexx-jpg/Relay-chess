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

/** Arena look settings, saved per browser. sens 1.0 = the original feel. */
export interface LookPrefs { sens: number; scope: number; invertY: boolean; touch: number }
export const LOOK_KEY = 'relay-fps-look';
export const SENS_MIN = 0.1;
export const SENS_MAX = 5;
export const DEFAULT_LOOK: LookPrefs = { sens: 1, scope: 0.31, invertY: false, touch: 1 };
const clampSens = (v: unknown, d: number, lo = SENS_MIN, hi = SENS_MAX) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : d);
export function normalizeLook(raw: unknown): LookPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<LookPrefs>;
  return { sens: clampSens(o.sens, DEFAULT_LOOK.sens), scope: clampSens(o.scope, DEFAULT_LOOK.scope, 0.05, 2), invertY: o.invertY === true, touch: clampSens(o.touch, DEFAULT_LOOK.touch) };
}
export function readLook(store: Pick<Storage, 'getItem'> = localStorage): LookPrefs {
  try { return normalizeLook(JSON.parse(store.getItem(LOOK_KEY) || 'null')); } catch { return { ...DEFAULT_LOOK }; }
}
/** Radians per mouse pixel: [yaw, pitch] (pitch sign already includes invert-Y; add to pitch). */
export function mouseLook(p: LookPrefs, scoped: boolean, dx: number, dy: number): [number, number] {
  const k = 0.0035 * p.sens * (scoped ? p.scope : 1);
  return [dx * k, (p.invertY ? dy : -dy) * k];
}
