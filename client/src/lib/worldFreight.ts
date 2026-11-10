/**
 * Logistics on the city map: the ocean port (pier, crane, containers) and every moving shipment from 'freight_live'
 * (trucks with their owner's name, hired rigs, hourly freight planes, 2-hourly cargo ships). Trucks only exist on the
 * map while they're driving a load; a ship sits at the port while it loads.
 */
import { C20, CONTAINER_COLORS, type Box } from './containerYard';
import { containerMeshes } from './containerModels';
import { addFuselage, addTail } from './planeNose';
import * as THREE from 'three';
import type { World } from './world3d';
import { cityLabel } from './labelSprite';
import { nacelleX } from './nacelle';
import { socket } from './net';
import { sg, sm, part, BOX, CYL, CYL8, SPH, buildHarbour } from './ocean3d';
import { HUBS, HUB_MAPS, onMap, vehiclePose, type HubId, type LiveVehicle, type Mode } from '../../../shared/logistics';

function tag(text: string, color = '#ffd27a'): THREE.Sprite { // Chud City label look, pill sized to the full text (no truncation)
  const t = cityLabel(text, color); const d = t.userData as { w: number; h: number };
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, premultipliedAlpha: true, toneMapped: false, sizeAttenuation: false })); s.scale.set(0.09 * d.w, 0.0225 * d.h, 1); s.center.set(0.5, 0); s.renderOrder = 11; return s;
}
// Vehicles + port share module-level geometry/materials (ocean3d sg/sm caches): many trucks cost one set of buffers.
const hullGeo = () => sg('shipHull', () => { // top-view outline: pointed bow (+x), square stern, extruded down; bevelled sheer
  const sh = new THREE.Shape(); sh.moveTo(-9, -2.5); sh.lineTo(5.5, -2.5); sh.quadraticCurveTo(8.6, -2.2, 9.6, 0); sh.quadraticCurveTo(8.6, 2.2, 5.5, 2.5); sh.lineTo(-9, 2.5); sh.quadraticCurveTo(-9.5, 0, -9, -2.5);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 8 }); g.rotateX(Math.PI / 2); return g; });
/** QA#15: flared bow. Forward of x=3 the hull pinches in toward the keel and widens back out to the full deck line, with a
 *  slight sheer rise at the stem, so the bow reads as a ship's flare instead of a vertical extrusion. t = 0 keel .. 1 deck. */
export const bowPinch = (x: number) => (x <= 3 ? 0 : Math.min(1, (x - 3) / 6.6) ** 1.5);
export const flareHull = (part: 'upper' | 'lower') => sg(`shipHull-${part}`, () => { const g = hullGeo().clone(); const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), f = bowPinch(x); if (!f) continue; const t = y + 1; // geometry spans y -1..0
    const w = part === 'upper' ? 1 - f * 0.38 * (1 - t) : 1 - f * 0.38; p.setZ(i, p.getZ(i) * w); if (part === 'upper') p.setY(i, y + f * 0.14 * t); }
  p.needsUpdate = true; g.computeVertexNormals(); return g; });
