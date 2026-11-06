/**
 * Farm-perimeter protest crowds (cosmetic). Ownership-driven; shares synth SFX with City Hall.
 * Does not alter crops, roads, or farm interactions — NPCs stand outside pads only.
 */
import * as THREE from 'three';
import { prefersReducedMotion } from './motion';
import { lowDetail } from './charLook';
import {
  SHIRT_COLORS,
  stepProtesters,
  protestUpdateBudget,
  type ProtesterState,
  type ProtestZone,
} from './townHallProtest';
import { sharedProtestSfx, type ProtestSfx } from './protestSfx';
import {
  PROTEST_TARGET_OWNER,
  targetFarmIds,
  targetResortFarmIds,
  plotByFarmId,
  farmPerimeterPoints,
  farmProtestBudget,
  spawnFarmCluster,
  clusterZone,
  onAnyFarmPad,
  type OwnedProp,
} from './farmProtest';

export interface FarmProtestHandle {
  step: (dt: number, t: number, cam: THREE.Vector3) => void;
  /** Rebuild when ownership snapshot changes (dynamic — sold farms lose crowds). */
  setOwned: (owned: OwnedProp[]) => void;
  /** Current city farm ids with a crowd (for tests / scope reports). */
  activeFarmIds: () => string[];
  dispose: () => void;
}

interface Fig {
  root: THREE.Group;
  arm: THREE.Group;
  bubble: THREE.Sprite;
  bubbleMat: THREE.SpriteMaterial;
  bubbleTex: THREE.CanvasTexture;
  bubbleCtx: CanvasRenderingContext2D;
  bubbleCanvas: HTMLCanvasElement;
  state: ProtesterState;
  lastSlogan: string;
}

interface Site {
  farmId: string;
  root: THREE.Group;
  origin: { x: number; z: number };
  zone: ProtestZone;
  states: ProtesterState[];
  figs: Fig[];
  chantAcc: number;
}

function bubbleTexture(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  return { c, ctx, tex };
}

