/**
 * Public rocket launches in the 3D city: a rocket lifts off the Space Center pad with a flame, a pad
 * steam/smoke cloud and an exhaust trail that lingers and drifts on the wind, pitches over and climbs out
 * of sight; heavy designs drop their boosters. Everything is a pure function of (now - liftoff), so a
 * player who opens the map mid-flight sees exactly where the rocket is. Cosmetic only.
 */
import * as THREE from 'three';
import {
  showPose, hash01, showActive, SHOW_COUNTDOWN_MS, SHOW_FLIGHT_S, SHOW_LINGER_S, SHOW_SEP_S,
  type LaunchShow, type LaunchSize,
} from '../../../shared/spaceLaunchShow';

type Tier = 'low' | 'mid' | 'high';
const PARTICLES: Record<Tier, number> = { low: 100, mid: 220, high: 340 };
/** Downrange heading: east-southeast, out over the city. */
const HEADING = new THREE.Vector3(1, 0, 0.35).normalize();
const WIND = new THREE.Vector3(0.75, 0.12, 0.45);
const UP = new THREE.Vector3(0, 1, 0);

const DIMS: Record<LaunchSize, { h: number; r: number; smoke: number }> = {
  small: { h: 9, r: 0.55, smoke: 2.6 },
  medium: { h: 14.5, r: 0.8, smoke: 3.6 },
  heavy: { h: 19, r: 1.05, smoke: 4.8 },
};

const SMOKE_VS = `
attribute float aSize; attribute float aAlpha; attribute float aShade;
uniform float uScale;
varying float vAlpha; varying float vShade; varying float vFog;
uniform float uFogNear; uniform float uFogFar;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 480.0);
  vAlpha = aAlpha; vShade = aShade;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
}`;
const SMOKE_FS = `
uniform vec3 uLit; uniform vec3 uFogColor;
varying float vAlpha; varying float vShade; varying float vFog;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0 || vAlpha <= 0.002) discard;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha;
  // Cheap volume: lit top-left, shadowed bottom-right.
  float lit = 0.82 + 0.18 * (-c.y * 1.6 - c.x * 0.6) ;
  vec3 col = mix(uLit * vShade * lit, uFogColor, vFog);
  gl_FragColor = vec4(col, a * (1.0 - vFog * 0.85));
}`;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,214,120,0.85)');
  g.addColorStop(0.6, 'rgba(255,120,30,0.25)'); g.addColorStop(1, 'rgba(255,80,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function labelCanvas(): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; draw: (a: string, b: string, hot: boolean) => void } {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (a: string, b: string, hot: boolean) => {
    const x = canvas.getContext('2d')!;
    x.clearRect(0, 0, 512, 128);
    x.fillStyle = 'rgba(8,14,22,0.82)'; x.strokeStyle = hot ? '#ffb347' : '#e8c26a'; x.lineWidth = 4;
    x.beginPath(); x.roundRect(6, 6, 500, 116, 22); x.fill(); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = hot ? '#ffcf70' : '#ffffff'; x.font = '800 50px system-ui, sans-serif'; x.fillText(a, 256, 46);
    x.fillStyle = '#a9c4d8'; x.font = '600 28px system-ui, sans-serif'; x.fillText(b.length > 34 ? b.slice(0, 33) + '…' : b, 256, 96);
    tex.needsUpdate = true;
  };
  return { canvas, tex, draw };
}

interface Rig {
  show: LaunchShow;
  root: THREE.Group;
  body: THREE.Group;
  flames: THREE.Mesh[];
  boosterFlames: THREE.Mesh[];
  boosters: THREE.Group[];
  glow: THREE.Sprite;
  dot: THREE.Sprite;
  label: THREE.Sprite;
  labelDraw: (a: string, b: string, hot: boolean) => void;
  labelKey: string;
  labelTex: THREE.Texture;
  points: THREE.Points;
  pos: Float32Array; size: Float32Array; alpha: Float32Array; shade: Float32Array;
  /** Per-particle: emit time (s after liftoff), kind (0 trail, 1 pad cloud), jitter seeds. */
  te: Float32Array; kind: Uint8Array; seed: Float32Array;
  origin: Float32Array;
  sepFlash: THREE.Sprite | null;
  dispose: () => void;
}

