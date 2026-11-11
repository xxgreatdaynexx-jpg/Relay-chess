import * as THREE from 'three';
import {
  buildEstateModel, buildGoldwoodMansion, buildHyperFarm, buildAirportTerminal,
  buildPlasticsPlant, buildRig, buildRigDock, buildWinery, buildOrchardSite, buildOrchardTree,
} from '../../client/src/lib/estateModels';
import { ESTATE_BUILD_ORDER, ESTATE_BUILDS } from '../../shared/estateProjects';
import { orchardPlots } from '../../shared/orchard';
import { ORCHARD_TREES } from '../../shared/farm';

const W = 960, H = 540;
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 4000);

type Cam = { pos: [number, number, number]; look: [number, number, number] };
const CAM: Record<string, Cam> = {
  default: { pos: [36, 18, 40], look: [0, 4, 0] },
  data_center: { pos: [38, 16, 32], look: [0, 4, 0] },
  bitcoin_farm: { pos: [32, 14, 30], look: [0, 3, 0] },
  monument: { pos: [18, 12, 22], look: [0, 6, 0] },
  mansion: { pos: [28, 12, 34], look: [2, 3, 4] },
  highrise: { pos: [38, 28, 40], look: [0, 18, 0] },
  power_plant: { pos: [42, 18, 36], look: [0, 8, 0] },
  hyper: { pos: [26, 14, 28], look: [0, 4, 0] },
  rig: { pos: [28, 16, 28], look: [0, 8, 0] },
  dock: { pos: [30, 14, 28], look: [0, 6, 0] },
  plastics: { pos: [36, 16, 34], look: [0, 8, 0] },
  winery: { pos: [26, 12, 32], look: [0, 3, 6] },
  airport: { pos: [48, 22, 40], look: [0, 8, -4] },
  goldwood: { pos: [28, 12, 34], look: [2, 3, 4] },
  orchard: { pos: [28, 14, 28], look: [0, 2, 2] },
  aerial: { pos: [80, 90, 120], look: [0, 0, 20] },
  lots: { pos: [48, 22, 52], look: [16, 6, 4] },
};

function shot(title: string, file: string, build: (scene: THREE.Scene) => void, key = 'default') {
  const c = CAM[key] ?? CAM.default!;
  cam.position.set(...c.pos); cam.lookAt(...c.look);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b7d8);
  scene.fog = new THREE.Fog(0x87b7d8, 80, 900);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x445566, 1.05));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.35); sun.position.set(30, 40, 16); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(key === 'aerial' ? 800 : 120, 48), new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  build(scene);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  const img = new Image(); img.src = url; img.width = W; img.height = H;
  const wrap = document.createElement('figure');
  wrap.className = 'shot';
  wrap.dataset.file = file;
  wrap.dataset.title = title;
  wrap.dataset.url = url;
  const cap = document.createElement('figcaption');
  cap.textContent = title;
  wrap.append(img, cap);
  document.getElementById('gallery')!.append(wrap);
}

