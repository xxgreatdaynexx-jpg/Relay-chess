/**
 * Logistics on the city map: the ocean port (pier, crane, containers) and every moving shipment from 'freight_live'
 * (trucks with their owner's name, hired rigs, hourly freight planes, 2-hourly cargo ships). Trucks only exist on the
 * map while they're driving a load; a ship sits at the port while it loads.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { socket } from './net';
import { sg, sm, part, BOX, CYL, CYL8, SPH, buildHarbour, ribTexture } from './ocean3d';
import { HUBS, HUB_MAPS, onMap, vehiclePose, type HubId, type LiveVehicle } from '../../../shared/logistics';

function tag(text: string, color = '#ffd27a'): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 384; c.height = 64; const x = c.getContext('2d')!;
  x.font = 'bold 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(380, x.measureText(text).width + 28); x.fillStyle = 'rgba(10,12,20,0.8)'; x.beginPath(); x.roundRect((384 - w) / 2, 8, w, 48, 14); x.fill();
  x.strokeStyle = color; x.lineWidth = 3; x.stroke(); x.fillStyle = '#fff'; x.fillText(text.slice(0, 26), 192, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false })); s.scale.set(0.135, 0.0225, 1); s.center.set(0.5, 0); s.renderOrder = 11; return s;
}
// Vehicles + port share module-level geometry/materials (ocean3d sg/sm caches): many trucks cost one set of buffers.
const hullGeo = () => sg('shipHull', () => { // top-view outline: pointed bow (+x), square stern, extruded down; bevelled sheer
  const sh = new THREE.Shape(); sh.moveTo(-9, -2.5); sh.lineTo(5.5, -2.5); sh.quadraticCurveTo(8.6, -2.2, 9.6, 0); sh.quadraticCurveTo(8.6, 2.2, 5.5, 2.5); sh.lineTo(-9, 2.5); sh.quadraticCurveTo(-9.5, 0, -9, -2.5);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 8 }); g.rotateX(Math.PI / 2); return g; });
export function truck(color: number, hired: boolean) {
  const g = new THREE.Group(); const paint = sm(color, 0.45, 0.25), glass = sm(0x1e293b, 0.15, 0.6), chrome = sm(0xd1d5db, 0.25, 0.9), black = sm(0x111111, 0.85), lamp = sm(0xfff7d6, 0.3, 0, 0xfff1b8, 1.4), tail = sm(0x7f1d1d, 0.4, 0, 0xef4444, 1.2);
  part(g, BOX(), sm(0x27272a, 0.7), 6.6, 0.35, 1.3, -0.3, 0.75, 0); // chassis rails
  part(g, BOX(), paint, 1.5, 1.55, 2.0, 2.0, 1.65, 0); part(g, BOX(), paint, 0.8, 0.85, 1.9, 3.0, 1.25, 0); // cab + hood
  part(g, BOX(), glass, 0.06, 0.7, 1.7, 2.77, 2.0, 0); for (const z of [-1.0, 1.0]) part(g, BOX(), glass, 0.9, 0.55, 0.04, 2.05, 2.0, z); // windscreen, side windows
  part(g, BOX(), chrome, 0.12, 0.55, 1.6, 3.43, 1.15, 0); part(g, BOX(), chrome, 0.2, 0.22, 2.05, 3.45, 0.72, 0); // grille, bumper
  for (const z of [-0.75, 0.75]) { part(g, BOX(), lamp, 0.05, 0.2, 0.32, 3.47, 1.3, z); part(g, BOX(), black, 0.12, 0.35, 0.06, 2.6, 2.05, z * 1.45); part(g, CYL8(), chrome, 0.12, 1.6, 0.12, 1.2, 2.3, z * 1.15); } // headlights, mirrors, stacks
  part(g, BOX(), paint, 1.2, 0.35, 1.9, 1.95, 2.6, 0); // roof fairing
  const body = hired ? 0xd1d5db : 0xf3f4f6; part(g, BOX(), sm(body, 0.55), 4.4, 2.2, 2.1, -1.3, 2.05, 0);
  for (let i = 0; i < 6; i++) part(g, BOX(), sm(0xbfc5cc, 0.6), 0.06, 2.1, 2.14, -3.3 + i * 0.8, 2.05, 0); // side ribs
  if (hired) part(g, BOX(), sm(0xf97316, 0.5), 4.42, 0.4, 2.12, -1.3, 2.2, 0);
  for (const z of [-0.8, 0.8]) part(g, BOX(), tail, 0.05, 0.18, 0.3, -3.52, 1.1, z);
  const wheelG = sg('wheel', () => { const w = new THREE.CylinderGeometry(0.45, 0.45, 0.34, 14); w.rotateX(Math.PI / 2); return w; }), hubG = sg('hub', () => { const w = new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8); w.rotateX(Math.PI / 2); return w; });
  for (const x of [2.5, -0.9, -2.0, -3.0]) for (const z of [-0.95, 0.95]) { const w = new THREE.Mesh(wheelG, black); w.position.set(x, 0.45, z); g.add(w); const h = new THREE.Mesh(hubG, chrome); h.position.set(x, 0.45, z * 1.01); g.add(h); }
  return g;
}
export function plane() {
  const g = new THREE.Group(); const white = sm(0xf8fafc, 0.4, 0.2), grey = sm(0x9ca3af, 0.45, 0.5), gold = sm(0xeab308, 0.45, 0.2), win = sm(0x0f172a, 0.2, 0.5);
  const fus = sg('fus', () => { const c = new THREE.CapsuleGeometry(0.85, 9, 6, 14); c.rotateZ(Math.PI / 2); return c; }); g.add(new THREE.Mesh(fus, white));
  part(g, BOX(), win, 7.4, 0.18, 1.72, 0.2, 0.25, 0); part(g, BOX(), win, 0.7, 0.3, 1.2, 4.7, 0.25, 0); // window band, cockpit
  part(g, BOX(), gold, 9, 0.12, 1.74, -0.3, -0.3, 0); // cheatline
  const wing = sg('wing', () => { const s = new THREE.Shape(); s.moveTo(1.5, 0); s.lineTo(-0.6, 7); s.lineTo(-1.8, 7); s.lineTo(-1.6, 0); const w = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }); w.rotateX(Math.PI / 2); return w; });
  for (const sgn of [1, -1]) { const w = new THREE.Mesh(wing, white); w.scale.z = sgn; w.position.set(0.4, -0.35, 0); g.add(w);
    const t = new THREE.Mesh(wing, white); t.scale.set(0.45, 1, sgn * 0.42); t.position.set(-4.4, 0.3, 0); g.add(t);
    part(g, CYL(), grey, 0.75, 2.0, 0.75, 0.9, -0.85, sgn * 3.0).rotation.z = Math.PI / 2; part(g, CYL8(), sm(0x111827, 0.6), 0.6, 0.05, 0.6, 1.92, -0.85, sgn * 3.0).rotation.z = Math.PI / 2; }
  const fin = sg('fin', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(-2.4, 0); s.lineTo(-3.2, 2.6); s.lineTo(-2.2, 2.6); const w = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false }); w.translate(0, 0, -0.08); return w; });
  const f = new THREE.Mesh(fin, gold); f.position.set(-2.6, 0.6, 0); g.add(f);
  part(g, SPH(), sm(0xff3b30, 0.3, 0, 0xff3b30, 2), 0.2, 0.2, 0.2, 0.2, -0.32, 7.05); part(g, SPH(), sm(0x22c55e, 0.3, 0, 0x22c55e, 2), 0.2, 0.2, 0.2, 0.2, -0.32, -7.05);
  return g;
}
export function ship() {
  const g = new THREE.Group(); const navy = sm(0x1e3a8a, 0.55, 0.2), red = sm(0x9f1239, 0.7), deckM = sm(0x4b5563, 0.85), white = sm(0xf1f5f9, 0.5), win = sm(0x0f172a, 0.2, 0.4, 0x7dd3fc, 0.35);
  const lower = new THREE.Mesh(hullGeo(), red); lower.scale.set(1, 1.2, 1); lower.position.y = 0.2; g.add(lower); // boot-topping (sits in the water)
  const upper = new THREE.Mesh(hullGeo(), navy); upper.scale.set(1, 2.0, 1); upper.position.y = 2.2; g.add(upper);
  const dk = new THREE.Mesh(hullGeo(), deckM); dk.scale.set(0.98, 0.1, 0.96); dk.position.y = 2.25; g.add(dk);
  part(g, BOX(), white, 0.08, 0.12, 4.9, 9.15, 2.4, 0); // bow rail tip
  // stern superstructure: 4-deck accommodation block, bridge with wings, funnel
  part(g, BOX(), white, 3, 4.2, 4.2, -7, 4.3, 0); part(g, BOX(), white, 2.2, 0.8, 5.6, -6.4, 6.6, 0); part(g, BOX(), win, 0.06, 0.45, 4.6, -5.28, 6.6, 0);
  for (let y = 0; y < 3; y++) part(g, BOX(), win, 0.06, 0.32, 3.4, -5.48, 3.2 + y * 1.1, 0);
  part(g, CYL(), sm(0xdc2626, 0.5), 1.1, 2.4, 1.1, -8.2, 7.2, 0); part(g, CYL(), sm(0x111827, 0.6), 1.12, 0.5, 1.12, -8.2, 8.5, 0);
  part(g, CYL8(), sm(0x94a3b8, 0.4, 0.6), 0.1, 2.2, 0.1, -6.4, 8.1, 0);
  // containers on deck (one instanced mesh per ship, colours per box)
  const cols = [0xdc2626, 0x16a34a, 0xf59e0b, 0x2563eb, 0x9333ea, 0x0f766e, 0xf1f5f9]; const im = new THREE.InstancedMesh(BOX(), new THREE.MeshStandardMaterial({ roughness: 0.65, map: ribTexture() }), 5 * 3 * 2); let k = 0; const m4 = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) for (let y = 0; y < 2; y++) { m4.makeScale(2.5, 1.15, 1.35); m4.setPosition(-3.4 + i * 2.65, 2.9 + y * 1.18, (j - 1) * 1.42); im.setMatrixAt(k, m4); im.setColorAt(k, c.setHex(cols[(i * 3 + j * 2 + y * 5) % cols.length]!)); k++; }
  g.add(im); part(g, BOX(), sm(0x94a3b8, 0.5, 0.5), 0.3, 3.6, 0.3, 6.4, 4, 0); // foremast
  return g;
}
export function port(hub: HubId) {
  const [[x0, z0], [, z1]] = HUB_MAPS[hub].port.pier as [[number, number], [number, number]];
  const sign = tag(`⚓ ${HUBS[hub].port} · cargo every 2h`, '#38bdf8');
  return buildHarbour({ x: x0 - 7, z0, z1, quayW: hub === 'city' ? 76 : 48, quayD: hub === 'city' ? 16 : 10, side: 1, cranes: hub === 'city' ? 2 : 1, stacks: hub === 'city' ? 6 : 3, label: sign });
}

type V = { v: LiveVehicle; obj: THREE.Group; tag: THREE.Sprite };
/** Draw the port + traffic on one map's scene (city, resort or Fort McChud). */
export function createFreight(world: Pick<World, 'scene'>, hub: HubId = 'city') {
  const { scene } = world; const p = port(hub); scene.add(p); const live = new Map<string, V>();
  const build = (v: LiveVehicle) => (v.mode === 'plane' ? plane() : v.mode === 'ship' ? ship() : truck(v.color, v.mode === 'hired'));
  const onLive = (list: LiveVehicle[]) => {
    const seen = new Set<string>();
    for (const v of list) { if (!onMap(v, hub)) continue; seen.add(v.id); const cur = live.get(v.id);
      if (cur && cur.v.label === v.label) { cur.v = v; continue; }
      if (cur) { scene.remove(cur.obj, cur.tag); }
      const o = { v, obj: build(v), tag: tag(v.label, v.mode === 'ship' ? '#38bdf8' : v.mode === 'plane' ? '#e5e7eb' : v.mode === 'hired' ? '#f97316' : '#ffd27a') }; scene.add(o.obj, o.tag); live.set(v.id, o); }
    for (const [k, o] of live) if (!seen.has(k)) { scene.remove(o.obj, o.tag); live.delete(k); }
  };
  const frame = () => {
    const now = Date.now();
    for (const [k, o] of live) { const ps = vehiclePose(o.v, now, hub);
      if (ps.phase === 'arrived' || (ps.phase === 'loading' && o.v.mode !== 'ship' && o.v.mode !== 'plane')) { o.obj.visible = o.tag.visible = false; if (ps.phase === 'arrived') { scene.remove(o.obj, o.tag); live.delete(k); } continue; }
      o.obj.visible = o.tag.visible = true; o.obj.position.set(ps.x, ps.y + (o.v.mode === 'ship' ? -0.2 : 0), ps.z); o.obj.rotation.y = -ps.a; o.tag.position.set(ps.x, ps.y + (o.v.mode === 'ship' ? 7 : o.v.mode === 'plane' ? 3 : 3.4), ps.z); }
  };
  const watch = () => socket.emit('freight_watch', true);
  socket.on('freight_live', onLive); socket.on('connect', watch); if (socket.connected) watch();
  const t = window.setInterval(frame, 50);
  return { live, dispose() { window.clearInterval(t); socket.off('freight_live', onLive); socket.off('connect', watch); socket.emit('freight_watch', false); scene.remove(p); for (const o of live.values()) scene.remove(o.obj, o.tag); live.clear(); } };
}
