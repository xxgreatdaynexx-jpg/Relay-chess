import * as THREE from 'three';
import {
  buildEstateModel, buildGoldwoodMansion, buildHyperFarm, buildAirportTerminal,
  buildPlasticsPlant, buildRig, buildRigDock, buildWinery,
} from '../../client/src/lib/estateModels';
import { ESTATE_BUILD_ORDER, ESTATE_BUILDS } from '../../shared/estateProjects';

const W = 640, H = 400;
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 400);
cam.position.set(36, 22, 40); cam.lookAt(0, 4, 0);

function shot(title: string, file: string, build: (scene: THREE.Scene) => void) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b7d8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.3); sun.position.set(20, 30, 12); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 32), new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  build(scene);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  const img = new Image(); img.src = url; img.width = W; img.height = H;
  const wrap = document.createElement('figure');
  wrap.className = 'shot';
  wrap.dataset.file = file;
  wrap.dataset.title = title;
  const cap = document.createElement('figcaption');
  cap.textContent = title;
  wrap.append(img, cap);
  document.getElementById('gallery')!.append(wrap);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose?.();
  });
}

function main() {
  document.getElementById('status')!.textContent = 'rendering…';
  for (const id of ESTATE_BUILD_ORDER) {
    const plan = ESTATE_BUILDS[id];
    for (let stage = 0; stage <= 4; stage++) {
      const label = stage === 4 ? 'complete' : `stage-${stage + 1}`;
      const name = stage === 4 ? 'finished' : plan.stages[stage]!.name;
      shot(`${plan.name} — ${label.replace('-', ' ')} (${name})`, `${id}-${label}`, (s) => s.add(buildEstateModel(id, stage, 0)));
    }
  }
  for (let stage = 0; stage <= 4; stage++) {
    const label = stage === 4 ? 'complete' : `stage-${stage + 1}`;
    shot(`Hyper farm — ${label.replace('-', ' ')}`, `hyper-${label}`, (s) => s.add(buildHyperFarm(stage, 0, 24, 18)));
  }
  for (let stage = 0; stage <= 4; stage++) {
    const label = stage === 4 ? 'ready' : `stage-${stage + 1}`;
    shot(`Offshore rig on the dock — ${label.replace('-', ' ')}`, `rig-dock-${label}`, (s) => s.add(buildRig(stage, 0, false)));
  }
  shot('Launched offshore rig', 'rig-launched', (s) => s.add(buildRig(4, 0, true)));
  shot('Shore construction dock', 'rig-dock', (s) => s.add(buildRigDock()));
  shot('Chud City Plastics Plant', 'plastics-plant', (s) => s.add(buildPlasticsPlant()));
  shot('Goldwood mansion', 'goldwood-mansion', (s) => s.add(buildGoldwoodMansion(2)));
  shot('Winery and press', 'winery', (s) => s.add(buildWinery()));
  shot('International terminal', 'airport-terminal', (s) => s.add(buildAirportTerminal()));
  document.getElementById('status')!.textContent = 'ready';
  document.documentElement.dataset.ready = '1';
}

main();
