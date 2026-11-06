/**
 * Three.js attachment for the Town Hall protest crowd: milling figures, placards, speech bubbles, synth shouts.
 * Teardown via dispose() on world unmount. Movement/audio gated by prefersReducedMotion + mute/volume.
 */
import * as THREE from 'three';
import { prefersReducedMotion } from './motion';
import { lowDetail } from './charLook';
import {
  CHANT_SLOGANS,
  PROTEST_COUNT_DEFAULT,
  PROTEST_COUNT_LOW,
  SHIRT_COLORS,
  spawnProtesters,
  stepProtesters,
  protestUpdateBudget,
  type ProtesterState,
} from './townHallProtest';
import { makeProtestSfx, type ProtestSfx } from './protestSfx';

export interface TownHallProtest {
  root: THREE.Group;
  step: (dt: number, t: number, cam: THREE.Vector3) => void;
  dispose: () => void;
}

interface Fig {
  root: THREE.Group;
  body: THREE.Mesh;
  arm: THREE.Group;
  sign: THREE.Mesh;
  bubble: THREE.Sprite;
  bubbleMat: THREE.SpriteMaterial;
  bubbleTex: THREE.CanvasTexture;
  bubbleCtx: CanvasRenderingContext2D;
  bubbleCanvas: HTMLCanvasElement;
  state: ProtesterState;
  lastSlogan: string;
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
  // tail
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

function buildFigure(
  p: ProtesterState,
  shared: { bodyGeo: THREE.BufferGeometry; headGeo: THREE.BufferGeometry; stickGeo: THREE.BufferGeometry; boardGeo: THREE.BufferGeometry; skin: THREE.Material; stick: THREE.Material; board: THREE.Material },
): Fig {
  const root = new THREE.Group();
  root.position.set(p.lx, 0, p.lz);
  root.rotation.y = p.yaw;

  const shirt = new THREE.MeshStandardMaterial({ color: SHIRT_COLORS[p.shirt]!, roughness: 0.85 });
  const body = new THREE.Mesh(shared.bodyGeo, shirt);
  body.position.y = 0.85;
  body.castShadow = false;
  const head = new THREE.Mesh(shared.headGeo, shared.skin);
  head.position.y = 1.72;
  root.add(body, head);

  const arm = new THREE.Group();
  arm.position.set(0.28, 1.35, 0);
  const stickM = new THREE.Mesh(shared.stickGeo, shared.stick);
  stickM.position.set(0, 0.55, 0);
  const sign = new THREE.Mesh(shared.boardGeo, shared.board.clone());
  (sign.material as THREE.MeshStandardMaterial).color.setHex(p.id % 2 ? 0xf4f0e4 : 0xffe08a);
  sign.position.set(0, 1.15, 0.02);
  // paint slogan on a canvas map once
  {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = p.id % 2 ? '#f4f0e4' : '#ffe08a'; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#1a1520';
    g.font = '800 22px Outfit Variable, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = wrapSlogan(p.slogan);
    lines.forEach((ln, i) => g.fillText(ln, 64, 48 + (i - (lines.length - 1) / 2) * 22, 118));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = sign.material as THREE.MeshStandardMaterial;
    m.map = tex; m.needsUpdate = true;
  }
  if (p.hasSign) arm.add(stickM, sign);
  root.add(arm);

  const { c, ctx, tex } = bubbleTexture();
  const bubbleMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const bubble = new THREE.Sprite(bubbleMat);
  bubble.scale.set(2.4, 0.9, 1);
  bubble.position.set(0, 2.55, 0);
  bubble.visible = false;
  bubble.renderOrder = 12;
  root.add(bubble);

  return { root, body, arm, sign, bubble, bubbleMat, bubbleTex: tex, bubbleCtx: ctx, bubbleCanvas: c, state: p, lastSlogan: '' };
}

function wrapSlogan(s: string): string[] {
  const parts = s.replace('!', '').split(' ');
  if (parts.length <= 2) return [s];
  return [parts.slice(0, Math.ceil(parts.length / 2)).join(' '), parts.slice(Math.ceil(parts.length / 2)).join(' ') + (s.endsWith('!') ? '!' : '')];
}

/**
 * Attach a protest crowd as a child of the City Hall landmark group (local plaza coords).
 * `hallWorld` = landmark world position for audio distance.
 */
export function attachTownHallProtest(
  hallGroup: THREE.Group,
  hallWorld: { x: number; z: number },
  disposables: { dispose(): void }[],
): TownHallProtest {
  const low = lowDetail();
  const count = low ? PROTEST_COUNT_LOW : PROTEST_COUNT_DEFAULT;
  const states = spawnProtesters(42, count);
  const root = new THREE.Group();
  root.name = 'townhall-protest';
  hallGroup.add(root);

  const bodyGeo = new THREE.CylinderGeometry(0.28, 0.32, 1.35, low ? 6 : 10);
  const headGeo = new THREE.SphereGeometry(0.26, low ? 8 : 12, low ? 6 : 10);
  const stickGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5);
  const boardGeo = new THREE.BoxGeometry(0.72, 0.55, 0.04);
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b48a, roughness: 0.7 });
  const stick = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
  const board = new THREE.MeshStandardMaterial({ color: 0xf4f0e4, roughness: 0.85 });
  disposables.push(bodyGeo, headGeo, stickGeo, boardGeo, skin, stick, board);

  const shared = { bodyGeo, headGeo, stickGeo, boardGeo, skin, stick, board };
  const figs = states.map((p) => {
    const f = buildFigure(p, shared);
    root.add(f.root);
    disposables.push(f.bubbleTex, f.bubbleMat, f.body.material as THREE.Material);
    if ((f.sign.material as THREE.MeshStandardMaterial).map) {
      disposables.push((f.sign.material as THREE.MeshStandardMaterial).map!);
    }
    disposables.push(f.sign.material as THREE.Material);
    return f;
  });

  const sfx: ProtestSfx = makeProtestSfx();
  let dead = false;
  let chantAcc = 0;

  const syncMeshes = (t: number, showBubbles: boolean) => {
    for (const f of figs) {
      const p = f.state;
      f.root.position.set(p.lx, 0, p.lz);
      f.root.rotation.y = p.yaw;
      // raised-arm wave
      f.arm.rotation.z = -0.15 - p.wave * 0.85;
      f.arm.rotation.x = Math.sin(t * 1.3 + p.phase) * 0.08;
      const show = showBubbles && p.bubbleUntil > t;
      if (show && p.slogan !== f.lastSlogan) {
        drawBubble(f.bubbleCtx, f.bubbleCanvas, p.slogan);
        f.bubbleTex.needsUpdate = true;
        f.lastSlogan = p.slogan;
      }
      f.bubble.visible = show;
      if (show) f.bubble.material.opacity = Math.min(1, (p.bubbleUntil - t) * 1.2);
    }
  };

  // initial pose
  syncMeshes(0, false);

  return {
    root,
    step(dt, t, cam) {
      if (dead) return;
      const dist = Math.hypot(cam.x - hallWorld.x, cam.z - hallWorld.z);
      const budget = protestUpdateBudget(dist, low);
      if (!budget.step) {
        for (const f of figs) f.bubble.visible = false;
        return;
      }
      const reduced = prefersReducedMotion();
      stepProtesters(states, dt, t, { reducedMotion: reduced, allowBubbles: budget.bubbles && !reduced });
      syncMeshes(t, budget.bubbles && !reduced);

      if (!reduced && budget.bubbles) {
        chantAcc += dt;
        // occasional crowd chant when a bubble is up and we're close enough
        const anyBubble = states.some((p) => p.bubbleUntil > t);
        if (anyBubble && chantAcc > 0.35) {
          chantAcc = 0;
          sfx.chant(dist, dist < 22);
        } else if (chantAcc > 2.8) {
          chantAcc = 0;
          sfx.shout(dist);
        }
      }
    },
    dispose() {
      if (dead) return;
      dead = true;
      sfx.dispose();
      hallGroup.remove(root);
      for (const f of figs) {
        root.remove(f.root);
        f.bubble.visible = false;
      }
    },
  };
}

/** Exported for tests / screenshots — slogan list used on placards & bubbles. */
export const PROTEST_VISIBLE_SLOGANS = CHANT_SLOGANS;
