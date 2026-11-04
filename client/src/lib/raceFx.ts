/**
 * Speedway effects (Millionaire Update racing overhaul): tyre skid marks (one ring-buffered mesh, ~1500 strips) and tyre
 * smoke (a pooled sprite cloud). Used for our own car (from the physics' skid output) and for other drivers (their
 * slide is inferred from snapshots: movement direction vs heading), so everyone sees everyone's drifts.
 */
import * as THREE from 'three';

const MAX_Q = 1500, MAX_SMOKE = 140;
function smokeTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(235,235,240,0.9)'); g.addColorStop(0.5, 'rgba(210,210,218,0.45)'); g.addColorStop(1, 'rgba(200,200,210,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export type Wheels = { lx: number; lz: number; rx: number; rz: number };
/** Rear-wheel contact points for a car at (x, z) heading a with half-track hw and rear axle `back` units behind centre. */
export const rearWheels = (x: number, z: number, a: number, back: number, hw: number): Wheels => {
  const c = Math.cos(a), s = Math.sin(a); const bx = x - c * back, bz = z - s * back; // right = (-s, c)
  return { lx: bx + s * hw, lz: bz - c * hw, rx: bx - s * hw, rz: bz + c * hw };
};

export function createRaceFx(scene: THREE.Scene) {
  // Skid marks: each quad = 4 verts; alpha via vertex colour lerp to the track tone is avoided, we use one translucent material.
  const pos = new Float32Array(MAX_Q * 4 * 3); const idx: number[] = [];
  for (let q = 0; q < MAX_Q; q++) { const o = q * 4; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.setDrawRange(0, 0);
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0d, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12, side: THREE.DoubleSide });
  const marks = new THREE.Mesh(g, skidMat); marks.frustumCulled = false; marks.renderOrder = 2; scene.add(marks);
  let q = 0, used = 0; const last = new Map<string, Wheels>();
  const strip = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz); if (L < 0.05 || L > 4) return;
    const nx = -dz / L * w, nz = dx / L * w; const o = q * 12; const y = 0.105;
    pos.set([ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz], o);
    q = (q + 1) % MAX_Q; used = Math.min(MAX_Q, used + 1); g.setDrawRange(0, used * 6); g.attributes.position!.needsUpdate = true;
  };
  // Smoke sprites
  const tex = smokeTex(); const puffs: Array<{ s: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number; grow: number }> = [];
  for (let i = 0; i < MAX_SMOKE; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1 }); }
  let pi = 0; let acc = 0;
  const puff = (x: number, z: number, k: number) => {
    const p = puffs[pi]!; pi = (pi + 1) % MAX_SMOKE; p.life = p.max = 0.9 + Math.random() * 0.7 * k; p.vx = (Math.random() - 0.5) * 1.2; p.vz = (Math.random() - 0.5) * 1.2; p.vy = 0.8 + Math.random() * 0.8;
    p.grow = 1.6 + k * 2; p.s.position.set(x, 0.35, z); p.s.scale.setScalar(0.6); p.s.visible = true; (p.s.material as THREE.SpriteMaterial).opacity = 0.55 * Math.min(1, 0.4 + k);
  };
  return {
    /** Feed one car's rear wheels this frame with a skid intensity 0..1 (0 breaks the trail). */
    tyres(id: string, wh: Wheels, k: number, dt: number) {
      const prev = last.get(id);
      if (k > 0.08) {
        if (prev) { strip(prev.lx, prev.lz, wh.lx, wh.lz, 0.14); strip(prev.rx, prev.rz, wh.rx, wh.rz, 0.14); }
        last.set(id, wh); acc += dt * 26 * k;
        while (acc > 1) { acc -= 1; puff(wh.lx, wh.lz, k); puff(wh.rx, wh.rz, k); }
      } else last.delete(id);
    },
    forget(id: string) { last.delete(id); },
    step(dt: number) {
      for (const p of puffs) { if (p.life <= 0) continue; p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
        const f = p.life / p.max; p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt; p.s.scale.setScalar(0.6 + (1 - f) * p.grow);
        (p.s.material as THREE.SpriteMaterial).opacity = 0.5 * f; }
    },
    dispose() { scene.remove(marks); g.dispose(); skidMat.dispose(); for (const p of puffs) { scene.remove(p.s); p.s.material.dispose(); } tex.dispose(); },
  };
}
export type RaceFx = ReturnType<typeof createRaceFx>;