export interface LaunchFx {
  setShows(list: LaunchShow[]): void;
  step(now: number, opts: { day: number; camera: THREE.PerspectiveCamera; viewH: number }): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

/**
 * @param pad world position of the pad deck (rocket base)
 * @param staticRocket the decorative rocket on the pad, hidden while a launch is on/over the pad
 */
export function createLaunchFx(scene: THREE.Scene, pad: THREE.Vector3, tier: Tier, staticRocket?: THREE.Object3D | null): LaunchFx {
  const shared: { dispose(): void }[] = [];
  const glowTex = glowTexture(); shared.push(glowTex);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 18); shared.push(cyl);
  const cone = new THREE.ConeGeometry(1, 1, 18); shared.push(cone);
  const flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true); flameGeo.translate(0, 0.5, 0); flameGeo.rotateX(Math.PI); shared.push(flameGeo);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.45, metalness: 0.15 });
  const band = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd8742e, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.4, metalness: 0.7 });
  const flameOuter = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const flameInner = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  shared.push(white, band, orange, metal, flameOuter, flameInner);
  const rigs = new Map<string, Rig>();
  let enabled = true;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion();

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const o = new THREE.Mesh(g, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); parent.add(o); return o;
  };
  const flame = (parent: THREE.Object3D, r: number, x: number, z: number, list: THREE.Mesh[]) => {
    const f = new THREE.Group(); f.position.set(x, 0, z); parent.add(f);
    const o = mesh(flameGeo, flameOuter, r * 1.25, r * 6, r * 1.25, 0, 0, 0, f);
    const i = mesh(flameGeo, flameInner, r * 0.7, r * 3.4, r * 0.7, 0, 0, 0, f);
    o.renderOrder = i.renderOrder = 3;
    list.push(o, i);
  };
  /** A stage stack along local +y from y=0 (engine plane) upward. */
  const stack = (parent: THREE.Object3D, h: number, r: number, accent: THREE.Material) => {
    mesh(cone, metal, r * 0.75, r * 0.9, r * 0.75, 0, r * 0.15, 0, parent); // engine bell skirt
    mesh(cyl, white, r, h * 0.62, r, 0, r * 0.6 + h * 0.31, 0, parent);
    mesh(cyl, band, r * 1.01, h * 0.04, r * 1.01, 0, r * 0.6 + h * 0.2, 0, parent);
    mesh(cyl, accent, r * 1.01, h * 0.05, r * 1.01, 0, r * 0.6 + h * 0.6, 0, parent);
    mesh(cyl, white, r * 0.86, h * 0.2, r * 0.86, 0, r * 0.6 + h * 0.72, 0, parent);
    mesh(cone, white, r * 0.86, h * 0.16, r * 0.86, 0, r * 0.6 + h * 0.9, 0, parent);
  };

  function build(show: LaunchShow): Rig {
    const d = DIMS[show.size];
    const root = new THREE.Group(); root.name = 'launch-show';
    const body = new THREE.Group(); root.add(body);
    const flames: THREE.Mesh[] = [], boosterFlames: THREE.Mesh[] = [];
    stack(body, d.h, d.r, show.size === 'heavy' ? orange : band);
    flame(body, d.r * (show.size === 'heavy' ? 1.1 : 0.9), 0, 0, flames);
    const boosters: THREE.Group[] = [];
    if (show.boosters) {
      for (const side of [-1, 1]) {
        const b = new THREE.Group(); b.position.set(0, 0, side * (d.r + d.r * 0.62)); body.add(b);
        const br = d.r * 0.6, bh = d.h * 0.58;
        mesh(cyl, white, br, bh, br, 0, br * 0.5 + bh / 2, 0, b);
        mesh(cyl, band, br * 1.02, bh * 0.06, br * 1.02, 0, br * 0.5 + bh * 0.25, 0, b);
        mesh(cone, white, br, bh * 0.16, br, 0, br * 0.5 + bh + bh * 0.08, 0, b);
        mesh(cone, metal, br * 0.7, br * 0.9, br * 0.7, 0, br * 0.2, 0, b);
        flame(b, br * 0.95, 0, 0, boosterFlames);
        boosters.push(b);
      }
    }
    // Two glows: a lit halo near the rocket (fogs out with distance) and a screen-sized spark that stays
    // visible as a bright dot while the rocket climbs away.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(d.r * 14); glow.renderOrder = 4; root.add(glow);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: false }));
    dot.scale.setScalar(0.035); dot.renderOrder = 5; root.add(dot);
    const lab = labelCanvas();
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lab.tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    label.scale.set(16, 4, 1); label.renderOrder = 6; root.add(label);
    // Smoke particles: emission times are dense near the pad and thinner up high.
    const n = PARTICLES[tier];
    const pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), shade = new Float32Array(n);
    const te = new Float32Array(n), kind = new Uint8Array(n), seed = new Float32Array(n * 3), origin = new Float32Array(n * 3);
    const padCount = Math.round(n * 0.28);
    for (let i = 0; i < n; i++) {
      const h1 = hash01(show.id, i * 3), h2 = hash01(show.id, i * 3 + 1), h3 = hash01(show.id, i * 3 + 2);
      seed[i * 3] = h1; seed[i * 3 + 1] = h2; seed[i * 3 + 2] = h3;
      if (i < padCount) { kind[i] = 1; te[i] = (i / padCount) * 6; }
      else { const k = (i - padCount) / (n - padCount); te[i] = 0.2 + Math.pow(k, 1.7) * (SHOW_FLIGHT_S - 2); }
      shade[i] = 0.82 + h3 * 0.18;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
    const smat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 }, uLit: { value: new THREE.Color(0xf2f2ee) }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 260 }, uFogFar: { value: 900 } },
    });
    const points = new THREE.Points(geo, smat); points.frustumCulled = false; points.renderOrder = 2;
    scene.add(points);
    scene.add(root);
    const rig: Rig = {
      show, root, body, flames, boosterFlames, boosters, glow, dot, label, labelDraw: lab.draw, labelKey: '', labelTex: lab.tex,
      points, pos, size, alpha, shade, te, kind, seed, origin, sepFlash: null,
      dispose: () => {
        scene.remove(root); scene.remove(points); geo.dispose(); smat.dispose(); lab.tex.dispose();
        (glow.material as THREE.Material).dispose(); (dot.material as THREE.Material).dispose(); (label.material as THREE.Material).dispose();
        if (rig.sepFlash) (rig.sepFlash.material as THREE.Material).dispose();
      },
    };
    // Precompute each trail particle's birth point (engine plane at its emit time).
    for (let i = 0; i < n; i++) {
      enginePoint(show.size, te[i]!, tmp);
      origin[i * 3] = tmp.x; origin[i * 3 + 1] = tmp.y; origin[i * 3 + 2] = tmp.z;
    }
    return rig;
  }

  /** World position of the engine plane `ts` s after liftoff. */
  function enginePoint(sizeC: LaunchSize, ts: number, out: THREE.Vector3) {
    const p = showPose(sizeC, ts);
    return out.copy(pad).addScaledVector(HEADING, p.down).addScaledVector(UP, p.up);
  }

  function stepRig(r: Rig, now: number, day: number, camera: THREE.PerspectiveCamera, viewH: number) {
    const s = r.show, d = DIMS[s.size];
    const ts = (now - s.at) / 1000;
    const p = showPose(s.size, ts);
    // Body pose.
    enginePoint(s.size, ts, tmp);
    r.root.position.copy(tmp);
    dir.copy(UP).multiplyScalar(Math.cos(p.pitch)).addScaledVector(HEADING, Math.sin(p.pitch));
    q.setFromUnitVectors(UP, dir);
    r.body.quaternion.copy(q);
    // Gentle wobble at liftoff, then a steady climb.
    const visible = ts < SHOW_FLIGHT_S + 4;
    r.body.visible = visible;
    const lit = ts >= -0.2 && p.burning;
    const flick = 0.85 + 0.15 * Math.sin(now * 0.047 + 1.3) * Math.sin(now * 0.031);
    // Plume grows as the air thins.
    const alt = Math.max(0, p.up);
    const stretch = (1 + Math.min(2.2, alt / 350)) * (ts < 0 ? 0.25 : 1) * flick;
    for (const f of r.flames) { f.visible = lit; f.scale.y = (f.material === flameOuter ? d.r * 6 : d.r * 3.4) * stretch * (s.size === 'heavy' ? 1.1 : 0.9); }
    const sepT = ts - SHOW_SEP_S;
    for (const f of r.boosterFlames) { f.visible = lit && (!s.boosters || sepT < 0); f.scale.y = (f.material === flameOuter ? d.r * 3.6 : d.r * 2) * stretch; }
    // Boosters: attached until separation, then coast, fall and tumble away for a while.
    for (let k = 0; k < r.boosters.length; k++) {
      const b = r.boosters[k]!; const side = k === 0 ? -1 : 1;
      if (sepT < 0) {
        if (b.parent !== r.body) { r.body.add(b); }
        b.position.set(0, 0, side * (d.r + d.r * 0.62)); b.rotation.set(0, 0, 0); b.visible = true;
        continue;
      }
      if (b.parent !== r.root) r.root.add(b);
      const sp = showPose(s.size, SHOW_SEP_S);
      const sdir = tmp2.copy(UP).multiplyScalar(Math.cos(sp.pitch)).addScaledVector(HEADING, Math.sin(sp.pitch));
      const u = Math.min(sepT, 16);
      // Relative to the core's current engine point: boosters fall behind (they stop accelerating) and drift sideways.
      enginePoint(s.size, SHOW_SEP_S, tmp);
      const P = tmp.clone().addScaledVector(sdir, sp.speed * u * 0.9).add(new THREE.Vector3(0, -4.9 * u * u * 0.55, 0));
      P.z += side * (d.r * 1.6 + 2.2 * u); P.x += side * 0.4 * u;
      b.position.copy(P.sub(r.root.position));
      b.quaternion.copy(q);
      b.rotateX(side * u * 0.5); b.rotateZ(u * 0.25);
      b.visible = sepT < 16;
    }
    if (s.boosters && sepT >= 0 && sepT < 1.2) {
      if (!r.sepFlash) {
        r.sepFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        r.root.add(r.sepFlash);
      }
      r.sepFlash.visible = true; r.sepFlash.position.copy(dir).multiplyScalar(d.h * 0.3);
      r.sepFlash.scale.setScalar(d.r * (10 + sepT * 30)); (r.sepFlash.material as THREE.SpriteMaterial).opacity = 1 - sepT / 1.2;
    } else if (r.sepFlash) r.sepFlash.visible = false;
    // Glows.
    const fade = ts > SHOW_FLIGHT_S - 12 ? Math.max(0, (SHOW_FLIGHT_S - ts) / 12) : 1;
    r.glow.visible = lit; r.glow.position.copy(dir).multiplyScalar(-d.r * 2.5);
    r.glow.scale.setScalar(d.r * 16 * flick * (1 + Math.min(1.5, alt / 500)));
    (r.glow.material as THREE.SpriteMaterial).opacity = 0.85 * fade;
    r.dot.visible = lit && ts > 3; (r.dot.material as THREE.SpriteMaterial).opacity = Math.min(1, (ts - 3) / 4) * fade;
    // Label: countdown on the pad, then the pilot's name rides with the rocket for a while.
    const cd = Math.ceil(-ts);
    const key = ts < 0 ? `T-${cd}` : ts < 4 ? 'LIFTOFF' : 'fly';
    if (key !== r.labelKey) {
      r.labelKey = key;
      if (ts < 0) r.labelDraw(`T-${cd}`, `${s.player} · ${s.design}`, true);
      else if (ts < 4) r.labelDraw('🚀 LIFTOFF', `${s.player} · ${s.design}`, true);
      else r.labelDraw(`🚀 ${s.player}`, s.design, false);
    }
    r.label.visible = ts < 30;
    r.label.position.set(0, d.h + 7 + (ts < 0 ? 0 : 0), 0);
    const ld = camera.position.distanceTo(r.root.position);
    const ls = THREE.MathUtils.clamp(ld / 18, 6, 30); r.label.scale.set(ls * 2, ls * 0.5, 1);
    (r.label.material as THREE.SpriteMaterial).opacity = ts > 24 ? Math.max(0, (30 - ts) / 6) : 1;
    // Smoke.
    const n = r.te.length;
    const life = SHOW_LINGER_S + 10;
    for (let i = 0; i < n; i++) {
      const age = ts - r.te[i]!;
      const o = i * 3;
      if (age <= 0) { r.alpha[i] = 0; continue; }
      const h1 = r.seed[o]!, h2 = r.seed[o + 1]!, h3 = r.seed[o + 2]!;
      let x = r.origin[o]!, y = r.origin[o + 1]!, z = r.origin[o + 2]!;
      // Exhaust pushes the puff back along the plume briefly.
      if (r.kind[i] === 1) {
        // Pad cloud: billows out sideways from the flame trench, then rises and drifts.
        const ang = h1 * Math.PI * 2, sp = 7 + h2 * 9;
        const out = sp * 2.4 * (1 - Math.exp(-age / 2.4));
        x += Math.cos(ang) * out; z += Math.sin(ang) * out * 0.8;
        y = pad.y + 0.8 + h3 * 2 + age * 0.35;
      } else {
        const ep = showPose(r.show.size, r.te[i]!);
        const back = Math.min(ep.speed * 0.35, 10) * (1 - Math.exp(-age / 0.6));
        const ed = tmp2.copy(UP).multiplyScalar(Math.cos(ep.pitch)).addScaledVector(HEADING, Math.sin(ep.pitch));
        x -= ed.x * back; y -= ed.y * back; z -= ed.z * back;
        x += (h1 - 0.5) * 1.5; z += (h2 - 0.5) * 1.5;
      }
      // Wind shear: higher smoke drifts faster, bending the column over the city.
      const shear = 1 + Math.max(0, y - pad.y) / 160;
      x += WIND.x * age * shear; y += WIND.y * age; z += WIND.z * age * shear;
      r.pos[o] = x; r.pos[o + 1] = Math.max(pad.y + 0.5, y); r.pos[o + 2] = z;
      const hiK = r.kind[i] === 1 ? 1.25 : 1 - 0.35 * Math.min(1, r.te[i]! / 40);
      r.size[i] = (d.smoke * hiK * (0.8 + h3 * 0.5) + age * (r.kind[i] === 1 ? 0.55 : 0.32)) * 2;
      const fadeIn = Math.min(1, age / 0.35);
      const fadeOut = Math.pow(Math.max(0, 1 - age / life), 1.3);
      r.alpha[i] = fadeIn * fadeOut * (r.kind[i] === 1 ? 0.55 : 0.5);
    }
    const g = r.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    const u = (r.points.material as THREE.ShaderMaterial).uniforms;
    u.uScale!.value = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const fog = scene.fog as THREE.Fog | null;
    if (fog) { (u.uFogColor!.value as THREE.Color).copy(fog.color); u.uFogNear!.value = fog.near; u.uFogFar!.value = fog.far * 1.15; }
    // Night smoke is lit by the plume but much darker overall.
    (u.uLit!.value as THREE.Color).setRGB(0.25 + 0.7 * day, 0.25 + 0.69 * day, 0.27 + 0.66 * day);
  }

  let last: LaunchShow[] = [];
  return {
    setShows(list) { last = list; },
    setEnabled(on) { enabled = on; },
    step(now, { day, camera, viewH }) {
      const want = enabled ? last.filter((s) => showActive(s, now)) : [];
      const ids = new Set(want.map((s) => s.id));
      for (const [id, r] of rigs) if (!ids.has(id)) { r.dispose(); rigs.delete(id); }
      for (const s of want) if (!rigs.has(s.id)) rigs.set(s.id, build(s));
      // The decorative pad rocket stands in for "the next one" and steps aside while a launch uses the pad.
      if (staticRocket) staticRocket.visible = !want.some((s) => now < s.at + (SHOW_FLIGHT_S + SHOW_LINGER_S) * 1000 && now >= s.at - SHOW_COUNTDOWN_MS);
      for (const r of rigs.values()) stepRig(r, now, day, camera, viewH);
    },
    dispose() {
      for (const r of rigs.values()) r.dispose(); rigs.clear();
      for (const x of shared) x.dispose();
      if (staticRocket) staticRocket.visible = true;
    },
  };
}