/** QA#11: steer axle + tandem rear (was a tri-axle). */
export const TRUCK_AXLES = [2.5, -1.75, -2.7] as const;
export function truck(color: number, hired: boolean) {
  const g = new THREE.Group(); const paint = sm(color, 0.45, 0.25), glass = sm(0x1e293b, 0.15, 0.6), chrome = sm(0xd1d5db, 0.25, 0.9), black = sm(0x111111, 0.85), lamp = sm(0xfff7d6, 0.3, 0, 0xfff1b8, 1.4), tail = sm(0x7f1d1d, 0.4, 0, 0xef4444, 1.2);
  part(g, BOX(), sm(0x27272a, 0.7), 6.6, 0.35, 1.3, -0.3, 0.75, 0); // chassis rails
  part(g, BOX(), paint, 1.5, 1.3, 2.0, 2.0, 1.52, 0); part(g, BOX(), paint, 0.8, 0.85, 1.9, 3.0, 1.25, 0); // cab + hood
  part(g, BOX(), glass, 0.06, 0.6, 1.7, 2.77, 1.8, 0); for (const z of [-1.0, 1.0]) part(g, BOX(), glass, 0.9, 0.48, 0.04, 2.05, 1.82, z); // windscreen, side windows
  part(g, BOX(), chrome, 0.12, 0.55, 1.6, 3.43, 1.15, 0); part(g, BOX(), chrome, 0.2, 0.22, 2.05, 3.45, 0.72, 0); // grille, bumper
  for (const z of [-0.75, 0.75]) { part(g, BOX(), lamp, 0.05, 0.2, 0.32, 3.47, 1.3, z); part(g, BOX(), black, 0.12, 0.35, 0.06, 2.6, 1.85, z * 1.45); part(g, CYL8(), chrome, 0.12, 1.6, 0.12, 1.2, 2.3, z * 1.15); } // headlights, mirrors, stacks
  part(g, BOX(), paint, 1.2, 0.5, 1.9, 1.95, 2.42, 0); // roof fairing (QA#11: cab ~10% lower)
  const body = hired ? 0xd1d5db : 0xf3f4f6; part(g, BOX(), sm(body, 0.55), 4.4, 2.2, 2.1, -1.3, 2.05, 0);
  for (let i = 0; i < 6; i++) part(g, BOX(), sm(0xbfc5cc, 0.6), 0.06, 2.1, 2.14, -3.3 + i * 0.8, 2.05, 0); // side ribs
  if (hired) part(g, BOX(), sm(0xf97316, 0.5), 4.42, 0.4, 2.12, -1.3, 2.2, 0);
  for (const z of [-0.8, 0.8]) part(g, BOX(), tail, 0.05, 0.18, 0.3, -3.52, 1.1, z);
  const wheelG = sg('wheel', () => { const w = new THREE.CylinderGeometry(0.45, 0.45, 0.34, 14); w.rotateX(Math.PI / 2); return w; }), hubG = sg('hub', () => { const w = new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8); w.rotateX(Math.PI / 2); return w; });
  for (const x of TRUCK_AXLES) for (const z of [-0.95, 0.95]) { const w = new THREE.Mesh(wheelG, black); w.position.set(x, 0.45, z); g.add(w); const h = new THREE.Mesh(hubG, chrome); h.position.set(x, 0.45, z * 1.01); g.add(h); }
  return g;
}
export function plane() {
  const g = new THREE.Group(); const white = sm(0xf8fafc, 0.4, 0.2), grey = sm(0x9ca3af, 0.45, 0.5), gold = sm(0xeab308, 0.45, 0.2), win = sm(0x0f172a, 0.2, 0.5);
  addFuselage(g, { r: 0.85, len: 9, nose: 1.6, tail: 1.1, axis: 'x', body: white, glass: win }); // mu-visuals nose fix: coaxial, flush nose + wrap-round windscreen
  part(g, BOX(), win, 7.4, 0.18, 1.72, 0.2, 0.25, 0); // window band
  part(g, BOX(), gold, 9, 0.12, 1.74, -0.3, -0.3, 0); // cheatline
  const wing = sg('wing', () => { const s = new THREE.Shape(); s.moveTo(1.5, 0); s.lineTo(-0.6, 7); s.lineTo(-1.8, 7); s.lineTo(-1.6, 0); const w = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }); w.rotateX(Math.PI / 2); return w; });
  for (const sgn of [1, -1]) { const w = new THREE.Mesh(wing, white); w.scale.z = sgn; w.position.set(0.4, -0.35, 0); g.add(w);
    const n = nacelleX({ len: 2.3, r: 0.46, pylon: 0.32, body: white }); n.position.set(1.15, -0.53 - 0.32 - 0.46, sgn * 2.9); g.add(n); } // mu-visuals: rounded nacelle on a pylon under each wing
  addTail(g, { r: 0.85, len: 9, axis: 'x', fin: gold, stab: white, h: 2.9, c: 2.6 }); // mu-visuals tail fins
  part(g, SPH(), sm(0xff3b30, 0.3, 0, 0xff3b30, 2), 0.2, 0.2, 0.2, 0.2, -0.32, 7.05); part(g, SPH(), sm(0x22c55e, 0.3, 0, 0x22c55e, 2), 0.2, 0.2, 0.2, 0.2, -0.32, -7.05);
  return g;
}
export function ship() {
  const g = new THREE.Group(); const navy = sm(0x1e3a8a, 0.55, 0.2), red = sm(0x9f1239, 0.7), deckM = sm(0x4b5563, 0.85), white = sm(0xf1f5f9, 0.5), win = sm(0x0f172a, 0.2, 0.4, 0x7dd3fc, 0.35);
  const lower = new THREE.Mesh(flareHull('lower'), red); lower.scale.set(1, 1.2, 1); lower.position.y = 0.2; g.add(lower); // boot-topping (sits in the water)
  const upper = new THREE.Mesh(flareHull('upper'), navy); upper.scale.set(1, 2.0, 1); upper.position.y = 2.2; g.add(upper);
  const dk = new THREE.Mesh(hullGeo(), deckM); dk.scale.set(0.98, 0.1, 0.96); dk.position.y = 2.25; g.add(dk);
  // (QA#15: the old 4.9-wide bow-rail bar stuck out past the narrow stem; removed)
  // stern superstructure: 4-deck accommodation block, bridge with wings, funnel
  part(g, BOX(), white, 3, 4.2, 4.2, -7, 4.3, 0); part(g, BOX(), white, 2.2, 0.8, 5.6, -6.4, 6.6, 0); part(g, BOX(), win, 0.06, 0.45, 4.6, -5.28, 6.6, 0);
  for (let y = 0; y < 3; y++) part(g, BOX(), win, 0.06, 0.32, 3.4, -5.48, 3.2 + y * 1.1, 0);
  part(g, CYL(), sm(0xdc2626, 0.5), 1.1, 2.4, 1.1, -8.2, 7.2, 0); part(g, CYL(), sm(0x111827, 0.6), 1.12, 0.5, 1.12, -8.2, 8.5, 0);
  part(g, CYL8(), sm(0x94a3b8, 0.4, 0.6), 0.1, 2.2, 0.1, -6.4, 8.1, 0);
  // containers on deck (one instanced mesh per ship, colours per box)
  // mu-visuals containers: real ISO 20ft boxes on a flush 4×3×2 grid (foremast moved clear of them) (shared instanced geometry)
  { const deck: Box[] = []; let k = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) for (let y = 0; y < 2; y++) deck.push({ x: -4.2 + i * (C20.len + 0.1), y: 2.3 + C20.h * (y + 0.5), z: (j - 1) * (C20.w + 0.06), size: 20, color: CONTAINER_COLORS[(i * 3 + j * 2 + y * 5 + k++) % CONTAINER_COLORS.length]!, logo: (i + j + y) % 5 === 0 });
    g.add(containerMeshes(deck)); } part(g, BOX(), sm(0x94a3b8, 0.5, 0.5), 0.3, 3.6, 0.3, 7.6, 4, 0); // foremast
  return g;
}
export function port(hub: HubId) {
  const [[x0, z0], [, z1]] = HUB_MAPS[hub].port.pier as [[number, number], [number, number]];
  const sign = tag(`⚓ ${HUBS[hub].port} · cargo every 2h`, '#38bdf8');
  return buildHarbour({ x: x0 - 7, z0, z1, quayW: hub === 'city' ? 76 : 48, quayD: hub === 'city' ? 16 : 10, side: 1, cranes: hub === 'city' ? 2 : 1, stacks: hub === 'city' ? 6 : 3, label: sign });
}


