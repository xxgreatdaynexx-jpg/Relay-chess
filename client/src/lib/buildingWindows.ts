/**
 * Building menus (Kitchen, Grocery, Factory, Warehouse, Market, …) can be open at the same time.
 * Each registers here so Escape closes only the front one, re-opening focuses an already-open
 * window, and a mobile switcher can list them. Full-screen games (Arena, Mines, casino tables)
 * stay on the existing sol-panel stack and are not listed.
 */
import { bringToFront, dropFromStack, isFrontWindow } from './windowDrag';

export const BUILDING_WINDOW_IDS = ['kitchen', 'grocery', 'factory', 'warehouse', 'market', 'employ', 'cityhall', 'furniture'] as const;
export type BuildingWindowId = (typeof BUILDING_WINDOW_IDS)[number];

export const BUILDING_WINDOW_META: Record<BuildingWindowId, { label: string; tab: string }> = {
  kitchen: { label: 'Kitchen', tab: '🍳 Kitchen' },
  grocery: { label: 'Grocery Store', tab: '🛒 Grocery' },
  factory: { label: 'Factory', tab: '🏭 Factory' },
  warehouse: { label: 'Warehouse', tab: '📦 Warehouse' },
  market: { label: 'Market', tab: '🏪 Market' },
  employ: { label: 'Employment Office', tab: '💼 Jobs' },
  cityhall: { label: 'City Hall', tab: '🏛 City Hall' },
  furniture: { label: 'Furniture Store', tab: '🛋️ Furniture' },
};

export const isBuildingWindowId = (id: string): id is BuildingWindowId =>
  (BUILDING_WINDOW_IDS as readonly string[]).includes(id);

type Entry = { id: BuildingWindowId; el: HTMLElement; close: () => void };
const entries = new Map<BuildingWindowId, Entry>();
const listeners = new Set<() => void>();

const emit = () => { for (const fn of listeners) fn(); };

export const subscribeBuildingWindows = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export const portalTarget = (): HTMLElement =>
  (typeof document === 'undefined' ? null : document.querySelector('.app-panels')) as HTMLElement | null ?? document.body;

/** Open building windows, front-most last. */
export function listBuildingWindows(): Entry[] {
  const open = [...entries.values()].filter((e) => e.el.isConnected);
  open.sort((a, b) => {
    const az = parseInt(a.el.style.zIndex || '0', 10);
    const bz = parseInt(b.el.style.zIndex || '0', 10);
    return az - bz;
  });
  return open;
}

export function registerBuildingWindow(id: BuildingWindowId, el: HTMLElement, close: () => void): () => void {
  const prev = entries.get(id);
  if (prev && prev.el !== el) dropFromStack(prev.el);
  entries.set(id, { id, el, close });
  bringToFront(el);
  emit();
  return () => {
    const cur = entries.get(id);
    if (cur && cur.el === el) {
      entries.delete(id);
      dropFromStack(el);
      emit();
    }
  };
}

/** Bring an already-open building window to the front. Returns false if it is not open. */
export function focusBuildingWindow(id: BuildingWindowId): boolean {
  const e = entries.get(id);
  if (!e || !e.el.isConnected) return false;
  bringToFront(e.el);
  emit();
  return true;
}

export function frontBuildingWindow(): Entry | null {
  const open = listBuildingWindows();
  for (let i = open.length - 1; i >= 0; i--) {
    if (isFrontWindow(open[i]!.el) || i === open.length - 1) return open[i]!;
  }
  return open[open.length - 1] ?? null;
}

/** Higher-z app modals that should eat Escape before a building window. */
const ESC_BLOCK = '.acct-scrim, .jail-screen, .admin-popup, [role="alertdialog"]';

export function closeFrontBuildingWindow(): boolean {
  if (typeof document !== 'undefined' && document.querySelector(ESC_BLOCK)) return false;
  const front = frontBuildingWindow();
  if (!front || !isFrontWindow(front.el)) return false;
  entries.delete(front.id);
  dropFromStack(front.el);
  front.close();
  emit();
  return true;
}

function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (closeFrontBuildingWindow()) {
    e.preventDefault();
    e.stopPropagation();
  }
}

let escBound = false;
export function bindBuildingWindowEscape(): void {
  if (escBound || typeof window === 'undefined') return;
  escBound = true;
  window.addEventListener('keydown', onEsc, true);
}

/** For tests: drop every registration (does not unmount React trees). */
export function resetBuildingWindowsForTest(): void {
  for (const e of entries.values()) dropFromStack(e.el);
  entries.clear();
  emit();
}

bindBuildingWindowEscape();
