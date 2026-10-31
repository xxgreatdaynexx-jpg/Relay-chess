/** Device tier for the 3D city. 'high' gets bloom + full pixel ratio; 'low' drops to 1x pixels and fewer effects. */
export type WorldTier = 'low' | 'mid' | 'high';
export function worldTier(env: { cores?: number; memory?: number; dpr?: number; touch?: boolean; width?: number } = {}): WorldTier {
  const cores = env.cores ?? 4, mem = env.memory ?? 4, touch = !!env.touch, w = env.width ?? 1280;
  if (cores <= 4 || mem <= 2) return 'low';
  if (touch || w < 900 || cores < 8 || mem < 8) return 'mid';
  return 'high';
}
export function detectWorldTier(): WorldTier {
  if (typeof navigator === 'undefined') return 'mid';
  const n = navigator as Navigator & { deviceMemory?: number };
  return worldTier({ cores: n.hardwareConcurrency, memory: n.deviceMemory ?? 8, dpr: window.devicePixelRatio, touch: matchMedia?.('(pointer: coarse)').matches, width: window.innerWidth });
}
export const TIER_PIXEL_RATIO: Record<WorldTier, number> = { low: 1, mid: 1.25, high: 1.5 };
/** World-space label scale so signs stay readable (never tiny on phones, never huge up close). */
export function labelScale(dist: number, portrait: boolean): number {
  const s = dist * (portrait ? 0.1 : 0.062);
  return Math.min(portrait ? 24 : 20, Math.max(portrait ? 7 : 5.5, s));
}
