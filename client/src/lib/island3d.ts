import * as THREE from 'three';
import { ISLAND_DOCK, ISLAND_LOTS, ISLAND_SHORE_Z, ISLAND_X0, ISLAND_X1, ISLAND_Z0, ISLAND_Z1, clampIslandTarget } from '../../../shared/island';

export interface IslandWorld { focusXZ(x: number, z: number): void; dispose(): void }

export function createIsland(canvas: HTMLCanvasElement, opts: { onHover: (id: string, x: number, y: number) => void; onPick: (id: string) => void }): IslandWorld {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x87c6e8);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 800);
  camera.position.set(0, 70, 90); camera.lookAt(0, 0, -8);
  const hemi = new THREE.HemisphereLight(0xfff0e0, 0x1a4a3a, 1.2); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.6); sun.position.set(40, 80, 20); scene.add(sun);

  const add = (mesh: THREE.Mesh) => { scene.add(mesh); return mesh; };
  const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
  // water
  const water = add(new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x1a6a8a, { roughness: 0.2, metalness: 0.2 }))); water.rotation.x = -Math.PI / 2; water.position.y = -0.4;
  // island
  const land = add(new THREE.Mesh(new THREE.CircleGeometry(52, 40), mat(0x3f8a4a))); land.rotation.x = -Math.PI / 2; land.position.set(0, 0, -8);
  const sand = add(new THREE.Mesh(new THREE.RingGeometry(40, 56, 40), mat(0xc9b48a))); sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, -8);

  const clickable: { id: string; obj: THREE.Object3D }[] = [];
  for (const l of ISLAND_LOTS) {
    const g = new THREE.Group(); g.position.set(l.x, 0, l.z); g.rotation.y = l.rot; scene.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(l.w * 0.7, l.h, l.d * 0.7), mat(0xf6efe2)); body.position.y = l.h / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(l.w * 0.5, 2.2, 4), mat(0xb07a48)); roof.position.y = l.h + 1; roof.rotation.y = Math.PI / 4; g.add(roof);
    clickable.push({ id: l.id, obj: g });
  }
  { const d = new THREE.Group(); d.position.set(ISLAND_DOCK.x, 0, ISLAND_DOCK.z); scene.add(d);
    d.add(new THREE.Mesh(new THREE.BoxGeometry(ISLAND_DOCK.w, 0.4, ISLAND_DOCK.d), mat(0x8a5a36)));
    clickable.push({ id: ISLAND_DOCK.id, obj: d }); }

  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  const hitId = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hs = ray.intersectObjects(clickable.map((c) => c.obj), true);
    const obj = hs[0]?.object; if (!obj) return '';
    let o: THREE.Object3D | null = obj; const ids = new Map(clickable.map((c) => [c.obj, c.id]));
    while (o) { const id = ids.get(o); if (id) return id; o = o.parent; }
    return '';
  };
  const onMove = (ev: PointerEvent) => { const id = hitId(ev); opts.onHover(id, ev.clientX, ev.clientY); canvas.style.cursor = id ? 'pointer' : ''; };
  const onClick = (ev: PointerEvent) => { const id = hitId(ev); if (id) opts.onPick(id); };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('click', onClick);

  let raf = 0; const loop = () => {
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 400;
    if (canvas.width !== w || canvas.height !== h) { renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
    raf = requestAnimationFrame(loop); renderer.render(scene, camera);
  }; loop();

  return {
    focusXZ(x, z) { const [cx, cz] = clampIslandTarget(x, z); camera.position.set(cx, 50, cz + 60); camera.lookAt(cx, 0, cz); },
    dispose() { cancelAnimationFrame(raf); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('click', onClick); renderer.dispose(); scene.clear(); },
  };
}
void ISLAND_SHORE_Z; void ISLAND_X0; void ISLAND_X1; void ISLAND_Z0; void ISLAND_Z1;