/** Runway / airstrip top surface on each map. City uses a flat asphalt plane; resort and Fort McChud use a 0.15-tall
 *  runway box centred at y=0.08 (top 0.155). Used so a parked aircraft sits on the tarmac, not at world y=0. */
export const RUNWAY_SURFACE_Y: Record<HubId, number> = { city: 0.085, resort: 0.155, fortmc: 0.155 };

/** Lowest Y of a vehicle mesh in local space (group origin, typically the fuselage centre). Ignores the object's own
 *  translation so the same number works before and after it is placed in the scene. */
export function modelMinY(obj: THREE.Object3D): number {
  const py = obj.position.y; obj.position.y = 0; obj.updateMatrixWorld(true);
  const y = new THREE.Box3().setFromObject(obj).min.y; obj.position.y = py; obj.updateMatrixWorld(true); return y;
}

/** Add this to vehiclePose.y so an aircraft's lowest point (nacelles, fuselage, wing) sits on that hub's runway when
 *  pose.y is 0 (loading / taxi / takeoff roll / landing roll). Cruise altitude is raised by the same constant, so the
 *  plane does not pop up as it leaves the ground. */
export function aircraftGroundOffset(obj: THREE.Object3D, hub: HubId = 'city'): number {
  return RUNWAY_SURFACE_Y[hub] - modelMinY(obj);
}

