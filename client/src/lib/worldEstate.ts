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
  // empty lots: no painted green square — the snowy ground already is the lot. A nearly invisible pick volume,
  // low timber corner posts with a short rail, a couple of existing trees, and a small for-sale board facing the street.
  // Built models (from /api/estate) still sit on top and keep their look.
  const postM = new THREE.MeshStandardMaterial({ color: 0x6a5a3a, roughness: 0.9 });
  const railM = new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 0.9 });
  const hedgeM = new THREE.MeshStandardMaterial({ color: 0x2f6b32, roughness: 1 });
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
  const crownM = new THREE.MeshStandardMaterial({ color: 0x2f8a3a, flatShading: true, roughness: 0.95, emissive: 0x0a2a10, emissiveIntensity: 0.4 });
  const snowCapM = new THREE.MeshStandardMaterial({ color: 0xf3f7ff, roughness: 0.95, emissive: 0x1a2238, emissiveIntensity: 0.35 });
  const saleTex = (() => { if (typeof document === 'undefined') return null; const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160; const k = cv.getContext('2d'); if (!k) return null;
    k.fillStyle = '#f4efe4'; k.fillRect(0, 0, 256, 160); k.strokeStyle = '#1f3a2a'; k.lineWidth = 10; k.strokeRect(5, 5, 246, 150);
    k.fillStyle = '#1f3a2a'; k.fillRect(12, 12, 232, 48); k.fillStyle = '#e8c860'; k.font = 'bold 28px Georgia, serif'; k.textAlign = 'center'; k.fillText('FOR SALE', 128, 46);
    k.fillStyle = '#1f2a22'; k.font = 'bold 22px Georgia, serif'; k.fillText('East Estates', 128, 94); k.font = '16px sans-serif'; k.fillText('Building lot', 128, 122); k.fillText('Private parcel', 128, 142);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const saleM = new THREE.MeshStandardMaterial({ map: saleTex ?? undefined, color: saleTex ? 0xffffff : 0xf4efe4, emissive: 0xffffff, emissiveMap: saleTex ?? undefined, emissiveIntensity: 0.2 });
  const pickMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const lotTree = (g: THREE.Group, x: number, z: number, s: number) => {
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 5), trunkM); tr.position.set(x, 0.7 * s, z); tr.scale.set(s, 1.4 * s, s); g.add(tr);
    const cr = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), crownM); cr.position.set(x, 2.05 * s, z); cr.scale.set(s * 1.15, s * 1.2, s * 1.15); cr.rotation.y = x + z; g.add(cr);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 4), snowCapM); cap.position.set(x, 2.7 * s, z); cap.scale.set(s, s * 0.5, s); g.add(cap);
  };
  for (const l of estateLots()) {
    const g = new THREE.Group(); g.name = `lot-empty:${l.n}`; g.position.set(l.x, 0, l.z); g.rotation.y = l.rot;
    const vol = new THREE.Mesh(new THREE.BoxGeometry(l.w, 0.2, l.d), pickMat); vol.position.y = 0.1; vol.userData.spot = `lot:estate:${l.n}`; g.add(vol); pick.push(vol);
    // corner posts + a short rail on two sides, leaving the street front open
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const px = sx * (l.w / 2 - 0.35), pz = sz * (l.d / 2 - 0.35);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.16), postM); st.position.set(px, 0.52, pz); g.add(st);
    }
    for (const [x, z, w, d, ry] of [
      [0, l.d / 2 - 0.35, l.w - 0.9, 0.08, 0],
      [0, -(l.d / 2 - 0.35), l.w - 0.9, 0.08, 0],
      [-(l.w / 2 - 0.35), 0, 0.08, l.d - 0.9, 0],
    ] as const) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), railM); r.position.set(x, 0.72, z); g.add(r);
      const r2 = r.clone(); r2.position.y = 0.42; g.add(r2); }
    // a short clipped hedge at the two back corners (not a solid green pad)
    for (const sx of [-1, 1] as const) { const h = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.45), hedgeM); h.position.set(sx * (l.w / 2 - 1.6), 0.35, -(l.d / 2 - 1.1)); g.add(h); }
    // two or three existing trees, offset so they will sit beside a future building rather than under it
    lotTree(g, -l.w * 0.28, -l.d * 0.22, 0.85);
    lotTree(g, l.w * 0.32, -l.d * 0.18, 0.7);
    if (l.w > 28) lotTree(g, l.w * 0.08, -l.d * 0.32, 0.95);
    // small for-sale board at the street front (local +z)
    const sx0 = l.w * 0.18, sz0 = l.d / 2 - 1.2;
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), postM); p1.position.set(sx0 - 0.7, 0.85, sz0); g.add(p1);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), postM); p2.position.set(sx0 + 0.7, 0.85, sz0); g.add(p2);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.05, 0.06), [postM, postM, postM, postM, saleM, saleM]); board.position.set(sx0, 1.55, sz0); board.userData.spot = `lot:estate:${l.n}`; g.add(board); pick.push(board);
    root.add(g);
  }
  // empty expansion farm plots: no green square; a faint soil edge is drawn by the shared farm renderer (furrows + fence).
  // A transparent pick volume only, so clicks still work if the farm soil mesh is not yet in.
  for (const f of expansionFarms()) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.08, f.d), pickMat);
    pad.position.set(f.x, 0.04, f.z); pad.userData.spot = `cf:${f.n}`; root.add(pad); pick.push(pad);
  }
  for (const o of orchardPlots()) {
    const g = buildOrchardSite(o.w, o.d); g.position.set(o.x, 0, o.z); root.add(g); mark(g, orchardId(o.n));
  }

  const dynamic = new THREE.Group(); root.add(dynamic);
  const apply = (sum: Summary) => {
    dynamic.clear();
    const built = new Set((sum.sites ?? []).filter((s) => s.build).map((s) => s.lotId));
    root.traverse((o) => { if (o.name.startsWith('lot-empty:')) o.visible = !built.has(`lot:estate:${o.name.slice(10)}`); });
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
