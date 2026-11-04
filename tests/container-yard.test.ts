import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { containerYard, boxLen, C40, type Box } from '../client/src/lib/containerYard';
import { buildHarbour, QUAY_TOP } from '../client/src/lib/ocean3d';

const hubs = [
  { name: 'city', o: { x: 0, z0: 0, z1: 40, quayW: 76, quayD: 16 } },
  { name: 'port', o: { x: 30, z0: 10, z1: -30, quayW: 48, quayD: 10, side: -1 } },
];
function yardOf(o: Parameters<typeof buildHarbour>[0]) {
  const g = buildHarbour(o); let y: Box[] | undefined; let meshes: THREE.InstancedMesh[] = [];
  g.traverse((c) => { if (c.userData.yard) y = c.userData.yard; if ((c as THREE.InstancedMesh).isInstancedMesh && c.parent?.userData.yard) meshes.push(c as THREE.InstancedMesh); });
  return { y: y!, meshes };
}
const ov = (a: Box, b: Box) => Math.abs(a.x - b.x) * 2 < boxLen(a) + boxLen(b) - 1e-6 && Math.abs(a.z - b.z) < C40.w - 1e-6 && Math.abs(a.y - b.y) < C40.h - 1e-6;

describe('harbour container yard', () => {
  for (const h of hubs) it(`${h.name}: grid-snapped, identical rotation, no overlap, grounded, flush stacks`, () => {
    const { y, meshes } = yardOf(h.o as never);
    expect(y.length).toBeGreaterThan(10);
    // identical rotation: every instance matrix has identity rotation
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const im of meshes) for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.decompose(p, q, s); expect(Math.abs(q.w)).toBeCloseTo(1, 6); }
    // straight rows: few distinct z values, each row parallel to the quay (constant z)
    const zs = [...new Set(y.map((b) => b.z.toFixed(4)))]; expect(zs.length).toBeLessThanOrEqual(8);
    // tiers: y exactly deck + h*(k+0.5), max 3; each stack column continuous from the deck
    const cols = new Map<string, number[]>();
    for (const b of y) {
      const k = (b.y - QUAY_TOP) / C40.h - 0.5; expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6); expect(Math.round(k)).toBeLessThan(3);
      const key = `${b.x.toFixed(3)}|${b.z.toFixed(3)}|${b.size}`; cols.set(key, [...(cols.get(key) ?? []), Math.round(k)]);
    }
    for (const t of cols.values()) expect(t.sort().join()).toBe(t.map((_, i) => i).join());
    for (let i = 0; i < y.length; i++) for (let j = i + 1; j < y.length; j++) expect(ov(y[i]!, y[j]!)).toBe(false);
    // on the apron, clear of the pier
    const zq = h.o.z0 - Math.sign(h.o.z1 - h.o.z0) * h.o.quayD / 2 + Math.sign(h.o.z1 - h.o.z0);
    for (const b of y) { expect(Math.abs(b.z - zq) + C40.w / 2).toBeLessThanOrEqual(h.o.quayD / 2); expect(Math.abs(b.x - h.o.x) - boxLen(b) / 2).toBeGreaterThanOrEqual(4.5); expect(Math.abs(b.x - h.o.x) + boxLen(b) / 2).toBeLessThanOrEqual(h.o.quayW / 2); }
  });
  it('is deterministic', () => expect(containerYard({ x0: 0, x1: 30, z0: 0, z1: 10, deckY: 1, seed: 5 })).toEqual(containerYard({ x0: 0, x1: 30, z0: 0, z1: 10, deckY: 1, seed: 5 })));
});
