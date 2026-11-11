/** Local-only preview of home interiors. Open /interior-preview.html?type=mansion&legacy=1 */
import * as THREE from 'three';
import { FLOOR_BY_ID, FURN_BY_ID, WALL_BY_ID, footprint, type Placed } from '../../shared/homes';
import { HOME_PLAN_TYPES, fitsPlan, homePlan, type HomePlan } from '../../shared/homePlan';
import { buildFurniture } from './lib/homeModels';
import { buildHomeShell, buildLegacyShell, homeCamera } from './lib/homeInterior';

/** Place a few pieces in the rooms they belong in (preview only — player layouts are unchanged). */
function furnish(plan: HomePlan): Placed[] {
  const items: Placed[] = [];
  let n = 0;
  const put = (roomId: string, list: Array<[string, number, number, number?]>) => {
    const r = plan.rooms.find((x) => x.id === roomId);
    if (!r) return;
    for (const [f, dx, dz, rot] of list) {
      if (!FURN_BY_ID.get(f)) continue;
      const p: Placed = { uid: `d${++n}`, f, x: r.x + dx, z: r.z + dz, r: rot ?? 0 };
      if (fitsPlan(plan, items, p)) items.push(p);
    }
  };
  put('living', [['rug', 1, 1], ['sofa', 1, 2], ['coffee', 2, 4], ['lamp', 5, 1], ['plant', Math.min(6, 3), 4]]);
  put('kitchen', [['fridge', 0, 1], ['stove', 1, 1], ['counter', 0, 3]]);
  put('dining', [['tuliptable', 1, 2], ['plant', 0, 0]]);
  put('bedroom', [['kingbed', 1, 1], ['dresser', 1, 3]]);
  put('bed1', [['kingbed', 1, 1], ['dresser', 4, 1]]);
  put('bed2', [['bed', 1, 0], ['nightstand', 0, 0]]);
  put('bed3', [['bed', 0, 0]]);
  put('office', [['desk', 1, 1], ['armchair', 3, 1]]);
  put('library', [['bookshelf', 1, 1], ['armchair', 4, 2]]);
  put('lounge', [['sofa', 1, 1], ['lamp', 5, 1]]);
  put('foyer', [['plant', 1, 1], ['console', 2, 0]]);
  put('bath', [['plant', 1, 1]]);
  put('bath1', [['plant', 1, 1]]);
  return items;
}

const q = new URLSearchParams(location.search);
const type = HOME_PLAN_TYPES.includes(q.get('type') ?? '') ? q.get('type')! : 'house';
const legacy = q.get('legacy') === '1';
const furnished = q.get('bare') !== '1';
const wall = WALL_BY_ID.get(q.get('wall') ?? 'plaster') ?? WALL_BY_ID.get('plaster')!;
const floor = FLOOR_BY_ID.get(q.get('floor') ?? 'oak') ?? FLOOR_BY_ID.get('oak')!;

const demo: Placed[] = [
  { uid: 's', f: 'sofa', x: 1, z: 2, r: 0 },
  { uid: 'c', f: 'coffee', x: 2, z: 4, r: 0 },
  { uid: 'l', f: 'lamp', x: 5, z: 1, r: 0 },
  { uid: 'p', f: 'plant', x: 6, z: 4, r: 0 },
  { uid: 'f', f: 'fridge', x: 8, z: 1, r: 0 },
  { uid: 't', f: 'stove', x: 9, z: 1, r: 0 },
  { uid: 'k', f: 'counter', x: 8, z: 3, r: 0 },
  { uid: 'b', f: 'kingbed', x: 3, z: 7, r: 0 },
  { uid: 'd', f: 'dresser', x: 6, z: 7, r: 0 },
  { uid: 'g', f: 'dining', x: 9, z: 5, r: 0 },
  { uid: 'r', f: 'rug', x: 1, z: 1, r: 0 },
];

const plan = homePlan(type);
const items = furnished ? (legacy ? demo : furnish(plan)) : [];
const c = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas: c, antialias: true });
r.setPixelRatio(Math.min(2, devicePixelRatio));
r.shadowMap.enabled = true;
r.toneMapping = THREE.ACESFilmicToneMapping;
r.toneMappingExposure = 1.08;
r.outputColorSpace = THREE.SRGBColorSpace;
const sc = new THREE.Scene();
sc.background = new THREE.Color(0x14121c);
const shell = legacy
  ? buildLegacyShell(wall.color, floor.color)
  : buildHomeShell(plan, { wall: wall.color, wallAccent: wall.accent, floor: floor.color, floorAccent: floor.accent, low: false });
sc.add(shell.group);
const view = legacy ? { x: 6, y: 12, z: 18, lx: 6, ly: 0, lz: 4.5 } : homeCamera(plan);
const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
cam.position.set(view.x, view.y, view.z);
cam.lookAt(view.lx, view.ly, view.lz);
const furn = new THREE.Group(); sc.add(furn);
for (const p of items) {
  const f = FURN_BY_ID.get(p.f); if (!f) continue;
  const g = buildFurniture(f);
  const { w, d } = footprint(f, p.r);
  g.position.set(p.x + w / 2, 0, p.z + d / 2);
  g.rotation.y = -p.r * Math.PI / 2;
  furn.add(g);
}
const hud = document.getElementById('hud')!;
hud.textContent = legacy
  ? `${type} · before (12×10 one room)`
  : `${type} · ${plan.w}×${plan.d} · ${plan.rooms.length} rooms (${plan.rooms.map((x) => x.name).join(', ')})`;
const fit = () => { r.setSize(c.clientWidth, c.clientHeight, false); cam.aspect = c.clientWidth / Math.max(1, c.clientHeight); cam.updateProjectionMatrix(); };
new ResizeObserver(fit).observe(c); fit();
const loop = () => { requestAnimationFrame(loop); r.render(sc, cam); };
loop();
(window as unknown as { __ready?: boolean }).__ready = true;
