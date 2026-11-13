/** Local-only preview of the space-center model. Open /space-center-preview.html?shot=campus */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildSpaceCenter } from './lib/spaceCenterModel';
import { buildEstateModel } from './lib/estateModels';

const q = new URLSearchParams(location.search);
const shot = q.get('shot') ?? 'campus';
const city = q.get('city') === '1';

const c = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5a9ad4);
scene.fog = new THREE.Fog(0x9abfd8, 140, 460);

const camera = new THREE.PerspectiveCamera(42, 1, 0.2, 800);

const hemi = new THREE.HemisphereLight(0x9ec9f0, 0x7a8a58, 0.85);
scene.add(hemi);
// Mid-morning Florida sun from the south-east, so the VAB flag face is lit.
const sun = new THREE.DirectionalLight(0xfff2d8, 2.15);
sun.position.set(70, 95, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.35;
const sc = sun.shadow.camera;
sc.left = -80; sc.right = 80; sc.top = 70; sc.bottom = -50; sc.near = 10; sc.far = 320;
scene.add(sun, sun.target);
sun.target.position.set(0, 0, 0);
const fill = new THREE.DirectionalLight(0xc8d8f0, 0.35);
fill.position.set(-50, 30, -20);
scene.add(fill);

const campus = buildSpaceCenter();
scene.add(campus);

function skyline() {
  const g = new THREE.Group(); g.name = 'city-skyline';
  const box = new THREE.BoxGeometry(1, 1, 1);
  const M = (c: number, r = 0.7, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const clad = M(0xc5d0d8, 0.42, 0.38);
  const band = M(0x1b3a52, 0.32, 0.28);
  const crown = M(0xe8eef2, 0.35, 0.3);
  const stone = M(0xf4efe4, 0.6);
  const gold = M(0xd4af37, 0.3, 0.7);
  const mid = M(0xb8c0c8, 0.55, 0.2);
  const win = M(0x9aa3c0, 0.4, 0.2);
  // Sky Tower stand-in (same cladding language as midtown) and a few midtown blocks west of the campus.
  const add = (w: number, h: number, d: number, mat: THREE.Material, x: number, z: number) => {
    const o = new THREE.Mesh(box, mat); o.scale.set(w, h, d); o.position.set(x, h / 2, z); o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  add(8, 28, 8, clad, -78, 18);
  for (let y = 2.4; y < 27; y += 3.1) add(8.18, 1.2, 8.18, band, -78, 18).position.y = y + 0.6;
  add(9, 0.7, 9, crown, -78, 18).position.y = 28.35;
  add(11, 0.4, 9, stone, -70, 36);
  add(9.5, 5.2, 7, stone, -70, 36);
  add(10, 0.4, 7.6, gold, -70, 36).position.y = 5.8;
  // a small cluster of office / apartment blocks
  const blocks: Array<[number, number, number, number, number, number]> = [
    [10, 14, 8, 0x9aa3c0, -92, 8], [8, 18, 8, 0xb8c0c8, -92, 28], [9, 11, 9, 0xc5d0d8, -86, 48],
    [12, 8, 10, 0xe8e2d0, -74, 52], [7, 22, 7, 0xa8b0b8, -102, 20], [10, 9, 8, 0xd8d2c0, -88, -8],
  ];
  for (const [w, h, d, c, x, z] of blocks) add(w, h, d, M(c), x, z);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  return g;
}
if (city || shot === 'city' || shot === 'city-street') scene.add(skyline());


// A distant flat Florida horizon
const horizon = new THREE.Mesh(
  new THREE.CircleGeometry(400, 48),
  new THREE.MeshStandardMaterial({ color: 0x5a7a48, roughness: 1 }),
);
horizon.rotation.x = -Math.PI / 2; horizon.position.y = -0.06; horizon.receiveShadow = true;
scene.add(horizon);

type Shot = { pos: [number, number, number]; look: [number, number, number]; fov?: number; label: string };
const SHOTS: Record<string, Shot> = {
  campus: { pos: [28, 22, 58], look: [-4, 8, 2], fov: 40, label: 'Campus from the south-east' },
  'campus-se': { pos: [38, 16, 48], look: [-8, 8, 0], fov: 38, label: 'Campus, south-east street' },
  aerial: { pos: [10, 95, 70], look: [0, 0, 0], fov: 42, label: 'Aerial, looking north-west' },
  'vab-south': { pos: [-28, 12, 42], look: [-32, 14, 4], fov: 36, label: 'Vehicle Assembly Building, south face' },
  'vab-oblique': { pos: [-4, 14, 42], look: [-30, 14, -2], fov: 34, label: 'VAB oblique, flag and east doors' },
  lcc: { pos: [8, 12, 28], look: [-16, 4, 14], fov: 38, label: 'Launch Control Center' },
  'lcc-aerial': { pos: [-4, 28, 36], look: [-16, 4, 14], fov: 40, label: 'Launch Control Center, aerial' },
  pad: { pos: [54, 9, 24], look: [30, 11, 0], fov: 34, label: 'LC-39 pad, tower and rocket' },
  'pad-low': { pos: [48, 4, 22], look: [32, 10, 0], fov: 38, label: 'Pad close, flame trench ahead' },
  rocket: { pos: [44, 8, 14], look: [32, 12, 0], fov: 32, label: 'Rocket and service arms' },
  'rocket-close': { pos: [38, 6, 8], look: [32, 10, 0], fov: 36, label: 'Rocket close-up' },
  tower: { pos: [20, 14, 16], look: [28, 14, 0], fov: 36, label: 'Launch umbilical tower' },
  crawler: { pos: [22, 4.0, 14], look: [4, 2.2, 0], fov: 34, label: 'Crawler-transporter' },
  crawlerway: { pos: [6, 7, 24], look: [18, 1.2, 2], fov: 40, label: 'Crawlerway toward the pad' },
  fuel: { pos: [32, 8, -4], look: [22, 4, -16], fov: 38, label: 'Fuel farm, spheres and tanks' },
  water: { pos: [56, 8, -2], look: [46, 8, -14], fov: 36, label: 'Water tower' },
  gate: { pos: [-10, 4, 48], look: [-20, 2, 28], fov: 40, label: 'South gate and parking' },
  city: { pos: [-118, 16, 48], look: [-16, 10, 4], fov: 38, label: 'From midtown, looking at the space center' },
  'city-street': { pos: [-98, 7, 28], look: [-20, 10, 2], fov: 36, label: 'Street view toward the Vehicle Assembly Building' },
};

const s = SHOTS[shot] ?? SHOTS.campus!;
camera.fov = s.fov ?? 42;
camera.position.set(...s.pos);
camera.lookAt(...s.look);

const controls = new OrbitControls(camera, c);
controls.target.set(...s.look);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.maxDistance = 220;

if (hud) hud.textContent = s.label;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Expose a freeze-and-frame helper for the screenshot harness.
(window as unknown as { __sc?: unknown }).__sc = {
  shot, shots: Object.keys(SHOTS),
  frame(name: string) {
    const n = SHOTS[name]; if (!n) return false;
    camera.fov = n.fov ?? 42; camera.position.set(...n.pos); camera.lookAt(...n.look);
    camera.updateProjectionMatrix();
    controls.target.set(...n.look); controls.update();
    if (hud) hud.textContent = n.label;
    return true;
  },
  render() { controls.update(); renderer.render(scene, camera); },
};

function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
}
loop();
