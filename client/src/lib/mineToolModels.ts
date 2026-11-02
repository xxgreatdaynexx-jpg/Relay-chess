import * as THREE from 'three';
import { buildPickaxe, applyPickSkin } from './pickaxeModel';
import { skinMaterial, skinUVs } from './skinRender';
import { toolDef, type MineToolId } from '../../../shared/mineTools';

/**
 * Held 3D models for the buyable mining tools (request #16). Same frame as the pickaxe (origin = grip, +Y up the tool,
 * working end toward +X after the viewmodel's rotation) so the Mines viewmodel and third-person miners can swap them in.
 * userData.spin = mesh spun while working (drill bits), userData.piston = jackhammer chisel, userData.flame = plasma jet.
 */
const std = (color: string, metal = 0.6, rough = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });

function drill(body: string, big: boolean): THREE.Group {
  const g = new THREE.Group(); const s = big ? 1.18 : 1;
  const shell = std(body, 0.1, 0.55), dark = std('#1d1f22', 0.1, 0.85), steel = std('#b9c0c8', 0.9, 0.3);
  // Pistol grip along +Y from the origin, battery pack at the butt, motor housing on top pointing +X.
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.2 * s, 0.07 * s), dark); grip.position.set(0, 0.1 * s, 0); grip.rotation.z = -0.18;
  const batt = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.05 * s, 0.09 * s), big ? std('#2a2a2a', 0.1, 0.7) : shell); batt.position.set(0.015, -0.01, 0);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.055 * s, 0.24 * s, 16), shell); motor.rotation.z = Math.PI / 2; motor.position.set(0.06 * s, 0.24 * s, 0);
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.052 * s, 0.052 * s, 0.03 * s, 16), dark); vent.rotation.z = Math.PI / 2; vent.position.set(-0.04 * s, 0.24 * s, 0);
  const trig = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), std('#d03030', 0.1, 0.6)); trig.position.set(0.045 * s, 0.17 * s, 0);
  const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.07 * s, 14), dark); chuck.rotation.z = Math.PI / 2; chuck.position.set(0.21 * s, 0.24 * s, 0);
  // Bit: fluted spiral (twisted box stack) + cone tip, spun around its own X axis.
  const bit = new THREE.Group(); bit.position.set(0.245 * s, 0.24 * s, 0); bit.name = 'drill-bit';
  const L = big ? 0.26 : 0.2;
  for (let i = 0; i < 12; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(L / 12 + 0.002, 0.012 * s, 0.03 * s), steel); f.position.x = (i + 0.5) * (L / 12); f.rotation.x = i * 0.5; bit.add(f); }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * s, 0.008 * s, L, 8), steel); core.rotation.z = Math.PI / 2; core.position.x = L / 2; bit.add(core);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016 * s, 0.04, 10), steel); tip.rotation.z = -Math.PI / 2; tip.position.x = L + 0.02; bit.add(tip);
  if (big) { const side = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), dark); side.position.set(0.15, 0.24 * s, 0.07); side.rotation.x = Math.PI / 2; g.add(side); }
  motor.userData.skinPart = true; if (!big) batt.userData.skinPart = true;
  g.add(grip, batt, motor, vent, trig, chuck, bit); g.userData.spin = bit;
  return g;
}

function jackhammer(): THREE.Group {
  const g = new THREE.Group(); const red = std('#e05a20', 0.2, 0.5), dark = std('#222428', 0.3, 0.7), steel = std('#aeb5bd', 0.9, 0.3);
  // T-handle at the grip, long body up +Y, chisel at the far end (the working end).
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 10), dark); bar.rotation.x = Math.PI / 2; bar.position.y = 0.02;
  const gripsA = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.09, 10), std('#111', 0, 0.95)); gripsA.rotation.x = Math.PI / 2; gripsA.position.set(0, 0.02, 0.11);
  const gripsB = gripsA.clone(); gripsB.position.z = -0.11;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.38, 16), red); body.position.y = 0.23;
  const fins = new THREE.Group(); for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.008, 6, 20), dark); f.rotation.x = Math.PI / 2; f.position.y = 0.1 + i * 0.05; fins.add(f); }
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 8, 20, Math.PI), std('#202020', 0, 0.9)); hose.position.set(-0.07, 0.12, 0); hose.rotation.z = Math.PI / 2;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.06, 12), steel); collar.position.y = 0.45;
  const piston = new THREE.Group(); piston.position.y = 0.48; piston.name = 'jack-chisel';
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), steel); rod.position.y = 0.1;
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), steel); point.position.y = 0.23; point.rotation.y = Math.PI / 4;
  piston.add(rod, point);
  body.userData.skinPart = true;
  g.add(bar, gripsA, gripsB, body, fins, hose, collar, piston); g.userData.piston = piston;
  return g;
}

