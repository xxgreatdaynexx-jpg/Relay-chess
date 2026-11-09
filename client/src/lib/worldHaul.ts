/**
 * Cosmetic delivery trucks on the city map. Listens for 'haul_visual', draws trucks with name tags along
 * road paths, despawns on arrival. Respects HAUL_OFF_KEY and caps + far LOD for mobile.
 */
import * as THREE from 'three';
import { cityLabel } from './labelSprite';
import type { World } from './world3d';
import { socket } from './net';
import { truck } from './worldFreight';
import { HAUL_MAX_VISIBLE, HAUL_OFF_KEY, haulPose, type HaulEvent } from '../../../shared/haulVisual';

function tag(text: string): THREE.Sprite {
  const t = cityLabel(text, '#ffd27a'); const d = t.userData as { w: number; h: number };
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, premultipliedAlpha: true, toneMapped: false, sizeAttenuation: false }));
  s.scale.set(0.09 * d.w, 0.0225 * d.h, 1); s.center.set(0.5, 0); s.renderOrder = 11; return s;
}
const disposeSprite = (s: THREE.Sprite) => { s.material.map?.dispose(); s.material.dispose(); };

const off = () => { try { return localStorage.getItem(HAUL_OFF_KEY) === '1'; } catch { return false; } };
const isMobile = () => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 900px)')?.matches || ('ontouchstart' in window && window.innerWidth < 1100));

type Live = { e: HaulEvent; obj: THREE.Group; tag: THREE.Sprite; lod: 'near' | 'far' };

export function createHaul(world: Pick<World, 'scene' | 'camera'>) {
  const { scene, camera } = world;
  const live = new Map<string, Live>();
  let list: HaulEvent[] = [];

  const onLive = (rows: HaulEvent[]) => {
    if (!Array.isArray(rows)) return;
    list = rows.slice(0, HAUL_MAX_VISIBLE);
  };

  const sync = (now: number) => {
    if (off()) {
      for (const [, o] of live) { scene.remove(o.obj, o.tag); disposeSprite(o.tag); }
      live.clear(); return;
    }
    const seen = new Set<string>();
    const cam = camera.position;
    const mobile = isMobile();
    const budget = mobile ? Math.min(12, HAUL_MAX_VISIBLE) : HAUL_MAX_VISIBLE;
    // Prefer nearer trucks when over budget
    const ranked = list
      .filter((e) => e.arriveAt > now)
      .map((e) => {
        const mid = e.path[Math.floor(e.path.length / 2)] ?? e.from;
        return { e, d: Math.hypot(mid[0] - cam.x, mid[1] - cam.z) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, budget);

    for (const { e, d } of ranked) {
      seen.add(e.id);
      let cur = live.get(e.id);
      if (!cur) {
        const obj = truck(0xf59e0b, false); obj.scale.setScalar(0.85);
        const tg = tag(e.name);
        scene.add(obj, tg);
        cur = { e, obj, tag: tg, lod: 'near' };
        live.set(e.id, cur);
      } else cur.e = e;
      // Far LOD: hide detailed children beyond ~180 on mobile / ~260 desktop
      const far = d > (mobile ? 140 : 220);
      if (far !== (cur.lod === 'far')) {
        cur.lod = far ? 'far' : 'near';
        cur.obj.traverse((c) => { if ((c as THREE.Mesh).isMesh && c !== cur!.obj) c.visible = !far; });
      }
    }
    for (const [id, o] of live) if (!seen.has(id)) {
      scene.remove(o.obj, o.tag); disposeSprite(o.tag); live.delete(id);
    }
  };

  const frame = () => {
    const now = Date.now();
    sync(now);
    for (const o of live.values()) {
      const ps = haulPose(o.e, now);
      if (ps.done) { o.obj.visible = o.tag.visible = false; continue; }
      o.obj.visible = o.tag.visible = true;
      o.obj.position.set(ps.x, 0, ps.z);
      o.obj.rotation.y = -ps.a;
      o.tag.position.set(ps.x, 3.2, ps.z);
    }
  };

  const watch = () => { socket.emit('haul_watch', true); socket.emit('freight_watch', true); };
  socket.on('haul_visual', onLive);
  socket.on('connect', watch);
  if (socket.connected) watch();
  const t = window.setInterval(frame, 50);
  return {
    dispose() {
      window.clearInterval(t);
      socket.off('haul_visual', onLive);
      socket.off('connect', watch);
      socket.emit('haul_watch', false);
      for (const o of live.values()) { scene.remove(o.obj, o.tag); disposeSprite(o.tag); }
      live.clear();
    },
  };
}
