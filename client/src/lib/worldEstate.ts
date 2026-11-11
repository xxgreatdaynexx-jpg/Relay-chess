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
    const g = buildGoldwoodMansion(h.floors, h.n); g.position.set(h.x, 0, h.z); root.add(g); mark(g, `b:mansion:${h.n}`);
  }
  for (const v of wineryPlots()) {
    const g = buildWinery(); g.position.set(v.x, 0, v.z); root.add(g); mark(g, `winery:${v.n}`);
  }
  for (const l of estateLots()) {
    // empty lots get a low pad; construction models swap in from the API
    const pad = new THREE.Mesh(new THREE.BoxGeometry(l.w, 0.15, l.d), new THREE.MeshStandardMaterial({ color: 0x7a5a3a }));
    pad.position.set(l.x, 0.08, l.z); pad.userData.spot = `lot:estate:${l.n}`; root.add(pad); pick.push(pad);
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
      const x = loc ? loc.x : NaN, z = loc ? loc.z : NaN;
      // demolished / other lots: still try to parse if the lot is a property with x/z later; skip if unknown
      if (!Number.isFinite(x)) continue;
      const model = buildEstateModel(s.build, s.complete ? 4 : s.stage, 0);
      model.position.set(x, 0, z); dynamic.add(model); mark(model, s.lotId);
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
