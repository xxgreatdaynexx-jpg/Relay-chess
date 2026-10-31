import * as THREE from 'three';
import { applyPickSkin, skinnedPickaxe } from './pickaxeModel';

/** Low-poly miner avatar for other players in Mines. Faces local +X. Shared geometries/materials across all miners. */
let S: ReturnType<typeof shared> | null = null;
function shared() {
  const L = (c: string) => new THREE.MeshLambertMaterial({ color: c });
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    sph: new THREE.SphereGeometry(0.5, 10, 8),
    hat: new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    brim: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    beam: (() => { const g = new THREE.ConeGeometry(0.42, 3.2, 12, 1, true); g.translate(0, -1.6, 0); g.rotateZ(Math.PI / 2); return g; })(),
    m: {
      skin: L('#d9a27c'), overall: L('#2f4a78'), vest: L('#c8f03a'), stripe: new THREE.MeshBasicMaterial({ color: '#e8e8e0' }),
      boot: L('#3a2716'), glove: L('#8a5a2c'), belt: L('#4a3020'), pouch: L('#6b4a2a'), hat: L('#f2c21a'),
      lamp: new THREE.MeshBasicMaterial({ color: '#fff6d0' }),
      beam: new THREE.MeshBasicMaterial({ color: '#fff1c0', transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    },
  };
}
function part(geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m;
}

export interface MinerRig { root: THREE.Group; legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group; torso: THREE.Group; pick: THREE.Group; skin: string | null; phase: number; swingT: number; lastSw: number; last: THREE.Vector3 }

export function buildMiner(skin: string | null): MinerRig {
  const s = S ?? (S = shared()); const { m } = s;
  const root = new THREE.Group(); root.name = 'miner';
  const leg = (z: number) => {
    const g = new THREE.Group(); g.position.set(0, 0.82, z);
    g.add(part(s.box, m.overall, 0.17, 0.72, 0.17, 0, -0.38, 0), part(s.box, m.boot, 0.27, 0.13, 0.19, 0.04, -0.77, 0));
    return g;
  };
  const legL = leg(-0.11), legR = leg(0.11);
  const torso = new THREE.Group(); torso.position.y = 0.82;
  torso.add(
    part(s.box, m.overall, 0.28, 0.62, 0.44, 0, 0.3, 0),           // overalls
    part(s.box, m.vest, 0.3, 0.42, 0.46, 0, 0.42, 0),              // hi-vis vest
    part(s.box, m.stripe, 0.31, 0.04, 0.47, 0, 0.36, 0), part(s.box, m.stripe, 0.31, 0.04, 0.47, 0, 0.5, 0),
    part(s.box, m.belt, 0.3, 0.07, 0.46, 0, 0.06, 0),              // tool belt
    part(s.box, m.pouch, 0.12, 0.12, 0.1, 0.1, 0.0, -0.2), part(s.box, m.pouch, 0.1, 0.14, 0.08, -0.08, 0.0, 0.21),
    part(s.sph, m.skin, 0.26, 0.28, 0.26, 0, 0.78, 0),             // head
    part(s.hat, m.hat, 0.31, 0.26, 0.31, 0, 0.84, 0), part(s.brim, m.hat, 0.38, 0.02, 0.38, 0.02, 0.84, 0),
    part(s.cyl, m.lamp, 0.07, 0.03, 0.07, 0.15, 0.9, 0),           // headlamp
  );
  const lamp = torso.children[torso.children.length - 1]; lamp.rotation.z = Math.PI / 2;
  const beam = new THREE.Mesh(s.beam, m.beam); beam.position.set(0.17, 0.9, 0); beam.rotation.z = -0.12; torso.add(beam);
  const arm = (z: number) => {
    const g = new THREE.Group(); g.position.set(0, 0.62, z);
    g.add(part(s.box, m.vest, 0.12, 0.36, 0.12, 0, -0.16, 0), part(s.box, m.skin, 0.1, 0.18, 0.1, 0, -0.4, 0), part(s.box, m.glove, 0.12, 0.1, 0.12, 0, -0.52, 0));
    torso.add(g); return g;
  };
  const armL = arm(-0.29), armR = arm(0.29);
  const pick = skinnedPickaxe(skin); pick.scale.setScalar(0.95);
  pick.position.set(0.02, -0.52, 0); pick.rotation.set(0, 0, -Math.PI / 2 + 0.3); // gripped near the butt, head forward
  pick.translateY(-0.18);
  armR.add(pick);
  root.add(legL, legR, torso);
  return { root, legL, legR, armL, armR, torso, pick, skin, phase: 0, swingT: 1, lastSw: 0, last: new THREE.Vector3(NaN, 0, 0) };
}

export function setMinerSkin(r: MinerRig, skin: string | null) { if (r.skin !== skin) { r.skin = skin; applyPickSkin(r.pick, skin); } }

/** Walk cycle from actual displacement; overhead swing when the server's last-hit stamp changes. */
export function animateMiner(r: MinerRig, dt: number, sw: number) {
  const p = r.root.position;
  const moved = Number.isNaN(r.last.x) ? 0 : Math.hypot(p.x - r.last.x, p.z - r.last.z); r.last.copy(p);
  const speed = dt > 0 ? Math.min(6, moved / dt) : 0;
  r.phase += dt * (4 + speed * 2.2) * (speed > 0.2 ? 1 : 0);
  const amp = Math.min(1, speed / 3) * 0.6, w = Math.sin(r.phase);
  r.legL.rotation.z = w * amp; r.legR.rotation.z = -w * amp;
  r.armL.rotation.z = -w * amp * 0.8;
  r.torso.position.y = 0.82 + Math.abs(Math.cos(r.phase)) * amp * 0.05;
  if (sw && sw !== r.lastSw) { if (r.lastSw) r.swingT = 0; r.lastSw = sw; }
  r.swingT = Math.min(1, r.swingT + dt / 0.5);
  const t = r.swingT; let a: number;
  if (t < 0.4) a = 2.4 * (t / 0.4) ** 0.7;               // raise overhead
  else if (t < 0.55) a = 2.4 - 3.0 * ((t - 0.4) / 0.15) ** 2; // chop down
  else a = -0.6 * (1 - (t - 0.55) / 0.45);                  // recover
  r.armR.rotation.z = t < 1 ? a : w * amp * 0.8 + 0.25;
  r.torso.rotation.z = t < 1 ? -Math.max(0, -a) * 0.15 + Math.max(0, a) * 0.04 : 0;
}