function plasma(): THREE.Group {
  const g = new THREE.Group(); const shell = std('#2c3138', 0.5, 0.4), accent = std('#4ad8ff', 0.3, 0.3, { emissive: '#1a8fbf', emissiveIntensity: 0.8 }), steel = std('#c8ced6', 0.95, 0.2);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.2, 14), std('#15171a', 0.1, 0.9)); grip.position.y = 0.1;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.26, 16), shell); body.position.y = 0.33;
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.006, 8, 24), accent); ring1.rotation.x = Math.PI / 2; ring1.position.y = 0.26;
  const ring2 = ring1.clone(); ring2.position.y = 0.38;
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), accent); cell.position.set(-0.055, 0.3, 0);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.08, 14), steel); nozzle.position.y = 0.5;
  const flame = new THREE.Group(); flame.position.y = 0.54; flame.name = 'plasma-jet';
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.12, 10), new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); core.position.y = 0.06;
  const glow = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 12), new THREE.MeshBasicMaterial({ color: '#4ad8ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); glow.position.y = 0.08;
  flame.add(core, glow); flame.visible = false;
  const light = new THREE.PointLight('#6ae0ff', 0, 2.5, 2); light.position.y = 0.6;
  body.userData.skinPart = true;
  g.add(grip, body, ring1, ring2, cell, nozzle, flame, light); g.userData.flame = flame; g.userData.light = light;
  return g;
}

function steelPick(): THREE.Group {
  const g = buildPickaxe(); applyPickSkin(g, null);
  // Polished steel head + dark ash handle so it reads different from the starter pick.
  g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.name === 'pick-head') { m.userData.skinPart = true; } if (m.name === 'pick-head') m.material = std('#dfe7ef', 0.45, 0.25, { emissive: '#2a3036', emissiveIntensity: 0.4 }); if (m.name === 'pick-handle') m.material = std('#3a2a1e', 0, 0.6); });
  return g;
}

/** Fresh held model for a tool. The starter pickaxe is null here: callers keep the skinnable pickaxe for it. */
export function buildMineTool(id: MineToolId): THREE.Group | null {
  const d = toolDef(id); let g: THREE.Group | null = null;
  if (id === 'steel_pick') g = steelPick();
  else if (d.kind === 'drill') g = drill(d.color, id === 'power_drill');
  else if (d.kind === 'hammer') g = jackhammer();
  else if (d.kind === 'plasma') g = plasma();
  if (g) { g.name = `tool-${id}`; g.userData.kind = d.kind; }
  return g;
}

/** Per-frame working animation: drills spin + buzz, the jackhammer chisel hammers, the plasma jet flickers. `work` 0..1. */
export function animateMineTool(g: THREE.Object3D, t: number, work: number): { jx: number; jy: number } {
  const spin = g.userData.spin as THREE.Object3D | undefined, piston = g.userData.piston as THREE.Object3D | undefined, flame = g.userData.flame as THREE.Object3D | undefined, light = g.userData.light as THREE.PointLight | undefined;
  if (spin) spin.rotation.x += (0.25 + work * 1.6);
  if (piston) piston.position.y = 0.48 + (work > 0 ? Math.abs(Math.sin(t * 60)) * 0.035 : 0);
  if (flame) { flame.visible = work > 0; flame.scale.set(1, 0.8 + Math.random() * 0.5, 1); if (light) light.intensity = work > 0 ? 1.2 + Math.random() * 0.6 : 0; }
  const amp = work > 0 ? (piston ? 0.012 : flame ? 0.002 : 0.006) : 0;
  return { jx: (Math.random() - 0.5) * amp, jy: (Math.random() - 0.5) * amp };
}

/** Equipped pickaxe skin on a Tool Shop tool (pt1349u): the skin's pattern/colours/finish go on the main body or head
 *  (drill motor housing, jackhammer body, plasma barrel, steel pick head). Bits, chisel, jet, grips stay stock so the
 *  tool still reads as itself. null = the tool's default look. Cheap when unchanged. */
export function skinMineTool(g: THREE.Object3D, token: string | null | undefined): void {
  const tk = token ?? null; if ((g.userData.toolSkin ?? null) === tk) return; g.userData.toolSkin = tk;
  const sm = tk ? skinMaterial(tk) : null;
  if (sm && !g.userData.skinUV) { g.userData.skinUV = true; skinUVs(g); }
  g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.userData.skinPart) return; if (!m.userData.toolBase) m.userData.toolBase = m.material; m.material = sm ? sm.mat : m.userData.toolBase as THREE.Material; });
}
