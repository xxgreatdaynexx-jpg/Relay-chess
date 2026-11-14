/**
 * Canvas drawing for the Vehicle Assembly Building (side view) and Mission Control.
 */
import { PART_BY_ID, stackOrder, radialsOn, clusterCounts, type VesselDesign, type PlacedPart, type PartDef } from '../../../shared/spaceParts';
import {
  PLANET, orbitalElements, orbitPoints, altitudeOf, fmtAlt, type FlightState,
} from '../../../shared/spaceFlight';
import { drawSpaceGlobe, drawGroundTrack, ensurePlanetAssets, type FleetMarker } from './spacePlanet';
import { drawAscentHorizon } from './spaceHorizon';
import { paintPart, paintFairingShell, paintSatellite, drawPlume, drawSmokeTrail, drawPadBillow } from './spaceVehicleArt';
import { clamp, smooth } from '../../../shared/spaceTerrain';

export interface PartBox {
  uid: string;
  part: PlacedPart;
  def: PartDef;
  /** Centre-x, top-y in rocket-local metres (y up, nose positive). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radials: which side of the stack (-1 left, 1 right). */
  side?: number;
  /** Behind the stack in the side view (drawn first, dimmed). */
  back?: boolean;
}

/** Height a fairing adds to the stack itself (its base ring); the shell wraps the parts above. */
const FAIRING_BASE = 0.22;

/** Lay out a design in metres, origin at the tail (engine bells), y up. */
export function layoutRocket(design: VesselDesign): { boxes: PartBox[]; height: number; width: number } {
  const stack = stackOrder(design);
  const clusters = clusterCounts(design);
  const boxes: PartBox[] = [];
  let y = 0;
  let fairing: PartBox | null = null;
  let fairingTop = 0;
  // Place from tail (last in stack) upward.
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i]!;
    const def = PART_BY_ID.get(p.partId);
    if (!def) continue;
    const ph = def.category === 'fairing' ? FAIRING_BASE : def.height;
    const fullW = Math.max(def.width, def.widthBottom ?? 0);
    const n = clusters.get(p.uid) ?? 1;
    if (n > 1) {
      // Engines under a coupler: spread across its base; with four, two sit behind.
      const above = PART_BY_ID.get(stack[i - 1]?.partId ?? '');
      const W = Math.max(above?.widthBottom ?? above?.width ?? fullW, fullW);
      const front = n >= 4 ? 2 : n;
      const spread = (k: number, cnt: number, inset: number) => (cnt === 1 ? 0 : (-(W - fullW) / 2 + ((W - fullW) * k) / (cnt - 1)) * inset);
      if (n >= 4) for (let k = 0; k < n - front; k++) boxes.push({ uid: p.uid, part: p, def, x: spread(k, n - front, 0.45), y: y + 0.05, w: fullW, h: ph, back: true });
      for (let k = 0; k < front; k++) boxes.push({ uid: p.uid, part: p, def, x: spread(k, front, 1), y, w: fullW, h: ph });
    } else {
      const box: PartBox = { uid: p.uid, part: p, def, x: 0, y, w: fullW, h: ph };
      boxes.push(box);
      if (def.category === 'fairing' && !fairing) { fairing = box; fairingTop = y + ph; }
    }
    const parentW = fullW;
    for (const r of radialsOn(design, p.uid)) {
      const rd = PART_BY_ID.get(r.partId);
      if (!rd) continue;
      const a = (((r.angle ?? 0) % 360) + 360) % 360;
      const c = Math.cos((a * Math.PI) / 180);
      // Side view: 0° right, 180° left; 90° faces the camera, 270° hides behind the stack.
      const facing = Math.abs(c) < 0.35;
      if (facing && a > 180) continue;
      const sign = facing ? 1 : Math.sign(c);
      const off = parentW / 2 + rd.width / 2 + (rd.category === 'srb' || rd.category === 'engine' ? 0.12 : 0.02);
      const sx = facing ? 0 : sign * off;
      // Vertical placement: fins and legs at the tail, antennas and lights high, the rest centred.
      const low = rd.aero === 'fin' || rd.id === 'leg-lt3';
      const high = rd.id === 'ant-whip' || rd.id === 'dish-ra80' || rd.id === 'lamp-1' || rd.id === 'rcs-4';
      const ry = low ? y : high ? y + Math.max(0, ph - rd.height) : y + Math.max(0, (ph - rd.height) / 2);
      const rw = facing ? rd.width * (rd.aero === 'fin' ? 0.25 : 0.8) : rd.width;
      boxes.push({ uid: r.uid, part: r, def: rd, x: sx, y: ry, w: rw, h: rd.height, side: facing ? 0 : sign });
    }
    y += ph;
  }
  let height = y || 1;
  if (fairing) {
    // Shell: from the base ring over every stack part above it, then an ogive nose.
    let cw = 0;
    for (const b of boxes) if (b !== fairing && b.y >= fairingTop - 1e-6) cw = Math.max(cw, Math.abs(b.x) + b.w / 2);
    const W = Math.max(fairing.def.width, cw * 2 + 0.14);
    const top = y + 0.12 + W * 0.95;
    fairing.w = W;
    fairing.h = top - fairing.y;
    height = Math.max(height, top);
  }
  let width = 1.5;
  for (const b of boxes) width = Math.max(width, Math.abs(b.x) + b.w / 2);
  return { boxes, height, width: width * 2 };
}

