/**
 * Kennedy-style space center on the live Chud City map. Entering it opens the space program (VAB, launch and Mission Control).
 *
 * Coordinates are the geometric center of the campus yard. The 3D model's local
 * origin is offset (VAB / pad layout is not centered on the fence), so parent the
 * model at local (-SPACE_CENTER_OX, 0, -SPACE_CENTER_OZ) when the group sits at
 * (SPACE_CENTER.x, 0, SPACE_CENTER.z).
 *
 * Site: top-left (northwest) corner of the 2x map, west of Goldwood and north of
 * the Speedway. Chosen by the overlap scan in tests/space-center-placement.test.ts.
 */
export const SPACE_CENTER_ID = 'spacecenter';

/** Model-origin offset from the geometric center (fence/yard center). */
export const SPACE_CENTER_OX = 2;
export const SPACE_CENTER_OZ = 1;

/** Campus yard (grass pad 108×66), axis-aligned, in world units. */
export const SPACE_CENTER = {
  x: -216,
  z: -409,
  w: 108,
  d: 66,
  rot: 0,
} as const;
