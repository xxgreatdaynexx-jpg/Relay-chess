import * as THREE from 'three';
import { gunMaterials } from './arenaGuns';
import { applySkin } from './skinRender';

/** Shared skinnable pickaxe (Market/Inventory thumbnails + the Mines viewmodel hook).
 *  Material slots follow the gun skin system: 'metal' = head, 'wood' = handle, 'polymer' = grip wrap, 'steel' = rivets (never skinned).
 *  The Mines worker can swap in their redesigned head/handle meshes: anything using these gunMaterials() slots gets skinned by applySkin. */
export function buildPickaxe(): THREE.Group {
  const m = gunMaterials(); const root = new THREE.Group(); root.name = 'pickaxe';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.62, 10), m.wood); handle.name = 'pick-handle';
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.16, 10), m.polymer); grip.position.y = -0.22; grip.name = 'pick-grip';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), m.metal); head.position.y = 0.3; head.name = 'pick-head';
  const tipL = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 8), m.metal); tipL.rotation.z = -Math.PI / 2; tipL.position.set(0.25, 0.29, 0);
  const tipR = tipL.clone(); tipR.rotation.z = Math.PI / 2; tipR.position.x = -0.25;
  const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.085, 8), m.steel); rivet.rotation.x = Math.PI / 2; rivet.position.y = 0.3;
  root.add(handle, grip, head, tipL, tipR, rivet);
  return root;
}
/** Build + skin in one go (token from the player's loadout.pickaxe, or null for stock). */
export function skinnedPickaxe(token: string | null | undefined): THREE.Group { const g = buildPickaxe(); applySkin(g, token); return g; }
