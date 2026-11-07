import type * as THREE from 'three';

/** Fort McChud private jet: only drawn while it is actually flying (landing after an own-jet arrival, or take-off home).
 *  Owning a jet alone never spawns a model (no parked/ghost jet on reload or after arriving as a passenger). */
export type JetMode = 'land' | 'takeoff';
export type Pose = [number, number, number, number, number];
export function createJetController<M>(o: { scene: THREE.Object3D; build: (m: M) => THREE.Group; dispose: (g: THREE.Object3D) => void;
  poseAt: (mode: JetMode, u: number) => Pose; place: (j: THREE.Group, ...p: Pose) => void; onStart?: () => void }) {
  let jet: THREE.Group | null = null; let anim: { mode: JetMode; t: number; dur: number; done?: () => void } | null = null;
  const hide = () => { if (jet) { o.scene.remove(jet); o.dispose(jet); jet = null; } anim = null; };
  const step = (dt: number) => {
    if (!jet || !anim) return; anim.t += dt; const u = Math.min(1, anim.t / anim.dur); o.place(jet, ...o.poseAt(anim.mode, u));
    if (u >= 1) { const a = anim; anim = null; if (a.mode === 'takeoff') jet.visible = false; a.done?.(); }
  };
  return {
    step,
    /** Fly `model` at YMC: 'land' (approach, touchdown, taxi in) or 'takeoff' (taxi out, roll, climb); `done` fires when it finishes. */
    show(model: M, mode: JetMode, done?: () => void) { hide(); jet = o.build(model); o.scene.add(jet); o.onStart?.(); anim = { mode, t: 0, dur: mode === 'land' ? 9 : 7, done }; step(0); },
    hide,
    busy: () => !!anim,
    get jet() { return jet; },
  };
}
/** What the map plays on mount: a landing only when this session actually just flew in by jet; never for ownership alone. */
export const fortJetIntro = (arrivedBy: string | null | undefined): JetMode | null => (arrivedBy ? 'land' : null);