/** World Y used by the live-traffic loop for a vehicle at a given pose altitude. Ships sit slightly in the water;
 *  aircraft are lifted by their cached (or computed) ground offset; trucks already have wheels on y=0. */
export function freightAltitude(mode: Mode, poseY: number, obj: THREE.Object3D, hub: HubId = 'city'): number {
  if (mode === 'ship' || mode === 'boat') return poseY - 0.2;
  if (mode === 'plane' || mode === 'jet') return poseY + (typeof obj.userData.groundOffset === 'number' ? obj.userData.groundOffset : aircraftGroundOffset(obj, hub));
  return poseY;
}

/** recheck #2: where a loading ship sits at a hub's berth: the first leg of its route, heading = rotation.y the live
 *  traffic loop applies (-pose.a, bow +x), so the hull lies parallel to the pier, off the fender line. Shared by the
 *  map and the visual harness (which used to drop the ship at the berth unrotated, across the pier end). */
export function shipBerth(hub: HubId) { const ps = vehiclePose({ mode: 'ship', from: hub, to: hub === 'city' ? 'resort' : 'city', departAt: 1, arriveAt: 2 }, 0, hub); return { x: ps.x, y: -0.2, z: ps.z, ry: -ps.a }; }
type V = { v: LiveVehicle; obj: THREE.Group; tag: THREE.Sprite };
/** Draw the port + traffic on one map's scene (city, resort or Fort McChud). */
export function createFreight(world: Pick<World, 'scene'>, hub: HubId = 'city') {
  const { scene } = world; const p = port(hub); scene.add(p); const live = new Map<string, V>();
  const build = (v: LiveVehicle) => { const o = (v.mode === 'plane' || v.mode === 'jet') ? plane() : (v.mode === 'ship' || v.mode === 'boat') ? ship() : truck(v.color, v.mode === 'hired');
    if (v.mode === 'plane' || v.mode === 'jet') o.userData.groundOffset = aircraftGroundOffset(o, hub); return o; };
  const onLive = (list: LiveVehicle[]) => {
    const seen = new Set<string>();
    for (const v of list) { if (!onMap(v, hub)) continue; seen.add(v.id); const cur = live.get(v.id);
      if (cur && cur.v.label === v.label) { cur.v = v; continue; }
      if (cur) { scene.remove(cur.obj, cur.tag); }
      const o = { v, obj: build(v), tag: tag(v.label, v.mode === 'ship' ? '#38bdf8' : v.mode === 'plane' ? '#e5e7eb' : v.mode === 'hired' ? '#f97316' : '#ffd27a') }; scene.add(o.obj, o.tag); live.set(v.id, o); }
    for (const [k, o] of live) if (!seen.has(k)) { scene.remove(o.obj, o.tag); live.delete(k); }
  };
  let running = true;
  const frame = () => {
    if (!running) return;
    const now = Date.now();
    for (const [k, o] of live) { const ps = vehiclePose(o.v, now, hub);
      if (ps.phase === 'arrived' || (ps.phase === 'loading' && o.v.mode !== 'ship' && o.v.mode !== 'plane')) { o.obj.visible = o.tag.visible = false; if (ps.phase === 'arrived') { scene.remove(o.obj, o.tag); live.delete(k); } continue; }
      o.obj.visible = o.tag.visible = true; const y = freightAltitude(o.v.mode, ps.y, o.obj, hub); o.obj.position.set(ps.x, y, ps.z); o.obj.rotation.y = -ps.a; o.tag.position.set(ps.x, y + ((o.v.mode === 'ship' || o.v.mode === 'boat') ? 7.2 : (o.v.mode === 'plane' || o.v.mode === 'jet') ? 3 : 3.4), ps.z); }
  };
  const watch = () => socket.emit('freight_watch', true);
  socket.on('freight_live', onLive); socket.on('connect', watch); if (socket.connected) watch();
  const t = window.setInterval(frame, 50);
  return { live, setRunning(v: boolean) { running = v; }, dispose() { window.clearInterval(t); socket.off('freight_live', onLive); socket.off('connect', watch); socket.emit('freight_watch', false); scene.remove(p); for (const o of live.values()) scene.remove(o.obj, o.tag); live.clear(); } };
}
