/**
 * Full-screen games (Hockey, Arena, Mines, Factory, …) mark their tab with data-pause-city.
 * The city / resort / fort maps poll this and stop their 3D loops, trucks and protests so the
 * game on top gets the GPU.
 */
export const PAUSE_CITY_SEL = '[data-pause-city][aria-expanded="true"]';

/** True when a full-screen game tab is open over the map. */
export function fullScreenGameOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector(PAUSE_CITY_SEL);
}
