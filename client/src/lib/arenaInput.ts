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

/** How much the sprint FOV kick widens the view at full sprint. */
export const SPRINT_FOV_KICK = 0.08;
/**
 * Eases the sprint FOV kick toward 1 (sprinting and moving) or 0, snapping to exactly 0 once it is tiny,
 * so the view is never left a hair off 1× after a sprint ends.
 */
export function stepFovKick(kick: number, sprinting: boolean, dt: number): number {
  const k = Number.isFinite(kick) ? kick : 0;
  const next = k + ((sprinting ? 1 : 0) - k) * Math.min(1, Math.max(0, dt) * 8);
  return !sprinting && next < 1e-3 ? 0 : next;
}
/**
 * Camera zoom plus whether the first-person gun is drawn. The gun hides only for the sniper scope,
 * never because of the sprint FOV kick (that bug left the gun gone after any sprint).
 */
/** keepGun: aim-down-sights zoom (AR-15) keeps the viewmodel on screen; only a real scope hides it. */
export function viewZoom(scopeZoom: number, fovKick: number, keepGun = false): { zoom: number; showGun: boolean } {
  const k = Number.isFinite(fovKick) ? Math.max(0, fovKick) : 0;
  return { zoom: scopeZoom / (1 + SPRINT_FOV_KICK * k), showGun: keepGun || scopeZoom === 1 };
}

// ---------------------------------------------------------------- Ctrl / browser-shortcut safety

/** Keys the Arena owns (lowercased e.key; digits by physical code). */
export const ARENA_GAME_KEYS = new Set(['tab', 'w', 'a', 's', 'd', 'q', 'e', 'f', 'r', 'control', 'c', 'shift', ' ', '1', '2', '3', '4', '5', '6', '7', 'v', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown']);
export const arenaKey = (e: { key: string; code?: string }): string => (/^Digit[1-7]$/.test(e.code ?? '') ? e.code!.slice(5) : e.key.toLowerCase());
/**
 * Window-level guard while the Arena is active: swallow Ctrl/Cmd + game-key combos (Ctrl+S save, Ctrl+D bookmark,
 * Ctrl+A select-all, Ctrl+R reload, Ctrl+Q…) so they never reach the browser. Ctrl+W/Ctrl+T/Ctrl+N are reserved by
 * browsers and can only be stopped by keyboard lock in fullscreen.
 */
export function shouldBlockShortcut(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean }, active: boolean): boolean {
  if (!active || !(e.ctrlKey || e.metaKey)) return false;
  const k = arenaKey(e);
  return ARENA_GAME_KEYS.has(k) && k !== 'control';
}
/** Ctrl is the crouch key, C the alternate. */
export const crouchHeld = (keys: Set<string>, touch: boolean): boolean => keys.has('control') || keys.has('c') || touch;
/** Sends a boolean only when it changes (crouch/sprint state). */
export function changeSender(send: (on: boolean) => void): (on: boolean) => void {
  let last: boolean | undefined;
  return (on) => { if (on !== last) { last = on; send(on); } };
}
/** Keys navigator.keyboard.lock() grabs in fullscreen so Ctrl+W & co. go to the game. */
export const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyV', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'Space', 'Tab', 'Escape'];