function main() {
  document.getElementById('status')!.textContent = 'rendering…';
  for (const id of ESTATE_BUILD_ORDER) {
    const plan = ESTATE_BUILDS[id];
    for (let stage = 0; stage <= 4; stage++) {
      const label = stage === 4 ? 'complete' : `stage-${stage + 1}`;
      const name = stage === 4 ? 'finished' : plan.stages[stage]!.name;
      shot(`${plan.name} — ${label.replace('-', ' ')} (${name})`, `${id}-${label}`, (s) => s.add(buildEstateModel(id, stage, 0)), id);
    }
  }
  for (let stage = 0; stage <= 4; stage++) {
    const label = stage === 4 ? 'complete' : `stage-${stage + 1}`;
    shot(`Hyper farm — ${label.replace('-', ' ')}`, `hyper-${label}`, (s) => s.add(buildHyperFarm(stage, 0, 24, 18)), 'hyper');
  }
  for (let stage = 0; stage <= 4; stage++) {
    const label = stage === 4 ? 'ready' : `stage-${stage + 1}`;
    shot(`Offshore rig on the dock — ${label.replace('-', ' ')}`, `rig-dock-${label}`, (s) => s.add(buildRig(stage, 0, false)), 'rig');
  }
  shot('Launched offshore rig', 'rig-launched', (s) => s.add(buildRig(4, 0, true)), 'rig');
  shot('Shore construction dock', 'rig-dock', (s) => s.add(buildRigDock()), 'dock');
  shot('Chud City Plastics Plant', 'plastics-plant', (s) => s.add(buildPlasticsPlant()), 'plastics');
  shot('Goldwood mansion', 'goldwood-mansion', (s) => s.add(buildGoldwoodMansion(2, 3)), 'goldwood');
  shot('Winery and press', 'winery', (s) => s.add(buildWinery()), 'winery');
  shot('International terminal', 'airport-terminal', (s) => s.add(buildAirportTerminal()), 'airport');

  // Orchard growth: empty pad, saplings, young trees, mature canopy, fruiting apples
  const plot = orchardPlots()[0]!;
  const plantOrchard = (s: THREE.Scene, progress: number, ready: boolean, matured: boolean) => {
    const site = buildOrchardSite(plot.w, plot.d); s.add(site);
    const cols = plot.cols, rows = plot.rows;
    for (let i = 0; i < cols * rows; i++) {
      const x = -((cols - 1) * 2) / 2 + (i % cols) * 2;
      const z = -((rows - 1) * 2) / 2 + Math.floor(i / cols) * 2 - 1;
      const t = buildOrchardTree(ORCHARD_TREES[0]!.color, progress, ready, matured);
      t.position.set(x, 0.1, z); s.add(t);
    }
  };
  shot('Orchard — empty rows and packing shed', 'orchard-empty', (s) => s.add(buildOrchardSite(plot.w, plot.d)), 'orchard');
  shot('Orchard — saplings just planted', 'orchard-sapling', (s) => plantOrchard(s, 15, false, false), 'orchard');
  shot('Orchard — young trees still growing', 'orchard-young', (s) => plantOrchard(s, 45, false, false), 'orchard');
  shot('Orchard — mature canopy, first fruit still weeks out', 'orchard-mature', (s) => plantOrchard(s, 85, false, true), 'orchard');
  shot('Orchard — apples ready to pick', 'orchard-fruiting', (s) => plantOrchard(s, 100, true, true), 'orchard');

  // Aerial of the expanded east land (lots, orchards, plants, wineries scaled into one view)
  shot('Expanded map — aerial looking west over Orchard Ridge and the East Estates', 'map-aerial', (s) => {
    // cluster a readable "in-world" layout rather than a 1:1 700-unit dump
    const dc = buildEstateModel('data_center', 4, 0); dc.position.set(-30, 0, -10); s.add(dc);
    const man = buildEstateModel('mansion', 4, 0); man.position.set(20, 0, 10); s.add(man);
    const hr = buildEstateModel('highrise', 2, 0); hr.position.set(50, 0, -5); s.add(hr);
    const pp = buildEstateModel('power_plant', 4, 0); pp.position.set(90, 0, 20); s.add(pp);
    const pl = buildPlasticsPlant(); pl.position.set(-80, 0, 30); s.add(pl);
    const win = buildWinery(); win.position.set(-20, 0, 50); s.add(win);
    const gw = buildGoldwoodMansion(2, 1); gw.position.set(-50, 0, -40); s.add(gw);
    const orc = buildOrchardSite(26, 20); orc.position.set(40, 0, 55); s.add(orc);
    plantOrchard && void 0;
    for (let i = 0; i < 24; i++) {
      const t = buildOrchardTree(0xc83030, 100, true, true);
      t.position.set(32 + (i % 8) * 2, 0.1, 48 + Math.floor(i / 8) * 2); s.add(t);
    }
    const term = buildAirportTerminal(); term.position.set(-120, 0, -20); s.add(term);
    const dock = buildRigDock(); dock.position.set(10, 0, 90); s.add(dock);
    const rig = buildRig(4, 0, true); rig.position.set(20, 0, 120); s.add(rig);
  }, 'aerial');

  // Teaser stills (written out as the live Future Features images)
  shot('Teaser — the city keeps growing', 'teaser-map', (s) => {
    const man = buildEstateModel('mansion', 4, 0); man.position.set(16, 0, 8); s.add(man);
    const orc = buildOrchardSite(24, 18); orc.position.set(-20, 0, 10); s.add(orc);
    for (let i = 0; i < 20; i++) {
      const t = buildOrchardTree(0xc83030, 100, true, true);
      t.position.set(-28 + (i % 5) * 2.2, 0.1, 4 + Math.floor(i / 5) * 2.2); s.add(t);
    }
    const gw = buildGoldwoodMansion(2, 2); gw.position.set(-8, 0, -24); s.add(gw);
  }, 'mansion');
  shot('Teaser — raise something of your own', 'teaser-lots', (s) => {
    s.add(buildEstateModel('highrise', 2, 0));
    const m = buildEstateModel('mansion', 4, 0); m.position.set(36, 0, 10); s.add(m);
  }, 'lots');
  shot('Teaser — an airport that looks the part', 'teaser-airport', (s) => s.add(buildAirportTerminal()), 'airport');
  shot('Teaser — new industry on the shore', 'teaser-industry', (s) => {
    const pl = buildPlasticsPlant(); pl.position.set(-24, 0, 0); s.add(pl);
    const pp = buildEstateModel('power_plant', 4, 0); pp.position.set(28, 0, -6); s.add(pp);
    const d = buildRigDock(); d.position.set(0, 0, 36); s.add(d);
  }, 'plastics');

  document.getElementById('status')!.textContent = 'ready';
  document.documentElement.dataset.ready = '1';
}

main();
