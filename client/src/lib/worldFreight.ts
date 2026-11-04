/**
 * Logistics on the city map: the ocean port (pier, crane, containers) and every moving shipment from 'freight_live'
 * (trucks with their owner's name, hired rigs, hourly freight planes, 2-hourly cargo ships). Trucks only exist on the
 * map while they're driving a load; a ship sits at the port while it loads.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { socket } from './net';
import { HUBS, HUB_MAPS, onMap, vehiclePose, type HubId, type LiveVehicle } from '../../../shared/logistics';

function tag(text: string, color = '#ffd27a'): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 384; c.height = 64; const x = c.getContext('2d')!;
  x.font = 'bold 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(380, x.measureText(text).width + 28); x.fillStyle = 'rgba(10,12,20,0.8)'; x.beginPath(); x.roundRect((384 - w) / 2, 8, w, 48, 14); x.fill();
  x.strokeStyle = color; x.lineWidth = 3; x.stroke(); x.fillStyle = '#fff'; x.fillText(text.slice(0, 26), 192, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false })); s.scale.set(0.135, 0.0225, 1); s.center.set(0.5, 0); s.renderOrder = 11; return s;
}
const box = (w: number, h: number, d: number, color: number, y = h / 2) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.7 })); m.position.y = y; return m; };

function truck(color: number, hired: boolean) {
  const g = new THREE.Group(); const cab = box(1.6, 1.5, 1.8, color, 1.05); cab.position.x = 1.9; g.add(cab);
  const cargo = box(3.2, 2, 2, hired ? 0xd1d5db : 0xf3f4f6, 1.3); cargo.position.x = -0.5; g.add(cargo);
  if (hired) { const stripe = box(3.22, 0.35, 2.02, 0xf97316, 1.4); stripe.position.x = -0.5; g.add(stripe); }
  for (const [x, z] of [[1.9, 0.95], [1.9, -0.95], [-1.2, 0.95], [-1.2, -0.95]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x111111 })); w.rotation.x = Math.PI / 2; w.position.set(x!, 0.42, z!); g.add(w); }
  return g;
}
function plane() {
  const g = new THREE.Group(); const f = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 10, 12), new THREE.MeshStandardMaterial({ color: 0xf8fafc })); f.rotation.z = Math.PI / 2; g.add(f);
  g.add(box(2.2, 0.2, 13, 0xe5e7eb, 0)); const t = box(1.2, 0.15, 4.5, 0xe5e7eb, 0.4); t.position.x = -4.4; g.add(t); const fin = box(1.2, 2, 0.15, 0xeab308, 1.2); fin.position.x = -4.4; g.add(fin); return g;
}
function ship() {
  const g = new THREE.Group(); g.add(box(18, 2.2, 5, 0x1e3a8a, 0.6)); const br = box(3, 3, 4, 0xf1f5f9, 3.2); br.position.x = -6.5; g.add(br);
  const cols = [0xdc2626, 0x16a34a, 0xf59e0b, 0x2563eb, 0x9333ea];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const c = box(2.6, 1.2, 2.2, cols[(i + j * 2) % cols.length]!, 2.3 + j * 1.2); c.position.x = -2.5 + i * 2.9; g.add(c); }
  return g;
}
function port(hub: HubId) {
  const g = new THREE.Group();
  const [[x0, z0], [, z1]] = HUB_MAPS[hub].port.pier as [[number, number], [number, number]]; const pier = box(8, 0.8, z1 - z0, 0x6b7280, 0.3); pier.position.set(x0 - 7, 0, (z0 + z1) / 2); g.add(pier);
  const crane = new THREE.Group(); crane.add(box(0.6, 12, 0.6, 0xf59e0b, 6)); const arm = box(10, 0.5, 0.5, 0xf59e0b, 12); arm.position.x = 3.5; crane.add(arm); crane.position.set(x0 - 7, 0, z0 + 10); g.add(crane);
  const cols = [0xdc2626, 0x16a34a, 0x2563eb, 0xf59e0b];
  for (let i = 0; i < 6; i++) { const c = box(2.4, 1.2, 1.1, cols[i % 4]!, 1.3 + (i % 2) * 1.2); c.position.set(x0 - 8, 0, z0 + 3 + Math.floor(i / 2) * 1.4); g.add(c); }
  const sign = tag(`⚓ ${HUBS[hub].port} · cargo every 2h`, '#38bdf8'); sign.position.set(x0 - 7, 14, z0 + 10); g.add(sign);
  return g;
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
