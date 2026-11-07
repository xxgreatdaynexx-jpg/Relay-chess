import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createJetController, fortJetIntro, type Pose } from '../client/src/lib/fortJet';

const mk = () => { const scene = new THREE.Scene(); let disposed = 0;
  const c = createJetController<string>({ scene, build: (m) => { const g = new THREE.Group(); g.name = m; return g; }, dispose: () => { disposed++; },
    poseAt: (_m, u): Pose => [u, 0, 0, 0, 0], place: (j, x) => { j.position.x = x; } });
  return { scene, c, disposed: () => disposed, jets: () => scene.children.filter((o) => o.name === 'G700') }; };

describe('Fort McChud jet: drawn only for an actual flight', () => {
  it('owner reloads / arrived as a passenger (no arrivedBy): nothing is spawned', () => {
    expect(fortJetIntro(null)).toBeNull(); expect(fortJetIntro(undefined)).toBeNull(); expect(fortJetIntro('')).toBeNull();
    const { c, jets } = mk(); expect(jets()).toHaveLength(0); expect(c.jet).toBeNull();
  });
  it('real own-jet arrival lands, then jetHide removes and disposes the model; remount spawns no ghost', () => {
    expect(fortJetIntro('G700')).toBe('land');
    const { c, jets, disposed } = mk(); let landed = false;
    c.show('G700', 'land', () => { landed = true; c.hide(); });
    expect(jets()).toHaveLength(1); expect(c.busy()).toBe(true);
    c.step(4); expect(jets()).toHaveLength(1); expect(landed).toBe(false);
    c.step(6); expect(landed).toBe(true); expect(jets()).toHaveLength(0); expect(c.jet).toBeNull(); expect(disposed()).toBe(1); expect(c.busy()).toBe(false);
    const again = mk(); expect(fortJetIntro(null)).toBeNull(); expect(again.jets()).toHaveLength(0); // remount after arrival cleared
  });
  it('take-off home still animates and finishes hidden', () => {
    const { c, jets } = mk(); let done = false; c.show('G700', 'takeoff', () => { done = true; });
    expect(jets()).toHaveLength(1); expect(c.jet!.visible).toBe(true); c.step(8); expect(done).toBe(true); expect(c.jet!.visible).toBe(false);
    c.hide(); expect(jets()).toHaveLength(0);
  });
});
