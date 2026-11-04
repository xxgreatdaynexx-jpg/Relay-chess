import * as THREE from 'three';
/**
 * QA#4: Upper-shaft floors (1-9) used to look identical. Real mines change with depth: timber sets near the surface,
 * rails + shotcrete/rock bolts further down, then wet hard rock with mineral veins. We cycle three looks by floor
 * (1 timber, 2 rail, 3 crystal, 4 timber, ...) with a gradual darkening tint per depth. Shared geometry/materials,
 * one InstancedMesh per prop kind (mobile friendly).
 */
export type DepthProps = 'timber' | 'rail' | 'crystal';
export interface DepthLook { wall: string; floor: string; lamp: string; props: DepthProps }
const LOOKS: DepthLook[] = [
  { wall: '#a08a72', floor: '#7a6650', lamp: '#ffb060', props: 'timber' },   // brown sandstone, warm lanterns
  { wall: '#8e9296', floor: '#5e6166', lamp: '#fff0c8', props: 'rail' },     // grey shotcrete, white work lights
  { wall: '#5e5a6e', floor: '#3e3c4a', lamp: '#8fd0ff', props: 'crystal' },  // dark wet granite, cold light
];
export const depthLook = (floor: number): DepthLook => LOOKS[(Math.max(1, floor) - 1) % 3]!;

const box = new THREE.BoxGeometry(1, 1, 1); box.userData.shared = true;
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8); cyl.userData.shared = true;
const oct = new THREE.OctahedronGeometry(0.5, 0); oct.userData.shared = true;
const disc = new THREE.CircleGeometry(0.5, 14); disc.userData.shared = true;
const MATS = {
  timber: new THREE.MeshLambertMaterial({ color: '#6b4a2a' }),
  steel: new THREE.MeshLambertMaterial({ color: '#7d848c' }),
  sleeper: new THREE.MeshLambertMaterial({ color: '#3e2d1e' }),
  cart: new THREE.MeshLambertMaterial({ color: '#8a4a26' }),
  bolt: new THREE.MeshLambertMaterial({ color: '#c8c2b0' }),
  crystal: new THREE.MeshStandardMaterial({ color: '#7fe6ff', emissive: '#2aa8e0', emissiveIntensity: 1.1, roughness: 0.2 }),
  water: new THREE.MeshStandardMaterial({ color: '#16222c', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.85 }),
};

type Rect = [number, number, number, number];
const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], kind: string) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, ms.length)); ms.forEach((x, i) => m.setMatrixAt(i, x)); m.count = ms.length; m.userData.depthProp = kind; return m; };
const T = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(sx, sy, sz));

/** Wall corners that face open floor = tunnel edges; deterministic subset so props never block a cell. */
function corners(walls: Rect[]): [number, number][] { const seen = new Set<string>(); const out: [number, number][] = [];
  for (const [x0, y0, x1, y1] of walls) for (const c of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as [number, number][]) { const k = c.join(','); if (seen.has(k)) continue; seen.add(k); out.push(c); }
  return out; }

/** Adds the floor's depth props to `g`. `nodes` = ore node positions (open floor), `spawn` = entrance. */
export function addDepthProps(g: THREE.Object3D, look: DepthLook, walls: Rect[], nodes: { x: number; y: number }[], height = 3.6): THREE.Group {
  const grp = new THREE.Group(); grp.userData.depth = look.props; g.add(grp); const cs = corners(walls);
  if (look.props === 'timber') { // timber posts on tunnel corners + cap beams along wall faces
    const posts = cs.filter((_, i) => i % 2 === 0).slice(0, 160).map(([x, z]) => T(x, height / 2, z, 0.28, height, 0.28));
    const caps = walls.filter((_, i) => i % 3 === 0).slice(0, 120).map(([x0, y0, x1, y1]) => { const w = x1 - x0, d = y1 - y0; return w >= d ? T((x0 + x1) / 2, height - 0.2, (y0 + y1) / 2, w + 0.3, 0.3, 0.32) : T((x0 + x1) / 2, height - 0.2, (y0 + y1) / 2, 0.32, 0.3, d + 0.3); });
    grp.add(inst(box, MATS.timber, posts, 'post'), inst(box, MATS.timber, caps, 'cap'));
  } else if (look.props === 'rail') { // rail sleepers + twin rails between ore nodes, ore carts, rock-bolt plates on walls
    const ms: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [], carts: THREE.Matrix4[] = [];
    const ns = nodes.filter((_, i) => i % 4 === 0).slice(0, 40);
    ns.forEach((n, i) => { const ry = (i % 2) * Math.PI / 2; for (let s = -1.5; s <= 1.5; s += 0.75) ms.push(T(n.x + (ry ? 0 : s), 0.04, n.y + (ry ? s : 0), ry ? 1.1 : 0.18, 0.08, ry ? 0.18 : 1.1, 0));
      for (const o of [-0.35, 0.35]) rails.push(T(n.x + (ry ? o : 0), 0.11, n.y + (ry ? 0 : o), ry ? 0.06 : 3.6, 0.06, ry ? 3.6 : 0.06));
      if (i % 3 === 0) carts.push(T(n.x, 0.55, n.y, 1.1, 0.7, 0.8, ry)); });
    const bolts = cs.slice(0, 200).map(([x, z], i) => T(x, 1 + (i % 3) * 0.8, z, 0.1, 0.1, 0.1, i));
    grp.add(inst(box, MATS.sleeper, ms, 'sleeper'), inst(box, MATS.steel, rails, 'rail'), inst(box, MATS.cart, carts, 'cart'), inst(box, MATS.bolt, bolts, 'bolt'));
  } else { // glowing mineral crystals at tunnel corners + still water puddles near nodes
    const cr = cs.filter((_, i) => i % 3 === 0).slice(0, 140).map(([x, z], i) => T(x, 0.3 + (i % 4) * 0.5, z, 0.35, 0.7 + (i % 3) * 0.3, 0.35, i * 1.3, 0.3));
    const pud = nodes.filter((_, i) => i % 5 === 2).slice(0, 30).map((n, i) => T(n.x + 0.6, 0.02, n.y - 0.4, 1.2 + (i % 3) * 0.4, 0.8 + (i % 2) * 0.5, 1, 0, -Math.PI / 2));
    grp.add(inst(oct, MATS.crystal, cr, 'crystal'), inst(disc, MATS.water, pud, 'puddle'));
  }
  return grp;
}
void cyl;
