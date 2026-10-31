import * as THREE from 'three';
import { gunMaterials } from './arenaGuns';
import { applySkin } from './skinRender';

/** Shared skinnable pickaxe (Inventory/Market thumbnails, Mines viewmodel and third-person miners).
 *  Material slots follow the gun skin system: 'metal' = forged head, 'wood' = handle, 'polymer' = grip tape,
 *  'steel' = collar/wedge/rivet (never skinned). Head and handle are separate meshes. Handle runs along +Y,
 *  pick point along +X, chisel along −X. Origin = grip end of the handle. */
const LEN = 0.78;
export const PICK_HEAD_Y = LEN - 0.06;

function headGeometry(): THREE.BufferGeometry {
  // Side profile (X along head, Y up): curved pick spike to +X, flared flat chisel to −X, eye block in the middle.
  const s = new THREE.Shape();
  s.moveTo(-0.05, 0.05);
  s.quadraticCurveTo(0.16, 0.05, 0.36, -0.07);    // top edge sweeping down to the point
  s.lineTo(0.355, -0.085);
  s.quadraticCurveTo(0.16, -0.01, 0.05, -0.045);  // underside back to the eye
  s.lineTo(-0.05, -0.045);
  s.quadraticCurveTo(-0.16, -0.035, -0.25, -0.075); // chisel underside flaring down
  s.lineTo(-0.27, -0.07);
  s.lineTo(-0.275, 0.035);                          // flat chisel edge
  s.lineTo(-0.255, 0.045);
  s.quadraticCurveTo(-0.15, 0.03, -0.05, 0.05);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.044, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.008, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -0.022); g.computeVertexNormals();
  return g;
}

function handleGeometry(): THREE.BufferGeometry {
  // Lathe: slight swell at the grip, knob at the butt, taper into the eye.
  const pts = [[0, 0], [0.032, 0], [0.036, 0.015], [0.03, 0.04], [0.027, 0.12], [0.026, 0.35], [0.022, 0.6], [0.02, LEN], [0, LEN]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 14);
}

export function buildPickaxe(): THREE.Group {
  const m = gunMaterials(); const root = new THREE.Group(); root.name = 'pickaxe';
  const handle = new THREE.Mesh(handleGeometry(), m.wood); handle.name = 'pick-handle';
  // Grip tape: tilted overlapping wraps over the lower handle.
  const grip = new THREE.Group(); grip.name = 'pick-grip';
  for (let i = 0; i < 9; i++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.026, 12, 1, true), m.polymer);
    w.position.y = 0.05 + i * 0.022; w.rotation.z = 0.18; w.rotation.x = 0.05; grip.add(w);
  }
  const gripCore = new THREE.Mesh(new THREE.CylinderGeometry(0.0295, 0.0295, 0.2, 12), m.polymer); gripCore.position.y = 0.14; grip.add(gripCore);
  const head = new THREE.Mesh(headGeometry(), m.metal); head.name = 'pick-head'; head.position.y = PICK_HEAD_Y;
  // Steel collar around the eye + top wedge + rivets.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.06, 12), m.steel); collar.position.y = PICK_HEAD_Y - 0.075; collar.name = 'pick-collar';
  const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.05), m.steel); wedge.position.y = PICK_HEAD_Y + 0.058;
  const rivA = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.072, 8), m.steel); rivA.rotation.x = Math.PI / 2; rivA.position.set(0.035, PICK_HEAD_Y + 0.01, 0);
  const rivB = rivA.clone(); rivB.position.x = -0.035;
  root.add(handle, grip, head, collar, wedge, rivA, rivB);
  return root;
}

/** Build + skin in one go (token from the player's loadout.pickaxe, or null for stock). */
export function skinnedPickaxe(token: string | null | undefined): THREE.Group { const g = buildPickaxe(); applyPickSkin(g, token); return g; }

let pbr: Map<THREE.Material, THREE.Material> | null = null;
function wearTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  if (x) { const d = x.createImageData(128, 128); for (let i = 0; i < d.data.length; i += 4) { const v = 150 + Math.random() * 80 - (Math.random() < 0.04 ? 90 : 0); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
/** Stock (unskinned) look: PBR forged steel / oiled wood / rubber tape with a subtle wear roughness map. */
function stockPBR(): Map<THREE.Material, THREE.Material> {
  if (pbr) return pbr;
  const m = gunMaterials(); const wear = wearTex();
  pbr = new Map<THREE.Material, THREE.Material>([
    [m.metal, new THREE.MeshStandardMaterial({ color: '#8d939a', metalness: 0.85, roughness: 0.42, roughnessMap: wear })],
    [m.wood, new THREE.MeshStandardMaterial({ color: '#7b4d27', metalness: 0, roughness: 0.7, roughnessMap: wear })],
    [m.polymer, new THREE.MeshStandardMaterial({ color: '#1f1f22', metalness: 0, roughness: 0.92 })],
    [m.steel, new THREE.MeshStandardMaterial({ color: '#5d6268', metalness: 0.9, roughness: 0.35 })],
  ]);
  return pbr;
}
/** applySkin + PBR stock materials when no skin is equipped. Steel parts stay PBR either way. */
export function applyPickSkin(root: THREE.Object3D, token: string | null | undefined): void {
  applySkin(root, token ?? null);
  const map = stockPBR();
  root.traverse((o) => { const me = o as THREE.Mesh; if (!me.isMesh) return; const base = (me.userData.base ?? me.material) as THREE.Material; if (me.material === base && map.has(base)) { me.userData.base = base; me.material = map.get(base)!; } });
}