function drawBubble(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, text: string): void {
  ctx.clearRect(0, 0, c.width, c.height);
  if (!text) return;
  ctx.fillStyle = 'rgba(12, 10, 24, 0.88)';
  roundRect(ctx, 8, 8, c.width - 16, c.height - 28, 18);
  ctx.fill();
  ctx.strokeStyle = '#e8c26a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.width * 0.45, c.height - 28);
  ctx.lineTo(c.width * 0.5, c.height - 8);
  ctx.lineTo(c.width * 0.58, c.height - 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4efe6';
  ctx.font = '800 28px Outfit Variable, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, (c.height - 28) / 2 + 4, c.width - 36);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapSlogan(s: string): string[] {
  const parts = s.replace('!', '').split(' ');
  if (parts.length <= 2) return [s];
  return [parts.slice(0, Math.ceil(parts.length / 2)).join(' '), parts.slice(Math.ceil(parts.length / 2)).join(' ') + (s.endsWith('!') ? '!' : '')];
}

type SharedGeo = {
  bodyGeo: THREE.BufferGeometry; legGeo: THREE.BufferGeometry; headGeo: THREE.BufferGeometry;
  hairGeo: THREE.BufferGeometry; stickGeo: THREE.BufferGeometry; boardGeo: THREE.BufferGeometry;
  skin: THREE.Material; stick: THREE.Material; board: THREE.Material;
};

function buildFigure(p: ProtesterState, shared: SharedGeo): Fig {
  const root = new THREE.Group();
  root.position.set(p.lx, 0, p.lz);
  root.rotation.y = p.yaw;
  const shirt = new THREE.MeshStandardMaterial({ color: SHIRT_COLORS[p.shirt]!, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: p.id % 3 === 0 ? 0x2c3340 : p.id % 3 === 1 ? 0x3a2f28 : 0x1e2430, roughness: 0.9 });
  const body = new THREE.Mesh(shared.bodyGeo, shirt);
  body.position.y = 1.05;
  const legL = new THREE.Mesh(shared.legGeo, pants); legL.position.set(-0.12, 0.38, 0);
  const legR = new THREE.Mesh(shared.legGeo, pants); legR.position.set(0.12, 0.38, 0);
  const head = new THREE.Mesh(shared.headGeo, shared.skin);
  head.position.y = 1.88;
  const hair = new THREE.Mesh(shared.hairGeo, new THREE.MeshStandardMaterial({ color: [0x1a1512, 0x3b2a1a, 0x6b4a2b, 0xc4b49a, 0x111111][p.id % 5]!, roughness: 0.95 }));
  hair.position.y = 2.08;
  root.add(body, legL, legR, head, hair);
  const arm = new THREE.Group();
  arm.position.set(0.32, 1.45, 0);
  const stickM = new THREE.Mesh(shared.stickGeo, shared.stick);
  stickM.position.set(0, 0.65, 0);
  const sign = new THREE.Mesh(shared.boardGeo, shared.board.clone());
  (sign.material as THREE.MeshStandardMaterial).color.setHex(p.id % 2 ? 0xf4f0e4 : 0xffe08a);
  sign.position.set(0, 1.35, 0.02);
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 192;
    const g = c.getContext('2d')!;
    g.fillStyle = p.id % 2 ? '#f4f0e4' : '#ffe08a'; g.fillRect(0, 0, 256, 192);
    g.strokeStyle = '#1a1520'; g.lineWidth = 8; g.strokeRect(6, 6, 244, 180);
    g.fillStyle = '#1a1520';
    g.font = '800 44px Outfit Variable, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = wrapSlogan(p.slogan);
    lines.forEach((ln, i) => g.fillText(ln, 128, 96 + (i - (lines.length - 1) / 2) * 44, 230));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = sign.material as THREE.MeshStandardMaterial;
    m.map = tex; m.needsUpdate = true;
  }
  if (p.hasSign) arm.add(stickM, sign);
  else {
    const fist = new THREE.Mesh(shared.hairGeo, shared.skin);
    fist.scale.set(0.55, 0.55, 0.55); fist.position.set(0, 0.55, 0); arm.add(fist);
  }
  root.add(arm);
  const { c, ctx, tex } = bubbleTexture();
  const bubbleMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const bubble = new THREE.Sprite(bubbleMat);
  bubble.scale.set(2.4, 0.9, 1);
  bubble.position.set(0, 2.75, 0);
  bubble.visible = false;
  bubble.renderOrder = 12;
  root.add(bubble);
  return { root, arm, bubble, bubbleMat, bubbleTex: tex, bubbleCtx: ctx, bubbleCanvas: c, state: p, lastSlogan: '' };
}

/** Pure plan: which farms get crowds + how many NPCs (for tests). */
export function planFarmProtestSites(owned: OwnedProp[], low = false): {
  farmIds: string[];
  resortIds: string[];
  perFarm: number;
  total: number;
  owner: string;
} {
  const farmIdsAll = targetFarmIds(owned);
  const resortIds = targetResortFarmIds(owned);
  const budget = farmProtestBudget(farmIdsAll.length, low);
  return {
    farmIds: farmIdsAll.slice(0, budget.farmsUsed),
    resortIds,
    perFarm: budget.perFarm,
    total: budget.total,
    owner: PROTEST_TARGET_OWNER,
  };
}

/**
 * Attach ownership-driven farm-perimeter protest crowds under `parent` (typically the city scene root).
 * City Hall crowd is separate (attachTownHallProtest). Resort farms are reported but not rendered in city.
 */
