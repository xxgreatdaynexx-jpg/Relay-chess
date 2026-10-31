/** Multi-kill chains ("DOUBLE KILL" …): each kill within MULTI_WINDOW_MS of the previous one extends the chain. */
export const MULTI_WINDOW_MS = 5000;
export type MultiTier = 'double' | 'triple' | 'quadra' | 'penta' | 'multi';
export interface MultiChain { n: number; at: number }

/** Next chain after a kill at `now`. Exactly MULTI_WINDOW_MS after the last kill still counts; the window restarts on every kill. */
export function nextChain(prev: MultiChain | undefined, now: number): MultiChain {
  return prev && now - prev.at <= MULTI_WINDOW_MS && now >= prev.at ? { n: prev.n + 1, at: now } : { n: 1, at: now };
}

/** Tier for a chain length: 2 double, 3 triple, 4 quadra, 5 penta, 6+ multi (every further kill repeats MULTI). */
export function multiTier(n: number): MultiTier | null {
  if (n < 2) return null;
  return n === 2 ? 'double' : n === 3 ? 'triple' : n === 4 ? 'quadra' : n === 5 ? 'penta' : 'multi';
}
export const MULTI_TITLE: Record<MultiTier, string> = { double: 'DOUBLE KILL', triple: 'TRIPLE KILL', quadra: 'QUADRA KILL', penta: 'PENTA KILL', multi: 'MULTI KILL' };
/** 1..5 — the pop-up gets bigger and flashier per tier. */
export const MULTI_LEVEL: Record<MultiTier, number> = { double: 1, triple: 2, quadra: 3, penta: 4, multi: 5 };