/** Paint a laid-out stack: parts first, then any fairing shell over its payload. */
function paintStack(
  ctx: CanvasRenderingContext2D,
  boxes: PartBox[],
  toCanvas: (b: PartBox) => { px: number; py: number; pw: number; ph: number },
  opts: { selected?: string | null; shellAlpha: number },
) {
  // Back-row cluster engines first (dimmed), then the visible stack.
  for (const b of boxes) {
    if (!b.back) continue;
    const { px, py, pw, ph } = toCanvas(b);
    ctx.save(); ctx.globalAlpha = 0.8; ctx.filter = 'brightness(0.7)';
    paintPart(ctx, b.def, px, py, pw, ph, false);
    ctx.restore();
  }
  for (const b of boxes) {
    if (b.def.category === 'fairing' || b.back) continue;
    const { px, py, pw, ph } = toCanvas(b);
    paintPart(ctx, b.def, px, py, pw, ph, b.uid === opts.selected, b.side ?? 0);
  }
  for (const b of boxes) {
    if (b.def.category !== 'fairing') continue;
    const { px, py, pw, ph } = toCanvas(b);
    paintFairingShell(ctx, b.def, px, py, pw, ph, { alpha: opts.shellAlpha, selected: b.uid === opts.selected });
  }
}

export function drawVab(
  ctx: CanvasRenderingContext2D,
  design: VesselDesign,
  opts: { selected?: string | null; w: number; h: number },
): PartBox[] {
  const { w, h } = opts;
  ctx.clearRect(0, 0, w, h);
  // Assembly bay: lit high bay with gantry rails and a launch mount.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#16222f');
  bg.addColorStop(0.6, '#203042');
  bg.addColorStop(1, '#262a2a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const spot = ctx.createRadialGradient(w / 2, h * 0.15, 10, w / 2, h * 0.4, Math.max(w, h) * 0.7);
  spot.addColorStop(0, 'rgba(190,215,240,0.16)');
  spot.addColorStop(1, 'rgba(190,215,240,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(170,195,220,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0.5; x < w; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 28); ctx.stroke(); }
  for (let y = 0.5; y < h - 28; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Gantry rails at the sides.
  for (const gx of [16, w - 26]) {
    ctx.fillStyle = 'rgba(120,140,160,0.18)';
    ctx.fillRect(gx, 0, 10, h - 28);
    ctx.strokeStyle = 'rgba(150,170,190,0.18)';
    for (let y = 0; y < h - 28; y += 18) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + 10, y + 18); ctx.stroke(); }
  }
  // Floor with hazard edge.
  const fl = ctx.createLinearGradient(0, h - 28, 0, h);
  fl.addColorStop(0, '#41463f'); fl.addColorStop(1, '#2c302b');
  ctx.fillStyle = fl;
  ctx.fillRect(0, h - 28, w, 28);
  ctx.fillStyle = 'rgba(230,180,40,0.55)';
  for (let x = -10; x < w; x += 22) { ctx.beginPath(); ctx.moveTo(x, h - 28); ctx.lineTo(x + 11, h - 28); ctx.lineTo(x + 5, h - 24); ctx.lineTo(x - 6, h - 24); ctx.closePath(); ctx.fill(); }

  const { boxes, height, width } = layoutRocket(design);
  if (!boxes.length) {
    ctx.fillStyle = '#b4c6d6';
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add parts from the catalog to start a stack.', w / 2, h / 2);
    return [];
  }
  const margin = Math.min(40, w * 0.08);
  const scale = Math.min((w - margin * 2) / Math.max(width, 2.2), (h - 50 - 20) / Math.max(height, 2));
  const cx = w / 2;
  const floor = h - 32;
  // Launch mount under the stack.
  ctx.fillStyle = '#5b5f63';
  const mw = Math.max(40, Math.min(w * 0.5, (width * 0.6 + 0.6) * scale));
  ctx.fillRect(cx - mw / 2, floor, mw, 4);
  ctx.fillStyle = '#3c4044';
  ctx.fillRect(cx - mw / 2 + 4, floor + 4, mw - 8, 0);
  const toCanvas = (b: PartBox) => {
    const pw = b.w * scale, ph = b.h * scale;
    const px = cx + b.x * scale - pw / 2;
    const py = floor - (b.y + b.h) * scale;
    return { px, py, pw, ph };
  };
  paintStack(ctx, boxes, toCanvas, { selected: opts.selected, shellAlpha: 0.3 });
  return boxes.map((b) => {
    const { px, py, pw, ph } = toCanvas(b);
    return { ...b, x: px, y: py, w: pw, h: ph };
  });
}

export function hitVab(boxes: PartBox[], mx: number, my: number): PartBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b;
  }
  return null;
}

