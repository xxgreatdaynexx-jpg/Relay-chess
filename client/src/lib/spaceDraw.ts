/**
 * Canvas drawing for the Vehicle Assembly Building (side view) and Mission Control.
 */
import { PART_BY_ID, stackOrder, radialsOn, type VesselDesign, type PlacedPart, type PartDef } from '../../../shared/spaceParts';
import {
  PLANET, orbitalElements, orbitPoints, altitudeOf, fmtAlt, type FlightState,
} from '../../../shared/spaceFlight';
import { drawSpaceGlobe, drawAscentHorizon, drawGroundTrack, ensurePlanetAssets } from './spacePlanet';

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

export type McCamera = 'auto' | 'horizon' | 'globe' | 'track';

function drawVehicleOnHorizon(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  baseX: number,
  baseY: number,
  tFlame: number,
) {
  const { boxes, height: rh } = layoutRocket({
    name: s.designName,
    parts: s.parts.filter((p) => p.attached).map((p) => ({
      uid: p.uid, partId: p.partId, stage: p.stage, radial: p.radial, angle: p.angle,
    })),
  });
  const scale = Math.min(18, 90 / Math.max(rh, 4));
  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.rotate((s.pitch * Math.PI) / 180);
  const flame = tFlame * s.throttle;
  for (const b of boxes) {
    const pw = b.w * scale, ph = b.h * scale;
    const px = b.x * scale - pw / 2;
    const py = -(b.y + b.h) * scale;
    const live = s.parts.find((p) => p.uid === b.uid);
    const fl = live && live.ignited && (b.def.category === 'engine' || b.def.category === 'srb') ? flame : 0;
    paintPart(ctx, b.def, px, py, pw, ph, false, fl);
  }
  ctx.restore();
}

/** Draw the Mission Control centre visual. */
export function drawMission(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; tFlame?: number; camera?: McCamera; wallT?: number },
) {
  const { w, h } = opts;
  ctx.clearRect(0, 0, w, h);
  const alt = altitudeOf(s);
  const camera = opts.camera ?? 'auto';
  const highCoast = s.phase === 'coast' && alt > 60_000;
  const spaceView = camera === 'globe' || (
    camera !== 'horizon' && camera !== 'track' && (
      alt > 65_000
      || s.phase === 'orbit'
      || s.phase === 'deployed'
      || s.phase === 'circularize'
      || highCoast
    )
  );
  try { ensurePlanetAssets(); } catch { /* node / missing canvas */ }

  if (camera === 'track') {
    drawGroundTrack(ctx, s, { w, h, trail: opts.trail, wallT: opts.wallT });
  } else if (spaceView) {
    drawSpaceGlobe(ctx, s, { w, h, trail: opts.trail, wallT: opts.wallT });
  } else {
    drawAscentHorizon(ctx, s, {
      w, h, tFlame: opts.tFlame, wallT: opts.wallT,
      drawRocket: (c, bx, by) => drawVehicleOnHorizon(c, s, bx, by, opts.tFlame ?? 1),
    });
  }

  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

/** Side-console map: same surface texture, ground track on the equator. */
export function drawOrbitMap(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; wallT?: number },
) {
  drawGroundTrack(ctx, s, { w: opts.w, h: opts.h, trail: opts.trail, wallT: opts.wallT });
}
