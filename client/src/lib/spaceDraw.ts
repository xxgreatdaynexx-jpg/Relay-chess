/**
 * Canvas drawing for the Vehicle Assembly Building (side view) and Mission Control.
 */
import { PART_BY_ID, stackOrder, radialsOn, type VesselDesign, type PlacedPart, type PartDef } from '../../../shared/spaceParts';
import {
  PLANET, orbitalElements, orbitPoints, altitudeOf, fmtAlt, type FlightState,
} from '../../../shared/spaceFlight';

export interface PartBox {
  uid: string;
  part: PlacedPart;
  def: PartDef;
  /** Centre-x, top-y in rocket-local metres (y up, nose positive). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lay out a design in metres, origin at the tail (engine bells), y up. */
export function layoutRocket(design: VesselDesign): { boxes: PartBox[]; height: number; width: number } {
  const stack = stackOrder(design);
  const boxes: PartBox[] = [];
  let y = 0;
  // First pass: measure total stack height (tail to nose), we'll place from tail up.
  const heights = stack.map((p) => PART_BY_ID.get(p.partId)?.height ?? 0.4);
  const total = heights.reduce((a, b) => a + b, 0) || 1;
  // Place from tail (last in stack) upward.
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i]!;
    const def = PART_BY_ID.get(p.partId);
    if (!def) continue;
    boxes.push({ uid: p.uid, part: p, def, x: 0, y, w: def.width, h: def.height });
    for (const r of radialsOn(design, p.uid)) {
      const rd = PART_BY_ID.get(r.partId);
      if (!rd) continue;
      const side = (r.angle ?? 0) % 360;
      const sign = side >= 90 && side < 270 ? -1 : 1;
      // For 2-way (0 and 180) both sides; for a single, use angle.
      const sx = sign * (def.width / 2 + rd.width / 2 + 0.12);
      boxes.push({ uid: r.uid, part: r, def: rd, x: sx, y: y + Math.max(0, (def.height - rd.height) / 2), w: rd.width, h: rd.height });
    }
    // Also un-parented radials? already handled via attachTo in makeDesign.
    y += def.height;
  }
  let width = 1.5;
  for (const b of boxes) width = Math.max(width, Math.abs(b.x) + b.w / 2);
  return { boxes, height: total, width: width * 2 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function paintPart(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, selected: boolean, flame = 0) {
  const accent = def.accent ?? '#888';
  ctx.save();
  if (def.category === 'engine' || def.category === 'srb') {
    // Bell
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y);
    ctx.lineTo(x + w * 0.72, y);
    ctx.lineTo(x + w * 0.96, y + h);
    ctx.lineTo(x + w * 0.04, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2228';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(x + w * 0.3, y, w * 0.4, h * 0.22);
    if (flame > 0) {
      ctx.globalAlpha = 0.85;
      const fh = h * (1.2 + flame * 1.4);
      const grd = ctx.createLinearGradient(x, y + h, x, y + h + fh);
      grd.addColorStop(0, '#fff4c8');
      grd.addColorStop(0.35, '#ff9020');
      grd.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + h);
      ctx.lineTo(x + w * 0.8, y + h);
      ctx.lineTo(x + w * 0.55, y + h + fh);
      ctx.lineTo(x + w * 0.45, y + h + fh * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else if (def.category === 'tank') {
    ctx.fillStyle = def.color;
    roundRect(ctx, x, y, w, h, Math.min(6, w * 0.15));
    ctx.fill();
    ctx.fillStyle = accent;
    const band = Math.max(3, h * 0.08);
    ctx.fillRect(x, y + h * 0.15, w, band);
    ctx.fillRect(x, y + h * 0.72, w, band);
    ctx.strokeStyle = '#0003';
    ctx.stroke();
  } else if (def.category === 'fairing' || def.category === 'pod') {
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h * 0.45);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x + w * 0.15, y + h * 0.55, w * 0.7, h * 0.18);
    ctx.strokeStyle = '#0004';
    ctx.stroke();
  } else if (def.category === 'payload') {
    ctx.fillStyle = def.color;
    ctx.fillRect(x + w * 0.15, y + h * 0.2, w * 0.7, h * 0.6);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + w * 0.15, y + h * 0.5, w * 0.22, 0, Math.PI * 2);
    ctx.arc(x + w * 0.85, y + h * 0.5, w * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  } else if (def.category === 'decoupler') {
    ctx.fillStyle = def.color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + h * 0.35, w, h * 0.3);
  } else if (def.category === 'probe') {
    ctx.fillStyle = def.color;
    ctx.fillRect(x + w * 0.15, y, w * 0.7, h);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = def.color;
    ctx.fillRect(x, y, w, h);
  }
  if (selected) {
    ctx.strokeStyle = '#7ad0ff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function drawVab(
  ctx: CanvasRenderingContext2D,
  design: VesselDesign,
  opts: { selected?: string | null; w: number; h: number; flame?: number } ,
): PartBox[] {
  const { w, h } = opts;
  ctx.clearRect(0, 0, w, h);
  // Hangar bay
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#1a2a3c');
  bg.addColorStop(0.55, '#243548');
  bg.addColorStop(1, '#2a2e28');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Bay doors / grid
  ctx.strokeStyle = 'rgba(180,200,220,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Floor
  ctx.fillStyle = '#3a3e38';
  ctx.fillRect(0, h - 28, w, 28);
  ctx.fillStyle = '#4a4e46';
  for (let x = 0; x < w; x += 22) ctx.fillRect(x, h - 28, 11, 28);

  const { boxes, height, width } = layoutRocket(design);
  if (!boxes.length) {
    ctx.fillStyle = '#9ab0c4';
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add parts from the catalog to start a stack.', w / 2, h / 2);
    return [];
  }
  const margin = 40;
  const scale = Math.min((w - margin * 2) / Math.max(width, 2.2), (h - 50 - 20) / Math.max(height, 2));
  const cx = w / 2;
  const floor = h - 32;
  // Convert rocket-local (y up from tail) to canvas (y down from top of part).
  const toCanvas = (b: PartBox) => {
    const pw = b.w * scale, ph = b.h * scale;
    const px = cx + b.x * scale - pw / 2;
    const py = floor - (b.y + b.h) * scale;
    return { px, py, pw, ph };
  };
  for (const b of boxes) {
    const { px, py, pw, ph } = toCanvas(b);
    const flaming = opts.flame && (b.def.category === 'engine' || b.def.category === 'srb') ? opts.flame : 0;
    paintPart(ctx, b.def, px, py, pw, ph, b.uid === opts.selected, flaming);
  }
  return boxes.map((b) => {
    const { px, py, pw, ph } = toCanvas(b);
    // Return boxes in canvas pixels for hit-testing (x,y = top-left, w,h in px) — stash in a side channel.
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

function starfield(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 1) {
  let s = seed + 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 180; i++) {
    const x = rnd() * w, y = rnd() * h, a = 0.25 + rnd() * 0.75, r = rnd() * 1.3;
    ctx.fillStyle = `rgba(230,240,255,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

export interface McCamera { kind: 'pad' | 'ascent' | 'space' }

/** Draw the Mission Control centre visual. */
export function drawMission(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; tFlame?: number },
) {
  const { w, h } = opts;
  ctx.clearRect(0, 0, w, h);
  const alt = altitudeOf(s);
  const el = orbitalElements(s.x, s.y, s.vx, s.vy);

  // Space background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  if (alt < 20_000) {
    const t = Math.max(0, Math.min(1, alt / 20_000));
    bg.addColorStop(0, lerpC('#7ec0f0', '#050814', t));
    bg.addColorStop(1, lerpC('#c8e4f8', '#0a1020', t));
  } else {
    bg.addColorStop(0, '#050814');
    bg.addColorStop(1, '#0a1020');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (alt > 8_000) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (alt - 8_000) / 25_000);
    starfield(ctx, w, h, 7);
    ctx.restore();
  }

  const spaceView = alt > 45_000 || s.phase === 'orbit' || s.phase === 'deployed' || s.phase === 'coast' || s.phase === 'circularize';

  if (spaceView) {
    // Planet in the middle, orbit around it. Scale so 200 km alt fits.
    const maxR = PLANET.radius + Math.max(200_000, el.apAltitude === Infinity ? 200_000 : Math.min(el.apAltitude + 40_000, 800_000));
    const scale = Math.min(w, h) * 0.42 / maxR;
    const cx = w * 0.5, cy = h * 0.52;
    // Atmosphere glow
    const ag = ctx.createRadialGradient(cx, cy, PLANET.radius * scale, cx, cy, (PLANET.radius + PLANET.atmHeight) * scale * 1.04);
    ag.addColorStop(0, 'rgba(80,160,255,0)');
    ag.addColorStop(0.7, 'rgba(70,150,255,0.28)');
    ag.addColorStop(1, 'rgba(70,150,255,0)');
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(cx, cy, (PLANET.radius + PLANET.atmHeight) * scale * 1.08, 0, Math.PI * 2);
    ctx.fill();
    // Planet body
    const pg = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, PLANET.radius * scale);
    pg.addColorStop(0, '#3a8a5a');
    pg.addColorStop(0.55, '#1e5a3a');
    pg.addColorStop(1, '#0a2018');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(cx, cy, PLANET.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    // Simple continents
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(s.y, s.x) * 0.15);
    ctx.fillStyle = 'rgba(40,90,50,0.7)';
    continent(ctx, PLANET.radius * scale);
    ctx.restore();
    // Terminator shade
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.arc(cx + PLANET.radius * scale * 0.15, cy, PLANET.radius * scale, -Math.PI * 0.4, Math.PI * 0.6);
    ctx.fill();

    // Predicted orbit
    if (el.bound && el.apAltitude > 0) {
      const pts = orbitPoints(el, s.x, s.y, 128);
      ctx.strokeStyle = 'rgba(80, 220, 160, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        const X = cx + px * scale, Y = cy - py * scale;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Trail
    if (opts.trail && opts.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      opts.trail.forEach(([px, py], i) => {
        const X = cx + px * scale, Y = cy - py * scale;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.stroke();
    }
    // Vehicle
    const vx = cx + s.x * scale, vy = cy - s.y * scale;
    ctx.fillStyle = s.deployed ? '#f0d060' : '#f4f6fa';
    ctx.beginPath();
    ctx.arc(vx, vy, s.deployed ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (!s.deployed && s.throttle > 0.05) {
      const r = Math.hypot(s.x, s.y) || 1;
      const pr = s.pitch * Math.PI / 180;
      const rx = s.x / r, ry = s.y / r, tx = -ry, ty = rx;
      const tdx = Math.cos(pr) * rx + Math.sin(pr) * tx;
      const tdy = Math.cos(pr) * ry + Math.sin(pr) * ty;
      // Flame opposite thrust
      ctx.strokeStyle = '#ff9020';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx - tdx * 12, vy + tdy * 12);
      ctx.stroke();
    }
    // Atmo cutoff ring
    ctx.strokeStyle = 'rgba(120,180,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, (PLANET.radius + PLANET.atmHeight) * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Caption
    ctx.fillStyle = '#9fd';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`ApA ${fmtAlt(el.apAltitude)}   PeA ${fmtAlt(el.peAltitude)}`, 10, h - 12);
  } else {
    // Pad / ascent view: horizon, rocket upright-ish in the middle.
    const horizon = h * (0.72 + Math.min(0.2, alt / 80_000));
    // Ground / curved earth
    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, alt < 3000 ? '#2d6a3a' : '#1a3a28');
    ground.addColorStop(1, '#0c1c14');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.quadraticCurveTo(w / 2, horizon - Math.min(80, alt / 400), w, horizon);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    if (alt < 800) {
      // Pad
      ctx.fillStyle = '#4a4e56';
      ctx.fillRect(w / 2 - 50, horizon - 6, 100, 8);
      ctx.fillStyle = '#888';
      ctx.fillRect(w / 2 + 36, horizon - 90, 6, 90);
    }
    // Atmosphere haze
    const haze = ctx.createLinearGradient(0, 0, 0, horizon);
    haze.addColorStop(0, 'rgba(180,210,255,0)');
    haze.addColorStop(1, `rgba(160,200,255,${Math.max(0, 0.25 - alt / 40_000)})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, horizon);

    // Rocket in the centre, tall, with flame. Pitch tilts it.
    const { boxes, height: rh } = layoutRocket({ name: s.designName, parts: s.parts.filter((p) => p.attached).map((p) => ({ uid: p.uid, partId: p.partId, stage: p.stage, radial: p.radial, angle: p.angle })) });
    const scale = Math.min(18, (h * 0.45) / Math.max(rh, 4));
    const cx = w / 2;
    const base = horizon - 8 - Math.min(alt / 80, 40);
    ctx.save();
    ctx.translate(cx, base);
    ctx.rotate((s.pitch * Math.PI) / 180);
    const flame = (opts.tFlame ?? 1) * s.throttle;
    for (const b of boxes) {
      const pw = b.w * scale, ph = b.h * scale;
      const px = b.x * scale - pw / 2;
      const py = -(b.y + b.h) * scale;
      const live = s.parts.find((p) => p.uid === b.uid);
      const fl = live && live.ignited && (b.def.category === 'engine' || b.def.category === 'srb') ? flame : 0;
      paintPart(ctx, b.def, px, py, pw, ph, false, fl);
    }
    ctx.restore();
    ctx.fillStyle = '#cde';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtAlt(alt), 10, 18);
  }

  // Bezel / scan vignette
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function continent(ctx: CanvasRenderingContext2D, R: number) {
  ctx.beginPath();
  ctx.ellipse(-R * 0.2, -R * 0.1, R * 0.45, R * 0.25, 0.3, 0, Math.PI * 2);
  ctx.ellipse(R * 0.3, R * 0.2, R * 0.3, R * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function lerpC(a: string, b: string, t: number): string {
  const P = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const A = P(a), B = P(b);
  const m = (i: number) => Math.round(A[i]! + (B[i]! - A[i]!) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

/** Small top-down orbit map for the side console. */
export function drawOrbitMap(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]> },
) {
  const { w, h } = opts;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#071016';
  ctx.fillRect(0, 0, w, h);
  starfield(ctx, w, h, 3);
  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  const maxR = PLANET.radius + Math.max(150_000, el.bound ? Math.min(el.apAltitude + 30_000, 600_000) : 200_000);
  const scale = Math.min(w, h) * 0.42 / maxR;
  const cx = w / 2, cy = h / 2;
  ctx.strokeStyle = 'rgba(80,160,255,0.3)';
  ctx.beginPath(); ctx.arc(cx, cy, (PLANET.radius + PLANET.atmHeight) * scale, 0, Math.PI * 2); ctx.stroke();
  const pg = ctx.createRadialGradient(cx - 6, cy - 6, 4, cx, cy, PLANET.radius * scale);
  pg.addColorStop(0, '#3a8a5a');
  pg.addColorStop(1, '#0c2014');
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.arc(cx, cy, PLANET.radius * scale, 0, Math.PI * 2); ctx.fill();
  if (el.bound) {
    const pts = orbitPoints(el, s.x, s.y, 96);
    ctx.strokeStyle = '#4ed9a5';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    pts.forEach(([px, py], i) => { const X = cx + px * scale, Y = cy - py * scale; if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.trail && opts.trail.length) {
    ctx.strokeStyle = '#f0c050';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    opts.trail.forEach(([px, py], i) => { const X = cx + px * scale, Y = cy - py * scale; if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
    ctx.stroke();
  }
  ctx.fillStyle = s.deployed ? '#f0d060' : '#fff';
  ctx.beginPath();
  ctx.arc(cx + s.x * scale, cy - s.y * scale, 3.5, 0, Math.PI * 2);
  ctx.fill();
}