export type McCamera = 'auto' | 'horizon' | 'globe' | 'track';
export type { FleetMarker };

function liveDesign(s: FlightState, filter: (p: FlightState['parts'][number]) => boolean): VesselDesign {
  return {
    name: s.designName,
    parts: s.parts.filter(filter).map((p) => ({
      uid: p.uid, partId: p.partId, stage: p.stage, radial: p.radial, angle: p.angle,
      attachTo: (p as unknown as { attachTo?: string }).attachTo,
    })),
  };
}

// ── Staging debris (purely cosmetic, per flight) ──
interface Debris { boxes: PartBox[]; dy: number; side: number; born: number; spin: number; half?: -1 | 1 }
const debris: { flight: string; attached: Set<string>; last: VesselDesign | null; list: Debris[]; loop: number; age0: number } = { flight: '', attached: new Set(), last: null, list: [], loop: 0, age0: 0 };

function trackDebris(s: FlightState, now: number) {
  const flight = `${s.designName}|${s.met0}`;
  const att = new Set(s.parts.filter((p) => p.attached).map((p) => p.uid));
  if (debris.flight !== flight) {
    debris.flight = flight; debris.attached = att; debris.last = liveDesign(s, (p) => p.attached); debris.list = []; debris.loop = 0; debris.age0 = 0;
    return;
  }
  const dropped = [...debris.attached].filter((u) => !att.has(u));
  if (dropped.length && debris.last) {
    now -= debris.age0;
    debris.age0 = 0;
    const old = layoutRocket(debris.last);
    const keep = old.boxes.filter((b) => att.has(b.uid));
    const base = keep.length ? Math.min(...keep.map((b) => b.y)) : 0;
    const gone = old.boxes.filter((b) => dropped.includes(b.uid)).map((b) => ({ ...b, y: b.y - base }));
    const fair = gone.filter((b) => b.def.category === 'fairing');
    const radial = gone.filter((b) => b.part.radial);
    const stack = gone.filter((b) => !b.part.radial && b.def.category !== 'fairing');
    if (stack.length) debris.list.push({ boxes: stack, dy: 0, side: 0, born: now, spin: (Math.random() - 0.5) * 0.5 });
    for (const sgn of [-1, 1]) {
      const r = radial.filter((b) => Math.sign(b.x) === sgn);
      if (r.length) debris.list.push({ boxes: r, dy: 0, side: sgn, born: now, spin: sgn * 0.6 });
    }
    for (const f of fair) for (const half of [-1, 1] as const) debris.list.push({ boxes: [f], dy: 0, side: half * 1.4, born: now, spin: half * 0.9, half });
  }
  debris.attached = att;
  debris.last = liveDesign(s, (p) => p.attached);
  if (!debris.loop) debris.list = debris.list.filter((d) => now - d.born < 6);
}

