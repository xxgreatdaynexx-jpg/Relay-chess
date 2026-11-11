/**
 * Places Billionaire Update construction on the city map: Goldwood, wineries, orchards,
 * plastics plant, the shoreline dock, private sites, hyper farms and launched rigs.
 * Expansion ground, snow, beach and roads live in world3d so they match the city season.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { PLASTICS_PLANT, RIG_DOCK, estateLots, expansionFarms, goldwoodHomes, wineryPlots } from '../../../shared/mapExpansion';
import { orchardId, orchardPlots } from '../../../shared/orchard';
import { buildEstateModel, buildGoldwoodMansion, buildHyperFarm, buildOrchardSite, buildPlasticsPlant, buildRig, buildRigDock, buildWinery } from './estateModels';
import type { EstateBuildId } from '../../../shared/estateProjects';

type Summary = {
  sites?: Array<{ lotId: string; build: EstateBuildId | null; stage: number; complete: boolean; gear: number; kind: string }>;
  rigs?: Array<{ id: string; berth: number | null; at: [number, number] | null }>;
  hyper?: Array<{ plotId: string; stage: number; complete: boolean }>;
};

export function createEstate(w: World) {
  const root = new THREE.Group(); root.name = 'estate-layer'; w.scene.add(root);
  // Ground, snow, beach and expansion/orchard roads are drawn with the city countryside in world3d
  // (same seasonal texture, no sky gaps, no second unsnowed road mesh).
  const pick: THREE.Object3D[] = [];
  const mark = (o: THREE.Object3D, spot: string) => {
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.userData.spot = spot; pick.push(c); } });
  };
  const plastics = buildPlasticsPlant(); plastics.position.set(PLASTICS_PLANT.x, 0, PLASTICS_PLANT.z); root.add(plastics); mark(plastics, 'plastics');
  const dock = buildRigDock(); dock.position.set(RIG_DOCK.x, 0, RIG_DOCK.z); root.add(dock); mark(dock, 'rigdock');
  for (const h of goldwoodHomes()) {
    const g = buildGoldwoodMansion(h.floors, h.n); g.position.set(h.x, 0, h.z); g.rotation.y = h.rot; root.add(g); mark(g, `b:mansion:${h.n}`);
  }
  for (const v of wineryPlots()) {
    const g = buildWinery(); g.position.set(v.x, 0, v.z); g.rotation.y = v.rot; root.add(g); mark(g, `winery:${v.n}`);
  }
  // empty estate lots: a graded lawn with a gravel building pad, corner survey stakes and an estate board facing the
  // street (rotated with the lot); construction models swap in from the API
  const lawnM = new THREE.MeshStandardMaterial({ color: 0x4a8f45, roughness: 1 }), gravelM = new THREE.MeshStandardMaterial({ color: 0x9a8e7a, roughness: 1 });
  const stakeM = new THREE.MeshStandardMaterial({ color: 0xf0e6d0 }), flagM = new THREE.MeshStandardMaterial({ color: 0xff5a36, emissive: 0x802010, emissiveIntensity: 0.4 });
  const postM = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });
  const saleTex = (() => { if (typeof document === 'undefined') return null; const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const k = cv.getContext('2d'); if (!k) return null;
    k.fillStyle = '#f7f3ea'; k.fillRect(0, 0, 256, 128); k.fillStyle = '#1f3a2a'; k.fillRect(0, 0, 256, 40); k.fillStyle = '#e8c860'; k.font = 'bold 28px Georgia, serif'; k.textAlign = 'center'; k.fillText('EAST ESTATES', 128, 30);
    k.fillStyle = '#1f2a22'; k.font = 'bold 26px Georgia, serif'; k.fillText('BUILDING LOT', 128, 82); k.font = '18px sans-serif'; k.fillText('Private estate parcel', 128, 112); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const saleM = new THREE.MeshStandardMaterial({ map: saleTex ?? undefined, color: saleTex ? 0xffffff : 0xf7f3ea, emissive: 0xffffff, emissiveMap: saleTex ?? undefined, emissiveIntensity: 0.25 });
  for (const l of estateLots()) {
    const g = new THREE.Group(); g.position.set(l.x, 0, l.z); g.rotation.y = l.rot;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(l.w, 0.12, l.d), lawnM); pad.position.y = 0.06; pad.userData.spot = `lot:estate:${l.n}`; g.add(pad); pick.push(pad);
    const grav = new THREE.Mesh(new THREE.BoxGeometry(l.w * 0.5, 0.06, l.d * 0.45), gravelM); grav.position.set(0, 0.15, -l.d * 0.08); g.add(grav);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), stakeM); st.position.set(sx * (l.w / 2 - 0.4), 0.45, sz * (l.d / 2 - 0.4)); g.add(st);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.02), flagM); fl.position.set(sx * (l.w / 2 - 0.4) + 0.16, 0.82, sz * (l.d / 2 - 0.4)); g.add(fl); }
    const sx0 = l.w / 2 - 4, sz0 = l.d / 2 - 1.6;
    for (const o of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), postM); p.position.set(sx0 + o, 1, sz0); g.add(p); }
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.06), [postM, postM, postM, postM, saleM, saleM]); board.position.set(sx0, 1.55, sz0); board.userData.spot = `lot:estate:${l.n}`; g.add(board); pick.push(board);
    root.add(g);
  }
  for (const f of expansionFarms()) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.1, f.d), new THREE.MeshStandardMaterial({ color: 0x3a7a3a }));
    pad.position.set(f.x, 0.05, f.z); pad.userData.spot = `cf:${f.n}`; root.add(pad); pick.push(pad);
  }
  for (const o of orchardPlots()) {
    const g = buildOrchardSite(o.w, o.d); g.position.set(o.x, 0, o.z); root.add(g); mark(g, orchardId(o.n));
  }

  const dynamic = new THREE.Group(); root.add(dynamic);
  const apply = (sum: Summary) => {
    dynamic.clear();
    for (const s of sum.sites ?? []) {
      if (!s.build) continue;
      const loc = estateLots().find((l) => `lot:estate:${l.n}` === s.lotId) ?? goldwoodHomes().find((h) => `b:mansion:${h.n}` === s.lotId);
      const x = loc ? loc.x : NaN, z = loc ? loc.z : NaN; const rot = loc?.rot ?? 0;
      // demolished / other lots: still try to parse if the lot is a property with x/z later; skip if unknown
      if (!Number.isFinite(x)) continue;
      const model = buildEstateModel(s.build, s.complete ? 4 : s.stage, 0);
      model.position.set(x, 0, z); model.rotation.y = rot; dynamic.add(model); mark(model, s.lotId);
    }
    for (const r of sum.rigs ?? []) {
      if (!r.at) continue;
      const model = buildRig(4, 1, true); model.position.set(r.at[0], 0, r.at[1]); dynamic.add(model); mark(model, 'rigdock');
    }
    for (const h of sum.hyper ?? []) {
      const f = expansionFarms().find((p) => `cf:${p.n}` === h.plotId);
      if (!f) continue;
      const model = buildHyperFarm(h.complete ? 4 : h.stage, 0, f.w, f.d);
      model.position.set(f.x, 0.1, f.z); dynamic.add(model); mark(model, h.plotId);
    }
  };
  const load = () => { void fetch('/api/estate').then((r) => r.json()).then((j: Summary) => apply(j)).catch(() => {}); };
  load();
  const poll = window.setInterval(load, 30_000);

  // Expose pickables to the world raycaster if the host supports it.
  const extra = (w as World & { addPickables?: (o: THREE.Object3D[]) => void }).addPickables;
  extra?.(pick);

  return { refresh: load, dispose() { window.clearInterval(poll); w.scene.remove(root); } };
}