export function attachFarmProtests(
  parent: THREE.Object3D,
  disposables: { dispose(): void }[],
): FarmProtestHandle {
  const low = lowDetail();
  const root = new THREE.Group();
  root.name = 'farm-protests';
  parent.add(root);

  const bodyGeo = new THREE.CylinderGeometry(0.30, 0.34, 1.15, low ? 6 : 10);
  const legGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.75, low ? 5 : 8);
  const headGeo = new THREE.SphereGeometry(0.27, low ? 8 : 12, low ? 6 : 10);
  const hairGeo = new THREE.SphereGeometry(0.29, low ? 6 : 10, low ? 4 : 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const stickGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.3, 5);
  const boardGeo = new THREE.BoxGeometry(0.95, 0.72, 0.05);
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.7 });
  const stick = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
  const board = new THREE.MeshStandardMaterial({ color: 0xf4f0e4, roughness: 0.85 });
  const shared: SharedGeo = { bodyGeo, legGeo, headGeo, hairGeo, stickGeo, boardGeo, skin, stick, board };
  disposables.push(bodyGeo, legGeo, headGeo, hairGeo, stickGeo, boardGeo, skin, stick, board);

  const sfx: ProtestSfx = sharedProtestSfx();
  let sites: Site[] = [];
  let key = '';
  let dead = false;
  let idBase = 100;

  const clearSites = () => {
    for (const s of sites) {
      root.remove(s.root);
      for (const f of s.figs) {
        s.root.remove(f.root);
        f.bubble.visible = false;
        f.bubbleTex.dispose();
        f.bubbleMat.dispose();
      }
    }
    sites = [];
  };

  const rebuild = (owned: OwnedProp[]) => {
    const plan = planFarmProtestSites(owned, low);
    const nextKey = plan.farmIds.join(',');
    if (nextKey === key) return;
    key = nextKey;
    clearSites();
    let n = 0;
    for (const fid of plan.farmIds) {
      const plot = plotByFarmId(fid);
      if (!plot) continue;
      const pts = farmPerimeterPoints(plot, plan.perFarm, 9001 + plot.n * 17);
      if (!pts.length) continue;
      const origin = { x: plot.x, z: plot.z };
      const states = spawnFarmCluster(pts, origin.x, origin.z, 4242 + plot.n, idBase);
      idBase += states.length + 3;
      const zone = clusterZone(states);
      const siteRoot = new THREE.Group();
      siteRoot.name = `farm-protest-${fid}`;
      siteRoot.position.set(origin.x, 0, origin.z);
      const figs = states.map((p) => {
        const f = buildFigure(p, shared);
        siteRoot.add(f.root);
        return f;
      });
      root.add(siteRoot);
      sites.push({ farmId: fid, root: siteRoot, origin, zone, states, figs, chantAcc: 0 });
      n += states.length;
    }
    void n;
  };

  return {
    step(dt, t, cam) {
      if (dead) return;
      const reduced = prefersReducedMotion();
      for (const s of sites) {
        const dist = Math.hypot(cam.x - s.origin.x, cam.z - s.origin.z);
        const budget = protestUpdateBudget(dist, low);
        if (!budget.step) {
          for (const f of s.figs) f.bubble.visible = false;
          continue;
        }
        stepProtesters(s.states, dt, t, {
          reducedMotion: reduced,
          allowBubbles: budget.bubbles && !reduced,
          zone: s.zone,
          aisle: 0,
          reject: (lx, lz) => onAnyFarmPad(s.origin.x + lx, s.origin.z + lz, 0.15),
        });
        for (const f of s.figs) {
          const p = f.state;
          f.root.position.set(p.lx, 0, p.lz);
          f.root.rotation.y = p.yaw;
          f.arm.rotation.z = -0.15 - p.wave * 0.85;
          f.arm.rotation.x = Math.sin(t * 1.3 + p.phase) * 0.08;
          const show = budget.bubbles && !reduced && p.bubbleUntil > t;
          if (show && p.slogan !== f.lastSlogan) {
            drawBubble(f.bubbleCtx, f.bubbleCanvas, p.slogan);
            f.bubbleTex.needsUpdate = true;
            f.lastSlogan = p.slogan;
          }
          f.bubble.visible = !!show;
          if (show) f.bubble.material.opacity = Math.min(1, (p.bubbleUntil - t) * 1.2);
        }
        if (!reduced && budget.bubbles) {
          s.chantAcc += dt;
          const anyBubble = s.states.some((p) => p.bubbleUntil > t);
          if (anyBubble && s.chantAcc > 0.35) {
            s.chantAcc = 0;
            sfx.chant(dist, dist < 22);
          } else if (s.chantAcc > 2.8) {
            s.chantAcc = 0;
            sfx.shout(dist);
          }
        }
      }
    },
    setOwned(owned) {
      if (dead) return;
      rebuild(owned);
    },
    activeFarmIds: () => sites.map((s) => s.farmId),
    dispose() {
      if (dead) return;
      dead = true;
      clearSites();
      parent.remove(root);
      // sharedProtestSfx disposed once from world3d.dispose
    },
  };
}