/** Preview helper: remember a pre-separation vehicle so the next frame shows the drop. */
export function primeDebris(s: FlightState, frozenAge = 1.6, age0 = 1.4) {
  debris.loop = frozenAge;
  debris.age0 = age0;
  debris.flight = `${s.designName}|${s.met0}`;
  debris.attached = new Set(s.parts.filter((p) => p.attached).map((p) => p.uid));
  debris.last = liveDesign(s, (p) => p.attached);
  debris.list = [];
}

function drawDebris(ctx: CanvasRenderingContext2D, scale: number, now: number) {
  for (const d of debris.list) {
    // Preview (primed) debris is frozen at a fixed moment so stills are deterministic.
    const age = debris.loop ? debris.loop : Math.max(0, now - d.born);
    const fade = 1 - smooth(3, 6, age);
    if (fade <= 0) continue;
    // Falls aft as the vehicle accelerates away; boosters and fairing halves peel outward.
    const aft = (0.5 * 9 * age * age + 1.5 * age) * scale;
    const out = d.side * (1.2 * age + 0.4 * age * age) * scale;
    ctx.save();
    ctx.globalAlpha = fade;
    for (const b of d.boxes) {
      const pw = b.w * scale, ph = b.h * scale;
      const px = b.x * scale - pw / 2, py = -(b.y + b.h) * scale;
      const pivotX = px + pw / 2 + out, pivotY = py + ph / 2 + aft;
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate(d.spin * age);
      if (b.def.category === 'fairing') paintFairingShell(ctx, b.def, -pw / 2, -ph / 2, pw, ph, { half: d.half });
      else paintPart(ctx, b.def, -pw / 2, -ph / 2, pw, ph, false);
      ctx.restore();
    }
    // Separation puff.
    if (age < 0.9) {
      const top = Math.min(...d.boxes.map((b) => -(b.y + b.h) * scale));
      const r = (8 + age * 50) * Math.max(0.5, scale / 10);
      const g = ctx.createRadialGradient(out, top + aft * 0.2, 0, out, top + aft * 0.2, r);
      g.addColorStop(0, `rgba(255,255,255,${0.6 * (1 - age / 0.9)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(out - r, top + aft * 0.2 - r, r * 2, r * 2);
    }
    ctx.restore();
  }
}

function drawVehicleOnHorizon(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  baseX: number,
  baseY: number,
  opts: { tFlame: number; h: number; now: number },
) {
  const { boxes, height: rh } = layoutRocket(liveDesign(s, (p) => p.attached));
  const alt = Math.max(0, altitudeOf(s));
  const scale = Math.min(opts.h * 0.024, (opts.h * 0.34) / Math.max(rh, 4));
  const pAmb = Math.exp(-alt / 7_000);
  const flame = opts.tFlame * s.throttle;
  ctx.save();
  ctx.translate(baseX, baseY);
  // Ground cloud from the trench at lift-off (screen frame).
  if (alt < 600 && flame > 0) drawPadBillow(ctx, 0, scale * 0.6 + alt * 0.08 * scale, scale * 9, (1 - smooth(80, 600, alt)) * Math.min(1, flame));
  ctx.rotate((s.pitch * Math.PI) / 180);
  const burning = boxes.filter((b) => {
    const live = s.parts.find((p) => p.uid === b.uid);
    return live?.ignited && (b.def.category === 'engine' || b.def.category === 'srb');
  });
  const smoke = (1 - smooth(9_000, 26_000, alt)) * Math.min(1, flame * 1.2);
  for (const b of burning) {
    const pw = b.w * scale;
    const exitX = b.x * scale, exitY = -b.y * scale;
    const solid = b.def.category === 'srb';
    if (b.def.style === 'ion') continue;
    drawSmokeTrail(ctx, exitX, exitY, pw * (solid ? 0.72 : 0.88), opts.h * 1.3, smoke * (solid ? 1 : 0.55), opts.now, solid);
  }
  drawDebris(ctx, scale, opts.now);
  for (const b of burning) {
    const pw = b.w * scale;
    const solid = b.def.category === 'srb';
    // Multi-nozzle engines get one plume per visible bell.
    const nz = b.def.nozzles ?? 1;
    const xs = nz >= 4 ? [-0.27, 0.27] : nz > 1 ? Array.from({ length: nz }, (_, k) => -0.25 + (0.5 * k) / (nz - 1)) : [0];
    const ew = pw * (solid ? 0.72 : nz > 1 ? (nz >= 4 ? 0.38 : 0.44) : (b.def.ispVac ?? 0) >= 340 ? 1 : 0.88);
    for (const f of xs) drawPlume(ctx, b.x * scale + f * pw, -b.y * scale, ew, { throttle: flame, p: pAmb, t: opts.now, solid, ion: b.def.style === 'ion' });
  }
  paintStack(ctx, boxes, (b) => {
    const pw = b.w * scale, ph = b.h * scale;
    return { px: b.x * scale - pw / 2, py: -(b.y + b.h) * scale, pw, ph };
  }, { shellAlpha: 1 });
  ctx.restore();
}

/** Seconds since the most recent payload release, from the flight log (sim time). */
function deployAge(s: FlightState): number | null {
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i]!;
    if (/deployed/i.test(e.text) && !/withheld/i.test(e.text)) return Math.max(0, s.t - e.t);
  }
  return null;
}
const deployWall: { key: string; at: number } = { key: '', at: 0 };

/** Close-up of the payload separating from the upper stage, panels unfolding. */
function drawDeployInset(ctx: CanvasRenderingContext2D, s: FlightState, w: number, h: number, now: number) {
  const simAge = deployAge(s);
  if (simAge === null) return;
  const key = `${s.designName}|${s.met0}|${s.deployedCount}`;
  if (deployWall.key !== key) { deployWall.key = key; deployWall.at = now - Math.min(simAge, 60); }
  const age = Math.min(simAge, now - deployWall.at);
  const vis = 1 - smooth(26, 34, age);
  if (vis <= 0) return;
  const sat = s.parts.filter((p) => p.attached && p.def.category === 'payload')[Math.max(0, (s.deployedCount ?? 1) - 1)];
  const iw = Math.round(clamp(w * 0.34, 170, 300)), ih = Math.round(iw * 0.62);
  const x0 = w - iw - 12, y0 = h - ih - 30;
  ctx.save();
  ctx.globalAlpha = vis * smooth(0, 0.6, age);
  ctx.beginPath();
  ctx.roundRect?.(x0, y0, iw, ih, 8);
  if (!ctx.roundRect) ctx.rect(x0, y0, iw, ih);
  ctx.fillStyle = '#05070d';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Earth limb below, a few stars.
  const lg = ctx.createRadialGradient(x0 + iw * 0.5, y0 + ih * 2.6, ih * 2.0, x0 + iw * 0.5, y0 + ih * 2.6, ih * 2.25);
  lg.addColorStop(0, '#1d4f86'); lg.addColorStop(0.92, '#4f9ad8'); lg.addColorStop(0.97, 'rgba(150,200,255,0.6)'); lg.addColorStop(1, 'rgba(150,200,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(x0, y0, iw, ih);
  ctx.fillStyle = 'rgba(230,236,255,0.7)';
  for (let k = 0; k < 18; k++) { const a = Math.sin(k * 91.7) * 0.5 + 0.5, b = Math.sin(k * 37.3) * 0.5 + 0.5; ctx.fillRect(x0 + a * iw, y0 + b * ih * 0.5, 1, 1); }
  // Upper stage on the left, satellite drifting right and up.
  const sc = ih / 6.5;
  const stage = layoutRocket(liveDesign(s, (p) => p.attached && p.def.category !== 'payload'));
  ctx.save();
  ctx.translate(x0 + iw * 0.2, y0 + ih * 0.66);
  ctx.rotate(Math.PI / 2 - 0.25);
  const top = stage.boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  ctx.translate(0, top * sc * 0.5);
  paintStack(ctx, stage.boxes.filter((b) => b.y + b.h > top - 3.2), (b) => {
    const pw = b.w * sc, ph = b.h * sc;
    return { px: b.x * sc - pw / 2, py: -(b.y + b.h) * sc, pw, ph };
  }, { shellAlpha: 1 });
  ctx.restore();
  if (sat) {
    const drift = Math.min(age, 30) * 0.06;
    const unfold = smooth(1.2, 7, age);
    const sw = ih * 0.36, sh = sw * (sat.def.height / sat.def.width);
    const sx = x0 + iw * (0.56 + drift * 0.4), sy = y0 + ih * (0.42 - drift * 0.15);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-0.15 + age * 0.01);
    paintSatellite(ctx, sat.def, -sw / 2, -sh / 2, sw, sh, unfold);
    ctx.restore();
    // Spring push-off flash.
    if (age < 1) { ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - age)})`; ctx.beginPath(); ctx.arc(x0 + iw * 0.47, y0 + ih * 0.5, 10 + age * 20, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(140,190,240,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,225,255,0.9)';
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('PAYLOAD SEPARATION', x0 + 10, y0 + 16);
  ctx.restore();
}

let fadeCanvas: HTMLCanvasElement | null = null;

/** Draw the Mission Control centre visual. */
export function drawMission(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; tFlame?: number; camera?: McCamera; wallT?: number; fleet?: FleetMarker[] },
) {
  const { w, h } = opts;
  ctx.clearRect(0, 0, w, h);
  const alt = altitudeOf(s);
  const camera = opts.camera ?? 'auto';
  const now = opts.wallT ?? (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  const PULL0 = 50_000, PULL1 = 68_000;
  const orbitPhase = s.phase === 'orbit' || s.phase === 'deployed' || s.phase === 'circularize';
  const spaceView = camera === 'globe' || (
    camera !== 'horizon' && camera !== 'track' && (alt > PULL1 || orbitPhase)
  );
  // Auto camera pulls back from the chase view to the globe view between 50 and 68 km.
  const pull = camera === 'auto' && !spaceView ? smooth(PULL0, PULL1, alt) : 0;
  try { ensurePlanetAssets(); } catch { /* node / missing canvas */ }
  trackDebris(s, now);

  if (camera === 'track') {
    drawGroundTrack(ctx, s, { w, h, trail: opts.trail, wallT: opts.wallT, fleet: opts.fleet });
  } else if (spaceView) {
    drawSpaceGlobe(ctx, s, { w, h, trail: opts.trail, wallT: opts.wallT, fleet: opts.fleet });
    drawDeployInset(ctx, s, w, h, now);
  } else {
    drawAscentHorizon(ctx, s, {
      w, h, tFlame: opts.tFlame, wallT: opts.wallT, pull,
      drawRocket: (c, bx, by) => drawVehicleOnHorizon(c, s, bx, by, { tFlame: opts.tFlame ?? 1, h, now }),
    });
    // Last stretch: hand off to the globe renderer (orbit lines, markers) with a short cross-fade.
    const hand = smooth(0.9, 1, pull);
    if (hand > 0 && typeof document !== 'undefined') {
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      if (!fadeCanvas) fadeCanvas = document.createElement('canvas');
      if (fadeCanvas.width !== cw || fadeCanvas.height !== ch) { fadeCanvas.width = cw; fadeCanvas.height = ch; }
      const fc = fadeCanvas.getContext('2d');
      if (fc) {
        fc.setTransform(ctx.getTransform());
        fc.clearRect(0, 0, w, h);
        drawSpaceGlobe(fc, s, { w, h, trail: opts.trail, wallT: opts.wallT, fleet: opts.fleet });
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = hand;
        ctx.drawImage(fadeCanvas, 0, 0);
        ctx.restore();
      }
    }
  }

  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

/** Side-console map: same surface texture, ground track on the equator. */
export function drawOrbitMap(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; wallT?: number; fleet?: FleetMarker[] },
) {
  drawGroundTrack(ctx, s, { w: opts.w, h: opts.h, trail: opts.trail, wallT: opts.wallT, fleet: opts.fleet });
}
