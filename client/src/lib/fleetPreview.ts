import * as THREE from 'three';
import { buildCraft } from './fleetModels';
import type { FleetModel } from '../../../shared/fleet';

/**
 * mu-visuals jet store: the Hangar preview stands each jet inside a lit hangar (barrel-vault roof on steel ribs,
 * polished epoxy floor with a yellow lead-in line and stand markings, a back wall with a roller door, ceiling
 * light strips) instead of on a flat dark disc. Boats keep the water disc. Everything is sized from the craft.
 */
export function buildHangar(s: number): THREE.Group {
  const g = new THREE.Group(); g.userData.part = 'hangar'; const R = s * 1.7, D = s * 3.2;
  const floorM = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.28, metalness: 0.15 }); const floor = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, D), floorM); floor.rotation.x = -Math.PI / 2; floor.userData.part = 'floor'; g.add(floor);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.025, D), yellow); line.rotation.x = -Math.PI / 2; line.position.y = 0.01; g.add(line);
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.3, s * 0.03), yellow); stop.rotation.x = -Math.PI / 2; stop.position.set(0, 0.01, s * 0.6); g.add(stop);
  for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.02, s * 1.3), yellow); b.rotation.x = -Math.PI / 2; b.position.set(sx * s * 0.62, 0.01, 0); g.add(b); }
  const wallM = new THREE.MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.6, metalness: 0.3, side: THREE.BackSide });
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(R, R, D, 40, 1, true, -Math.PI / 2, Math.PI), wallM); vault.rotation.x = -Math.PI / 2; vault.userData.part = 'vault'; g.add(vault); // half-cylinder above the floor, axis along Z
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.4, metalness: 0.7 }); const ribG = new THREE.TorusGeometry(R * 0.985, s * 0.018, 6, 40, Math.PI);
  for (let i = 0; i <= 6; i++) { const r = new THREE.Mesh(ribG, steel); r.position.z = -D / 2 + (i / 6) * D; g.add(r); }
  const back = new THREE.Mesh(new THREE.CircleGeometry(R, 40, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xbfc5cc, roughness: 0.7, metalness: 0.2 })); back.position.z = -D / 2; g.add(back);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.1, R * 0.55), new THREE.MeshStandardMaterial({ color: 0x6a737e, roughness: 0.5, metalness: 0.5 })); door.position.set(0, R * 0.275, -D / 2 + 0.02); g.add(door);
  for (let i = 0; i < 8; i++) { const slat = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.1, s * 0.006), steel); slat.position.set(0, (i + 0.5) * R * 0.55 / 8, -D / 2 + 0.03); g.add(slat); }
  const lightM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 2.2 });
  for (const a of [-0.45, 0, 0.45]) { const l = new THREE.Mesh(new THREE.BoxGeometry(s * 0.05, s * 0.01, D * 0.9), lightM); l.position.set(Math.sin(a) * R * 0.95, Math.cos(a) * R * 0.95, 0); l.rotation.z = -a; g.add(l); }
  const lamp = new THREE.PointLight(0xfff0d8, 3, R * 3, 1.2); lamp.position.set(0, R * 0.8, 0); g.add(lamp);
  return g;
}

/** The store preview scene for one model (shared by the store card and the QA shot harness). */
export function previewScene(m: FleetModel, aspect: number) {
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xfff0e0, 0x335, 1.6)); const dl = new THREE.DirectionalLight(0xffd8a8, 2.4); dl.position.set(6, 9, 5); sc.add(dl);
  const g = buildCraft(m); const box = new THREE.Box3().setFromObject(g); const size = box.getSize(new THREE.Vector3()); const s = Math.max(size.x, size.y, size.z);
  if (m.kind === 'jet') { g.position.y = -box.min.y; sc.add(buildHangar(s)); sc.background = new THREE.Color(0x1a1e24); }
  else { const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x0a5a6a, roughness: 0.15, metalness: 0.3 })); floor.rotation.x = -Math.PI / 2; sc.add(floor); }
  const pivot = new THREE.Group(); pivot.add(g); sc.add(pivot);
  const cam = new THREE.PerspectiveCamera(35, aspect, 0.1, 500); cam.position.set(s * 0.95, s * 0.55, s * 0.95); cam.lookAt(0, size.y * 0.35, 0);
  return { scene: sc, camera: cam, craft: pivot };
}
