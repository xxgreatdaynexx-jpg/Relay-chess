/** Height (m) of the third-person soldier's head centre in the rig, standing. Matches the server head hitbox (HEAD_Z). */
export const MODEL_HEAD_Y = 1.53;
/** Rig x-shift that cancels the head's sideways swing when the rig is leaned by rotZ about the feet. */
export const leanHeadCompensation = (rotZ: number): number => MODEL_HEAD_Y * Math.sin(rotZ);
/** Where the head centre ends up (rig-local x/y) for a lean rotZ, rig offset (px, py). three.js Z-rotation. */
export function headAfterLean(rotZ: number, px: number, py: number): { x: number; y: number } {
  return { x: px - MODEL_HEAD_Y * Math.sin(rotZ), y: py + MODEL_HEAD_Y * Math.cos(rotZ) };
}
