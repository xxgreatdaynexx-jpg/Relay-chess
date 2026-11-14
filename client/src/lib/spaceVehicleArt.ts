/**
 * Vehicle artwork shared by the VAB and Mission Control: shaded parts, engine
 * bells, the payload fairing shell, exhaust plume, smoke, staging debris and
 * the payload separation close-up. Visual only.
 */
import type { PartDef } from '../../../shared/spaceParts';

type RGB = [number, number, number];
const cache = new Map<string, RGB>();
export function hexRgb(c: string): RGB {
  const hit = cache.get(c);
  if (hit) return hit;
  let h = c.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('');
  const v: RGB = [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  cache.set(c, v);
  return v;
}
const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export function shade(c: string | RGB, k: number, a = 1): string {
  const [r, g, b] = typeof c === 'string' ? hexRgb(c) : c;
  const f = (v: number) => (k <= 1 ? v * k : v + (255 - v) * (k - 1));
  return a >= 1 ? `rgb(${cl(f(r))},${cl(f(g))},${cl(f(b))})` : `rgba(${cl(f(r))},${cl(f(g))},${cl(f(b))},${a})`;
}

/** Horizontal cylinder shading (light from the upper left). */
function cyl(ctx: CanvasRenderingContext2D, x: number, w: number, base: string, a = 1): CanvasGradient {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, shade(base, 0.52, a));
  g.addColorStop(0.16, shade(base, 0.92, a));
  g.addColorStop(0.32, shade(base, 1.22, a));
  g.addColorStop(0.5, shade(base, 1.0, a));
  g.addColorStop(0.82, shade(base, 0.7, a));
  g.addColorStop(1, shade(base, 0.45, a));
  return g;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const OUTLINE = 'rgba(10,14,20,0.55)';

function bell(ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number, topW: number, exitW: number, metal: string) {
  const h = bottom - top;
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, top);
  ctx.quadraticCurveTo(cx - topW / 2 - (exitW - topW) * 0.05, top + h * 0.7, cx - exitW / 2, bottom);
  ctx.lineTo(cx + exitW / 2, bottom);
  ctx.quadraticCurveTo(cx + topW / 2 + (exitW - topW) * 0.05, top + h * 0.7, cx + topW / 2, top);
  ctx.closePath();
  ctx.fillStyle = cyl(ctx, cx - exitW / 2, exitW, metal);
  ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  // Cooling-channel banding and a heat-tinted lip.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let k = 1; k < 5; k++) { const y = top + (h * k) / 5; ctx.beginPath(); ctx.moveTo(cx - exitW, y); ctx.lineTo(cx + exitW, y); ctx.stroke(); }
  const lip = ctx.createLinearGradient(0, bottom - h * 0.25, 0, bottom);
  lip.addColorStop(0, 'rgba(120,60,30,0)');
  lip.addColorStop(1, 'rgba(120,60,30,0.35)');
  ctx.fillStyle = lip;
  ctx.fillRect(cx - exitW, bottom - h * 0.25, exitW * 2, h * 0.25);
  ctx.restore();
  // Exit rim: inside of the bell.
  ctx.fillStyle = '#15181d';
  ctx.beginPath(); ctx.ellipse(cx, bottom, exitW / 2, Math.max(1, exitW * 0.08), 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = shade(metal, 1.3); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, bottom, exitW / 2, Math.max(1, exitW * 0.08), 0, 0, Math.PI); ctx.stroke();
}

/**
 * Paint one part in a canvas box (x, y = top-left). Fairings are drawn by
 * `paintFairingShell` instead.
 */
export function paintPart(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, selected: boolean, side = 0) {
  const accent = def.accent ?? '#888';
  const cx = x + w / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  switch (def.category) {
    case 'engine': {
      if (def.style === 'ion') { paintIon(ctx, def, x, y, w, h); break; }
      if (def.style === 'aerospike') { paintAerospike(ctx, def, x, y, w, h); break; }
      if ((def.nozzles ?? 1) > 1) { paintCluster(ctx, def, x, y, w, h); break; }
      if (def.radial && side) {
        // Strut back to the core.
        ctx.fillStyle = cyl(ctx, x, w, '#5a6068');
        const sx = side > 0 ? x - w * 0.25 : x + w;
        ctx.fillRect(sx, y + h * 0.08, w * 0.25, h * 0.12);
      }
      const vac = (def.ispVac ?? 0) >= 340;
      const mountH = h * 0.26;
      // Thrust plate / housing.
      rrect(ctx, x + w * 0.04, y, w * 0.92, mountH, Math.min(3, w * 0.05));
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = shade(accent, 1); ctx.fillRect(x + w * 0.04, y + mountH * 0.62, w * 0.92, Math.max(1.5, mountH * 0.16));
      // Turbopump and plumbing.
      const chT = y + mountH, chB = y + h * 0.44;
      ctx.fillStyle = cyl(ctx, cx - w * 0.17, w * 0.34, '#4a4f57');
      ctx.fillRect(cx - w * 0.17, chT, w * 0.34, chB - chT);
      ctx.strokeStyle = '#a07a3a'; ctx.lineWidth = Math.max(1, w * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - w * 0.32, chT); ctx.quadraticCurveTo(cx - w * 0.32, chB, cx - w * 0.15, chB - (chB - chT) * 0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + w * 0.32, chT); ctx.quadraticCurveTo(cx + w * 0.3, chB, cx + w * 0.15, chB - (chB - chT) * 0.35); ctx.stroke();
      bell(ctx, cx, chB - 1, y + h, w * (vac ? 0.28 : 0.36), w * (vac ? 1.0 : 0.88), def.color);
      break;
    }
    case 'srb': {
      const noseH = def.radial ? Math.min(h * 0.16, w * 1.1) : 0;
      const bodyB = y + h * 0.86;
      ctx.beginPath();
      ctx.moveTo(x, bodyB);
      ctx.lineTo(x, y + noseH);
      if (noseH) ctx.quadraticCurveTo(x, y, cx, y), ctx.quadraticCurveTo(x + w, y, x + w, y + noseH);
      else ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, bodyB);
      ctx.closePath();
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.fillStyle = cyl(ctx, x, w, accent);
      for (const f of [0.3, 0.62]) ctx.fillRect(x, y + h * f, w, Math.max(2, h * 0.05));
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
      for (let k = 1; k < 6; k++) { const yy = y + noseH + ((bodyB - y - noseH) * k) / 6; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = cyl(ctx, x + w * 0.1, w * 0.8, '#3a3d42');
      ctx.fillRect(x + w * 0.1, bodyB, w * 0.8, h * 0.03);
      bell(ctx, cx, bodyB + h * 0.03, y + h, w * 0.4, w * 0.72, '#55595f');
      break;
    }
    case 'tank': {
      if (def.fuelKind === 'xenon' || def.fuelKind === 'mono') { paintPressureTank(ctx, def, x, y, w, h); break; }
      const r = Math.min(w * 0.14, h * 0.18);
      rrect(ctx, x, y, w, h, r);
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.save(); ctx.clip();
      // Stringers.
      ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1;
      for (let k = 1; k < 8; k++) { const xx = x + (w * k) / 8; ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke(); }
      // Accent bands.
      const band = Math.max(2.5, Math.min(h * 0.08, w * 0.12));
      ctx.fillStyle = cyl(ctx, x, w, accent);
      ctx.fillRect(x, y + h * 0.12, w, band);
      ctx.fillRect(x, y + h * 0.88 - band, w, band);
      // Weld seams near the domes.
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      for (const yy of [y + r * 0.9, y + h - r * 0.9]) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
      ctx.restore();
      rrect(ctx, x, y, w, h, r);
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      break;
    }
    case 'pod': {
      const topW = w * 0.42, shieldH = h * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - topW / 2, y + h * 0.06);
      ctx.lineTo(cx + topW / 2, y + h * 0.06);
      ctx.lineTo(x + w, y + h - shieldH);
      ctx.lineTo(x, y + h - shieldH);
      ctx.closePath();
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      // Docking ring, window, heat shield.
      ctx.fillStyle = cyl(ctx, cx - topW * 0.4, topW * 0.8, '#7d838c');
      ctx.fillRect(cx - topW * 0.4, y, topW * 0.8, h * 0.07);
      const wy = y + h * 0.42;
      ctx.fillStyle = '#1b2633';
      ctx.beginPath(); ctx.ellipse(cx - w * 0.06, wy, w * 0.1, h * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(accent, 1.2); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = 'rgba(160,210,255,0.35)';
      ctx.beginPath(); ctx.ellipse(cx - w * 0.08, wy - h * 0.03, w * 0.04, h * 0.03, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = cyl(ctx, x, w, '#5a4030');
      rrect(ctx, x - w * 0.02, y + h - shieldH, w * 1.04, shieldH, shieldH * 0.4); ctx.fill();
      break;
    }
    case 'probe': {
      rrect(ctx, x + w * 0.06, y, w * 0.88, h, Math.min(4, h * 0.2));
      ctx.fillStyle = cyl(ctx, x + w * 0.06, w * 0.88, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      // Gold-foil band with facets and a status light.
      ctx.fillStyle = cyl(ctx, x + w * 0.06, w * 0.88, '#c79a3a');
      ctx.fillRect(x + w * 0.06, y + h * 0.3, w * 0.88, h * 0.4);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) { const xx = x + w * 0.06 + (w * 0.88 * k) / 4; ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke(); }
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(cx + w * 0.22, y + h * 0.5, Math.max(1.2, Math.min(w, h) * 0.1), 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'payload': {
      paintSatellite(ctx, def, x, y, w, h, 0);
      break;
    }
    case 'decoupler': {
      rrect(ctx, x, y, w, h, Math.min(2, h * 0.3));
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = cyl(ctx, x, w, accent);
      ctx.fillRect(x, y + h * 0.38, w, h * 0.24);
      ctx.fillStyle = 'rgba(20,20,20,0.6)';
      const n = Math.max(3, Math.round(w / 9));
      for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(x + (w * (k + 0.5)) / n, y + h * 0.2, Math.max(0.8, h * 0.07), 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'science': {
      rrect(ctx, x, y + h * 0.12, w, h * 0.76, 3);
      ctx.fillStyle = cyl(ctx, x, w, '#2a3038'); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = cyl(ctx, x + w * 0.08, w * 0.84, def.color);
      ctx.fillRect(x + w * 0.08, y + h * 0.22, w * 0.84, h * 0.56);
      ctx.fillStyle = accent;
      ctx.fillRect(x + w * 0.62, y + h * 0.32, w * 0.22, h * 0.36);
      ctx.beginPath(); ctx.arc(x + w * 0.27, y + h * 0.5, Math.min(w, h) * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(x + w * 0.24, y + h * 0.45, Math.min(w, h) * 0.05, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'structural':
      paintStructural(ctx, def, x, y, w, h, side);
      break;
    case 'utility':
      paintUtility(ctx, def, x, y, w, h, side);
      break;
    case 'fairing':
      break;
    default:
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, w, h);
  }
  if (selected) {
    ctx.strokeStyle = '#7ad0ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Satellite bus. `unfold` 0 = stowed (panels folded flat against the bus),
 * 1 = fully deployed wings.
 */
export function paintSatellite(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, unfold: number) {
  if (def.id === 'station-haven') return paintStation(ctx, def, x, y, w, h, unfold);
  if (def.id === 'telescope-aurora') return paintTelescope(ctx, def, x, y, w, h, unfold);
  if (def.id === 'cargo-cx25') return paintCargo(ctx, def, x, y, w, h, unfold);
  const accent = def.accent ?? '#4a80c0';
  const cx = x + w / 2;
  const bw = w * 0.62, bh = h * 0.62, by = y + h * 0.24;
  // Folded panel stacks on both sides (stowed) or unfolding wings.
  const segW = bh * 0.95, segs = 3;
  for (const side of [-1, 1]) {
    const root = cx + side * bw / 2;
    ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = Math.max(1, w * 0.02);
    const boomL = w * 0.06 + unfold * w * 0.1;
    ctx.beginPath(); ctx.moveTo(root, by + bh / 2); ctx.lineTo(root + side * boomL, by + bh / 2); ctx.stroke();
    for (let k = 0; k < segs; k++) {
      const p = Math.max(0, Math.min(1, unfold * segs - k));
      // Each panel swings from edge-on (stowed, width ~ thickness) to flat.
      const vis = Math.max(0.08, p);
      const pw = segW * vis;
      const px = root + side * (boomL + (k ? segW * Math.min(k, unfold * segs) : 0));
      const left = side > 0 ? px : px - pw;
      if (k > 0 && p <= 0) continue;
      const g = ctx.createLinearGradient(left, by, left + pw, by + bh);
      g.addColorStop(0, '#1d3f78'); g.addColorStop(0.5, '#2f5fae'); g.addColorStop(1, '#173064');
      ctx.fillStyle = g;
      ctx.fillRect(left, by + bh * 0.06, pw, bh * 0.88);
      if (pw > 4) {
        ctx.strokeStyle = 'rgba(190,210,240,0.35)'; ctx.lineWidth = 0.7;
        for (let c = 1; c < 4; c++) { const xx = left + (pw * c) / 4; ctx.beginPath(); ctx.moveTo(xx, by + bh * 0.06); ctx.lineTo(xx, by + bh * 0.94); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(left, by + bh / 2); ctx.lineTo(left + pw, by + bh / 2); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(200,205,215,0.8)'; ctx.lineWidth = 0.8;
      ctx.strokeRect(left, by + bh * 0.06, pw, bh * 0.88);
    }
  }
  // Bus in gold foil.
  const foil = ctx.createLinearGradient(cx - bw / 2, by, cx + bw / 2, by + bh);
  foil.addColorStop(0, '#f2d27a'); foil.addColorStop(0.35, '#c9982e'); foil.addColorStop(0.6, '#e7c25a'); foil.addColorStop(1, '#8e6a1c');
  rrect(ctx, cx - bw / 2, by, bw, bh, 2);
  ctx.fillStyle = foil; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(90,60,10,0.35)'; ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.3, by + bh * 0.2); ctx.lineTo(cx - bw * 0.1, by + bh * 0.55); ctx.lineTo(cx + bw * 0.25, by + bh * 0.35);
  ctx.moveTo(cx - bw * 0.4, by + bh * 0.8); ctx.lineTo(cx + bw * 0.05, by + bh * 0.75);
  ctx.stroke();
  // Instrument: dish (comm), boom (science), radiometer (weather).
  if (def.id === 'scisat') {
    ctx.strokeStyle = '#c8ccd2'; ctx.lineWidth = Math.max(1, w * 0.025);
    ctx.beginPath(); ctx.moveTo(cx + bw * 0.2, by); ctx.lineTo(cx + bw * 0.2 + w * 0.12, y + h * 0.02); ctx.stroke();
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx + bw * 0.2 + w * 0.12, y + h * 0.02, Math.max(1.2, w * 0.04), 0, Math.PI * 2); ctx.fill();
  } else if (def.id === 'weathersat') {
    ctx.fillStyle = '#d8dde4';
    ctx.fillRect(cx - bw * 0.22, by - h * 0.12, bw * 0.44, h * 0.12);
    ctx.fillStyle = accent; ctx.fillRect(cx - bw * 0.14, by - h * 0.09, bw * 0.28, h * 0.06);
  } else {
    ctx.fillStyle = '#e8ebef';
    ctx.beginPath(); ctx.ellipse(cx, by - h * 0.06, bw * 0.38, h * 0.1, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#9aa0a8'; ctx.beginPath(); ctx.moveTo(cx, by - h * 0.06); ctx.lineTo(cx, by - h * 0.2); ctx.stroke();
  }
  ctx.fillStyle = accent;
  ctx.fillRect(cx - bw * 0.3, by + bh - Math.max(2, bh * 0.1), bw * 0.6, Math.max(2, bh * 0.1));
}

/**
 * Payload fairing: a clamshell around everything above its base.
 * Box is base-to-nose. `alpha` < 1 shows the payload through it (VAB).
 * `open` (0..1) swings the halves apart at jettison.
 */
export function paintFairingShell(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, opts: { alpha?: number; selected?: boolean; half?: -1 | 1 } = {}) {
  const alpha = opts.alpha ?? 1;
  const cx = x + w / 2;
  const nose = Math.min(h * 0.55, w * 1.05);
  const baseH = Math.min(h * 0.08, w * 0.12);
  const outline = (side: -1 | 1) => {
    ctx.beginPath();
    ctx.moveTo(cx, y + h);
    ctx.lineTo(cx + side * w * 0.47, y + h);
    ctx.lineTo(cx + side * w * 0.5, y + h - baseH);
    ctx.lineTo(cx + side * w * 0.5, y + nose);
    ctx.bezierCurveTo(cx + side * w * 0.5, y + nose * 0.42, cx + side * w * 0.22, y + nose * 0.04, cx, y);
    ctx.closePath();
  };
  ctx.save();
  const sides: Array<-1 | 1> = opts.half ? [opts.half] : [-1, 1];
  for (const side of sides) {
    outline(side);
    ctx.fillStyle = cyl(ctx, x, w, def.color, alpha);
    ctx.fill();
    ctx.strokeStyle = alpha < 1 ? 'rgba(220,230,240,0.85)' : OUTLINE;
    ctx.lineWidth = alpha < 1 ? 1.2 : 1;
    ctx.stroke();
  }
  // Separation seam, base ring and a single painted stripe.
  ctx.strokeStyle = alpha < 1 ? 'rgba(220,230,240,0.6)' : 'rgba(40,40,40,0.45)';
  ctx.lineWidth = 1;
  if (!opts.half) { ctx.beginPath(); ctx.moveTo(cx, y + 2); ctx.lineTo(cx, y + h); ctx.stroke(); }
  ctx.fillStyle = cyl(ctx, x, w, def.accent ?? '#b8b0a4', Math.max(alpha, 0.6));
  const bx0 = opts.half === 1 ? cx : x, bx1 = opts.half === -1 ? cx : x + w;
  ctx.fillRect(bx0 + (opts.half === 1 ? 0 : w * 0.01), y + h - baseH, bx1 - bx0 - w * 0.01, baseH);
  if (opts.selected) {
    ctx.strokeStyle = '#7ad0ff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6); ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Exhaust plume in the vehicle frame (+y = aft). `p` is ambient pressure
 * (1 at sea level, 0 in vacuum): tight with shock diamonds low, a wide faint
 * bloom high.
 */
export function drawPlume(ctx: CanvasRenderingContext2D, x: number, y: number, exitW: number, opts: { throttle: number; p: number; t: number; solid?: boolean; vab?: boolean; ion?: boolean }) {
  const { throttle, p } = opts;
  if (throttle <= 0.01) return;
  if (opts.ion) {
    // Faint blue ion beam.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const len = exitW * 6;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, `rgba(150,190,255,${0.75 * throttle})`); g.addColorStop(1, 'rgba(80,120,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x - exitW * 0.45, y); ctx.lineTo(x - exitW * 0.7, y + len); ctx.lineTo(x + exitW * 0.7, y + len); ctx.lineTo(x + exitW * 0.45, y); ctx.closePath(); ctx.fill();
    ctx.restore();
    return;
  }
  const fl = 1 + 0.06 * Math.sin(opts.t * 41 + x) + 0.04 * Math.sin(opts.t * 23.7 + x * 0.3);
  const len = exitW * (opts.solid ? 5.2 : 4.2) * (0.55 + 0.45 * throttle) * (1 + (1 - p) * 0.9) * fl;
  const endW = exitW * (p * 0.75 + (1 - p) * 4.2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Envelope: a few nested cones so the edge is soft. Wider and fainter in vacuum.
  const hot = opts.solid ? '255,190,110' : '255,165,70';
  for (let layer = 0; layer < 3; layer++) {
    const sw = 1 + layer * 0.35;
    const a0 = (0.55 * (0.35 + 0.65 * p) + 0.1) / (1 + layer * 1.4);
    const env = ctx.createLinearGradient(0, y, 0, y + len);
    env.addColorStop(0, `rgba(${hot},${a0})`);
    env.addColorStop(0.5, `rgba(255,110,40,${a0 * (0.35 + 0.4 * p)})`);
    env.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = env;
    ctx.beginPath();
    ctx.moveTo(x - exitW * 0.47 * sw, y);
    ctx.bezierCurveTo(x - exitW * 0.6 * sw, y + len * 0.3, x - endW * 0.5 * sw, y + len * 0.7, x, y + len * (1 + layer * 0.1));
    ctx.bezierCurveTo(x + endW * 0.5 * sw, y + len * 0.7, x + exitW * 0.6 * sw, y + len * 0.3, x + exitW * 0.47 * sw, y);
    ctx.closePath();
    ctx.fill();
  }
  // Vacuum: a faint violet fan from the bell lip.
  if (p < 0.5) {
    const k = (0.5 - p) * 2;
    const fan = ctx.createRadialGradient(x, y, exitW * 0.3, x, y, len * 1.1);
    fan.addColorStop(0, `rgba(200,205,255,${0.22 * k})`);
    fan.addColorStop(1, 'rgba(140,150,255,0)');
    ctx.fillStyle = fan;
    ctx.beginPath();
    ctx.moveTo(x - exitW * 0.5, y);
    ctx.lineTo(x - endW * 0.9, y + len * 1.1);
    ctx.quadraticCurveTo(x, y + len * 1.3, x + endW * 0.9, y + len * 1.1);
    ctx.lineTo(x + exitW * 0.5, y);
    ctx.closePath();
    ctx.fill();
  }
  // Core.
  const core = ctx.createLinearGradient(0, y, 0, y + len * 0.5);
  core.addColorStop(0, 'rgba(255,255,245,0.95)');
  core.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(x - exitW * 0.36, y);
  ctx.quadraticCurveTo(x - exitW * 0.3, y + len * 0.3, x, y + len * 0.5);
  ctx.quadraticCurveTo(x + exitW * 0.3, y + len * 0.3, x + exitW * 0.36, y);
  ctx.closePath();
  ctx.fill();
  // Shock diamonds at sea level (liquid engines).
  if (!opts.solid && p > 0.25) {
    const step = exitW * 0.85;
    for (let k = 0; k < 4; k++) {
      const dy = y + step * (0.7 + k);
      const a = (p - 0.25) * 1.1 * (1 - k / 4);
      const dw = exitW * 0.2 * (1 - k * 0.12);
      ctx.fillStyle = `rgba(255,250,235,${a})`;
      ctx.beginPath();
      ctx.moveTo(x, dy - step * 0.32); ctx.lineTo(x + dw, dy); ctx.lineTo(x, dy + step * 0.32); ctx.lineTo(x - dw, dy);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

/** Pseudo-random in [0,1) from an integer. */
function hash(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/** Smoke / condensation trail behind the vehicle (vehicle frame, +y aft). */
export function drawSmokeTrail(ctx: CanvasRenderingContext2D, x: number, y: number, exitW: number, length: number, density: number, t: number, solid: boolean) {
  if (density <= 0.01) return;
  ctx.save();
  const n = 26;
  for (let k = n - 1; k >= 0; k--) {
    const f = k / (n - 1);
    const d = Math.pow(f, 1.25) * length + exitW * 1.8;
    const wob = (hash(k + Math.floor(t * 0.5)) - 0.5) * exitW * (0.4 + f * 3);
    const r = exitW * (0.7 + f * (solid ? 6 : 4.2)) * (0.85 + hash(k * 3.1) * 0.3);
    const a = density * (solid ? 0.55 : 0.32) * (1 - f) * (0.7 + hash(k * 7.7) * 0.3);
    const g = ctx.createRadialGradient(x + wob - r * 0.25, y + d - r * 0.25, r * 0.1, x + wob, y + d, r);
    g.addColorStop(0, `rgba(238,236,232,${a})`);
    g.addColorStop(0.6, `rgba(200,198,196,${a * 0.6})`);
    g.addColorStop(1, 'rgba(180,180,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + wob - r, y + d - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Ground cloud from the flame trench at lift-off (screen frame). */
export function drawPadBillow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, amount: number) {
  if (amount <= 0.01) return;
  ctx.save();
  for (let k = 0; k < 22; k++) {
    const side = k % 2 ? 1 : -1;
    const f = hash(k * 1.7);
    const dx = side * (0.2 + f * 1.2) * size * (0.4 + amount * 0.8);
    const dy = -hash(k * 5.3) * size * 0.35 * amount;
    const r = size * (0.18 + hash(k * 9.1) * 0.25) * (0.6 + amount * 0.6);
    const a = 0.5 * amount;
    const g = ctx.createRadialGradient(x + dx - r * 0.3, y + dy - r * 0.3, r * 0.1, x + dx, y + dy, r);
    g.addColorStop(0, `rgba(245,243,238,${a})`);
    g.addColorStop(0.65, `rgba(205,203,198,${a * 0.6})`);
    g.addColorStop(1, 'rgba(190,190,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
  }
  ctx.restore();
}

/* ───────────── expanded catalog art ───────────── */

function engineMount(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, mountH: number) {
  rrect(ctx, x + w * 0.03, y, w * 0.94, mountH, Math.min(3, w * 0.05));
  ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = shade(def.accent ?? '#888', 1);
  ctx.fillRect(x + w * 0.03, y + mountH * 0.62, w * 0.94, Math.max(1.5, mountH * 0.16));
}

/** Multi-nozzle engine: a thrust structure with two or four bells (four shows a back pair). */
function paintCluster(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number) {
  const n = def.nozzles ?? 2;
  const mountH = h * 0.3;
  engineMount(ctx, def, x, y, w, mountH);
  // Plumbing skirt.
  ctx.fillStyle = cyl(ctx, x + w * 0.12, w * 0.76, '#3e434a');
  ctx.fillRect(x + w * 0.12, y + mountH, w * 0.76, h * 0.12);
  const top = y + mountH + h * 0.1;
  if (n >= 4) {
    for (const f of [-0.17, 0.17]) {
      ctx.save(); ctx.globalAlpha = 0.85;
      bell(ctx, x + w * (0.5 + f), top - h * 0.04, y + h * 0.94, w * 0.1, w * 0.3, shade(def.color, 0.7));
      ctx.restore();
    }
    for (const f of [-0.27, 0.27]) bell(ctx, x + w * (0.5 + f), top, y + h, w * 0.12, w * 0.38, def.color);
  } else {
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0 : -0.25 + (0.5 * k) / (n - 1);
      bell(ctx, x + w * (0.5 + f), top, y + h, w * 0.14, w * 0.44, def.color);
    }
  }
}

/** Linear aerospike: a tapering ramp with combustion chambers along the top. */
function paintAerospike(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number) {
  const mountH = h * 0.22;
  engineMount(ctx, def, x, y, w, mountH);
  const cx = x + w / 2, t = y + mountH, b = y + h;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.06, t);
  ctx.lineTo(x + w * 0.94, t);
  ctx.quadraticCurveTo(x + w * 0.8, t + (b - t) * 0.55, cx + w * 0.16, b);
  ctx.lineTo(cx - w * 0.16, b);
  ctx.quadraticCurveTo(x + w * 0.2, t + (b - t) * 0.55, x + w * 0.06, t);
  ctx.closePath();
  ctx.fillStyle = cyl(ctx, x, w, '#8d939b'); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  for (let k = 1; k < 7; k++) { const yy = t + ((b - t) * k) / 7; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
  const heat = ctx.createLinearGradient(0, t, 0, b);
  heat.addColorStop(0, 'rgba(120,60,30,0)'); heat.addColorStop(1, 'rgba(150,70,30,0.4)');
  ctx.fillStyle = heat; ctx.fillRect(x, t, w, b - t);
  ctx.restore();
  // Chamber row along the top of the ramp.
  ctx.fillStyle = '#2a2e34';
  const n = 6;
  for (let k = 0; k < n; k++) ctx.fillRect(x + w * (0.1 + (0.8 * k) / n), t - 1, w * 0.08, Math.max(2, h * 0.06));
}

/** Gridded ion engine: short housing and a wide glowing grid disc. */
function paintIon(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  rrect(ctx, x + w * 0.18, y, w * 0.64, h * 0.45, 3);
  ctx.fillStyle = cyl(ctx, x + w * 0.18, w * 0.64, def.color); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = cyl(ctx, x, w, '#6a7078');
  rrect(ctx, x, y + h * 0.45, w, h * 0.4, 3); ctx.fill(); ctx.stroke();
  // Grid face, seen edge-on as a glowing band.
  const gy = y + h * 0.85;
  const glow = ctx.createLinearGradient(x, 0, x + w, 0);
  glow.addColorStop(0, 'rgba(70,120,255,0.4)'); glow.addColorStop(0.5, 'rgba(150,200,255,0.95)'); glow.addColorStop(1, 'rgba(70,120,255,0.4)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.ellipse(cx, gy + h * 0.04, w * 0.46, h * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(20,30,60,0.6)'; ctx.lineWidth = 0.6;
  for (let k = 1; k < 8; k++) { const xx = x + (w * k) / 8; ctx.beginPath(); ctx.moveTo(xx, gy - h * 0.02); ctx.lineTo(xx, gy + h * 0.1); ctx.stroke(); }
}

/** Xenon capsule or monopropellant sphere: pressure vessels with domed ends. */
function paintPressureTank(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number) {
  const accent = def.accent ?? '#6080ff';
  const sphere = h <= w * 0.9;
  if (sphere) {
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    rrect(ctx, x + w * 0.04, y, w * 0.92, h, w * 0.44);
  }
  const g = ctx.createRadialGradient(x + w * 0.35, y + h * 0.3, Math.min(w, h) * 0.05, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, shade(def.color, 1.25)); g.addColorStop(0.6, def.color); g.addColorStop(1, shade(def.color, 0.55));
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.fillStyle = cyl(ctx, x, w, accent);
  ctx.fillRect(x, y + h * 0.46, w, Math.max(2, h * 0.08));
  ctx.restore();
  // Mounting ring.
  ctx.fillStyle = cyl(ctx, x + w * 0.2, w * 0.6, '#6a7078');
  ctx.fillRect(x + w * 0.2, y + h - Math.max(1.5, h * 0.05), w * 0.6, Math.max(1.5, h * 0.05));
}

function paintStructural(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, side: number) {
  const cx = x + w / 2;
  const accent = def.accent ?? '#888';
  if (def.widthBottom != null) {
    // Adapter or coupler: a conical frustum between two diameters.
    const maxW = Math.max(def.width, def.widthBottom);
    const tw = (w * def.width) / maxW, bw = (w * def.widthBottom) / maxW;
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, y); ctx.lineTo(cx + tw / 2, y);
    ctx.lineTo(cx + bw / 2, y + h); ctx.lineTo(cx - bw / 2, y + h);
    ctx.closePath();
    ctx.fillStyle = cyl(ctx, cx - bw / 2, bw, def.color); ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let k = 1; k < 10; k++) { const f = k / 10; ctx.beginPath(); ctx.moveTo(cx + (f - 0.5) * tw, y); ctx.lineTo(cx + (f - 0.5) * bw, y + h); ctx.stroke(); }
    ctx.fillStyle = cyl(ctx, x, w, accent);
    ctx.fillRect(x, y + h - Math.max(2, h * 0.14), w, Math.max(2, h * 0.14));
    ctx.restore();
    if (def.mounts) {
      // Engine mount sockets along the base.
      const n = def.mounts >= 4 ? 3 : def.mounts;
      for (let k = 0; k < n; k++) {
        const f = n === 1 ? 0.5 : 0.18 + (0.64 * k) / (n - 1);
        ctx.fillStyle = '#1b1e23';
        ctx.beginPath(); ctx.ellipse(x + w * f, y + h - 1, w * (0.5 / (n + 0.6)), Math.max(1.2, h * 0.12), 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    return;
  }
  if (def.aero === 'nose') {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.bezierCurveTo(x, y + h * 0.35, cx - w * 0.2, y + h * 0.02, cx, y);
    ctx.bezierCurveTo(cx + w * 0.2, y + h * 0.02, x + w, y + h * 0.35, x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.fillStyle = cyl(ctx, x, w, accent);
    ctx.fillRect(x, y, w, h * 0.16);
    ctx.fillRect(x, y + h * 0.86, w, h * 0.06);
    ctx.restore();
    return;
  }
  if (def.aero === 'fin') {
    // Delta fin: root chord against the tank, swept leading edge outward.
    const s = side || 1;
    const ix = s > 0 ? x : x + w, ox = s > 0 ? x + w : x;
    ctx.beginPath();
    ctx.moveTo(ix, y); ctx.lineTo(ox, y + h * 0.7); ctx.lineTo(ox, y + h); ctx.lineTo(ix, y + h);
    ctx.closePath();
    const g = ctx.createLinearGradient(ix, y, ox, y + h);
    g.addColorStop(0, shade(def.color, 1.05)); g.addColorStop(1, shade(def.color, 0.7));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = Math.max(1.5, w * 0.08);
    ctx.beginPath(); ctx.moveTo(ix, y + 1); ctx.lineTo(ox, y + h * 0.7); ctx.stroke();
    return;
  }
  if (def.id === 'hs-25') {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y);
    ctx.quadraticCurveTo(x + w, y + h, cx, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y);
    ctx.closePath();
    ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 14; k++) { const f = (k + 0.5) / 14; ctx.fillRect(x + w * f, y + h * 0.25, 1, h * 0.35); }
    return;
  }
  // Truss segment: two rails and a zig-zag web.
  const rail = Math.max(1.5, w * 0.08);
  ctx.fillStyle = cyl(ctx, x, rail, def.color);
  ctx.fillRect(x + w * 0.08, y, rail, h);
  ctx.fillStyle = cyl(ctx, x + w * 0.92 - rail, rail, def.color);
  ctx.fillRect(x + w * 0.92 - rail, y, rail, h);
  ctx.strokeStyle = shade(def.color, 0.8); ctx.lineWidth = Math.max(1, w * 0.04);
  const n = Math.max(3, Math.round(h / Math.max(4, w * 0.6)));
  ctx.beginPath();
  for (let k = 0; k <= n; k++) { const yy = y + (h * k) / n; const xx = k % 2 ? x + w * 0.88 : x + w * 0.12; if (k) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
  ctx.stroke();
  ctx.fillStyle = cyl(ctx, x, w, accent);
  ctx.fillRect(x, y, w, Math.max(2, h * 0.05)); ctx.fillRect(x, y + h - Math.max(2, h * 0.05), w, Math.max(2, h * 0.05));
}

function paintUtility(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, side: number) {
  const cx = x + w / 2;
  const accent = def.accent ?? '#888';
  const s = side || 1;
  const inner = s > 0 ? x : x + w, outer = s > 0 ? x + w : x;
  switch (def.id) {
    case 'battery-z': {
      rrect(ctx, x, y, w, h, 2);
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = accent;
      for (const f of [0.22, 0.62]) ctx.fillRect(x + w * 0.12, y + h * f, w * 0.76, Math.max(1.2, h * 0.14));
      return;
    }
    case 'solar-sp6': {
      ctx.fillStyle = '#8a9098';
      ctx.fillRect(Math.min(inner, inner + s * w * 0.18), y + h * 0.45, w * 0.18, h * 0.1);
      const px = s > 0 ? x + w * 0.18 : x, pw = w * 0.82;
      const g = ctx.createLinearGradient(px, y, px + pw, y + h);
      g.addColorStop(0, '#24427e'); g.addColorStop(0.5, '#3563b5'); g.addColorStop(1, '#1a2f63');
      ctx.fillStyle = g; ctx.fillRect(px, y, pw, h);
      ctx.strokeStyle = 'rgba(200,215,240,0.45)'; ctx.lineWidth = 0.6;
      for (let k = 1; k < 6; k++) { const yy = y + (h * k) / 6; ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(px + pw / 2, y); ctx.lineTo(px + pw / 2, y + h); ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(px, y, pw, h);
      return;
    }
    case 'rtg-pb': {
      rrect(ctx, x + w * 0.2, y, w * 0.6, h, 3);
      ctx.fillStyle = cyl(ctx, x + w * 0.2, w * 0.6, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = cyl(ctx, x, w, shade(def.color, 0.8));
      for (let k = 0; k < 5; k++) ctx.fillRect(x, y + h * (0.15 + k * 0.16), w, Math.max(1, h * 0.05));
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, y + h * 0.08, Math.max(1.2, w * 0.1), 0, Math.PI * 2); ctx.fill();
      return;
    }
    case 'ant-whip': {
      ctx.fillStyle = '#6a7078'; ctx.fillRect(Math.min(inner, outer), y + h * 0.82, w, h * 0.18);
      ctx.strokeStyle = def.color; ctx.lineWidth = Math.max(1, w * 0.15);
      ctx.beginPath(); ctx.moveTo(cx, y + h * 0.82); ctx.lineTo(cx, y); ctx.stroke();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, y, Math.max(1, w * 0.2), 0, Math.PI * 2); ctx.fill();
      return;
    }
    case 'dish-ra80': {
      ctx.strokeStyle = '#8a9098'; ctx.lineWidth = Math.max(1, w * 0.05);
      ctx.beginPath(); ctx.moveTo(inner, y + h * 0.8); ctx.lineTo(cx, y + h * 0.55); ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + s * w * 0.05, y + h * 0.4, w * 0.48, h * 0.32, s * -0.5, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx, y + h * 0.35, 1, cx, y + h * 0.4, w * 0.5);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, shade(def.color, 0.75));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(cx + s * w * 0.05, y + h * 0.4); ctx.lineTo(cx + s * w * 0.35, y + h * 0.05); ctx.stroke();
      return;
    }
    case 'rw-1': {
      rrect(ctx, x, y, w, h, Math.min(3, h * 0.3));
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = cyl(ctx, x, w, accent);
      ctx.fillRect(x + w * 0.1, y + h * 0.35, w * 0.8, h * 0.3);
      ctx.fillStyle = '#7ad0ff'; ctx.beginPath(); ctx.arc(x + w * 0.85, y + h * 0.5, Math.max(1, h * 0.12), 0, Math.PI * 2); ctx.fill();
      return;
    }
    case 'rcs-4': {
      rrect(ctx, x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7, 2);
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(cx - w * 0.08, y, w * 0.16, h * 0.18);
      ctx.fillRect(cx - w * 0.08, y + h * 0.82, w * 0.16, h * 0.18);
      ctx.fillRect(outer - (s > 0 ? w * 0.18 : 0), cy(y, h) - h * 0.08, w * 0.18, h * 0.16);
      return;
    }
    case 'leg-lt3': {
      ctx.strokeStyle = def.color; ctx.lineWidth = Math.max(1.5, w * 0.16);
      ctx.beginPath(); ctx.moveTo(inner, y); ctx.lineTo(outer - s * w * 0.15, y + h * 0.92); ctx.stroke();
      ctx.lineWidth = Math.max(1, w * 0.08);
      ctx.beginPath(); ctx.moveTo(inner, y + h * 0.55); ctx.lineTo(outer - s * w * 0.2, y + h * 0.8); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(Math.min(outer, outer - s * w * 0.45), y + h * 0.92, w * 0.45, h * 0.08);
      return;
    }
    case 'chute-mk16': {
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.06, y + h * 0.4);
      ctx.quadraticCurveTo(cx, y - h * 0.15, x + w * 0.94, y + h * 0.4);
      ctx.lineTo(x + w, y + h); ctx.closePath();
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.fillStyle = cyl(ctx, x, w, accent);
      for (let k = 0; k < 3; k++) ctx.fillRect(x + w * (0.12 + k * 0.3), y, w * 0.14, h);
      ctx.restore();
      return;
    }
    case 'lamp-1': {
      rrect(ctx, x, y + h * 0.2, w, h * 0.6, 2);
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(outer - s * w * 0.2, cy(y, h), Math.max(1.2, h * 0.22), 0, Math.PI * 2); ctx.fill();
      return;
    }
    default:
      rrect(ctx, x, y, w, h, 2);
      ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  }
}
const cy = (y: number, h: number) => y + h / 2;

function solarWing(ctx: CanvasRenderingContext2D, root: number, side: number, yy: number, span: number, hh: number) {
  const left = side > 0 ? root : root - span;
  const g = ctx.createLinearGradient(left, yy, left + span, yy + hh);
  g.addColorStop(0, '#1d3f78'); g.addColorStop(0.5, '#2f5fae'); g.addColorStop(1, '#173064');
  ctx.fillStyle = g; ctx.fillRect(left, yy, span, hh);
  ctx.strokeStyle = 'rgba(190,210,240,0.4)'; ctx.lineWidth = 0.7;
  const n = Math.max(2, Math.round(span / Math.max(4, hh)));
  for (let k = 1; k < n; k++) { const xx = left + (span * k) / n; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + hh); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(200,205,215,0.8)'; ctx.strokeRect(left, yy, span, hh);
}

/** Pressurised station module: ribbed hull, windows, docking ports, solar wings that unfold. */
function paintStation(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, unfold: number) {
  const cx = x + w / 2;
  const hw = w * 0.84, hx = cx - hw / 2;
  const port = Math.min(h * 0.08, w * 0.14);
  ctx.fillStyle = cyl(ctx, cx - w * 0.22, w * 0.44, '#9aa0a8');
  ctx.fillRect(cx - w * 0.22, y, w * 0.44, port);
  ctx.fillRect(cx - w * 0.22, y + h - port, w * 0.44, port);
  rrect(ctx, hx, y + port, hw, h - port * 2, Math.min(hw * 0.12, 6));
  ctx.fillStyle = cyl(ctx, hx, hw, def.color); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let k = 1; k < 10; k++) { const yy = y + port + ((h - port * 2) * k) / 10; ctx.beginPath(); ctx.moveTo(hx, yy); ctx.lineTo(hx + hw, yy); ctx.stroke(); }
  ctx.fillStyle = cyl(ctx, hx, hw, def.accent ?? '#3a6ab0');
  ctx.fillRect(hx, y + h * 0.3, hw, Math.max(2, h * 0.03));
  ctx.fillRect(hx, y + h * 0.7, hw, Math.max(2, h * 0.03));
  ctx.fillStyle = '#16202c';
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(cx - hw * 0.18 + k * hw * 0.18, y + h * 0.5, Math.max(1.2, hw * 0.045), 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  // Solar wings: stowed against the hull, swinging out to full span.
  const span = w * (0.12 + unfold * 1.6), hh = h * 0.2;
  for (const s of [-1, 1]) {
    const root = cx + s * hw / 2;
    ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.beginPath(); ctx.moveTo(root, y + h * 0.5); ctx.lineTo(root + s * w * 0.05, y + h * 0.5); ctx.stroke();
    solarWing(ctx, root + s * w * 0.05, s, y + h * 0.5 - hh / 2, span, hh);
  }
}

/** Space telescope: long baffle tube with an aperture door that swings open. */
function paintTelescope(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, unfold: number) {
  const cx = x + w / 2;
  const tw = w * 0.78, tx = cx - tw / 2;
  const doorH = h * 0.06;
  rrect(ctx, tx, y + doorH, tw, h * 0.72, 3);
  ctx.fillStyle = cyl(ctx, tx, tw, def.color); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let k = 1; k < 8; k++) { const yy = y + doorH + (h * 0.72 * k) / 8; ctx.beginPath(); ctx.moveTo(tx, yy); ctx.lineTo(tx + tw, yy); ctx.stroke(); }
  ctx.restore();
  // Gold-foil instrument bus.
  const foil = ctx.createLinearGradient(tx, 0, tx + tw, 0);
  foil.addColorStop(0, '#8e6a1c'); foil.addColorStop(0.35, '#f2d27a'); foil.addColorStop(0.7, '#c9982e'); foil.addColorStop(1, '#6e520f');
  ctx.fillStyle = foil;
  rrect(ctx, x + w * 0.05, y + doorH + h * 0.72, w * 0.9, h * 0.22 - doorH * 0.2, 3); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.stroke();
  // Aperture door hinged on one side.
  ctx.save();
  ctx.translate(tx + tw, y + doorH);
  ctx.rotate(-unfold * 1.2);
  ctx.fillStyle = cyl(ctx, -tw, tw, '#c8ccd2');
  ctx.fillRect(-tw, -doorH, tw, doorH);
  ctx.strokeStyle = OUTLINE; ctx.strokeRect(-tw, -doorH, tw, doorH);
  ctx.restore();
  // Small solar paddles at the bus.
  const span = w * (0.1 + unfold * 0.9), hh = h * 0.12;
  for (const s of [-1, 1]) solarWing(ctx, cx + s * w * 0.45, s, y + h * 0.78, span, hh);
}

/** Cargo carrier with bay doors (doors swing open on deploy). */
function paintCargo(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, unfold: number) {
  const cx = x + w / 2;
  rrect(ctx, x + w * 0.04, y, w * 0.92, h, Math.min(6, w * 0.08));
  ctx.fillStyle = cyl(ctx, x, w, def.color); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(30,34,40,0.85)';
  const open = unfold * w * 0.1;
  ctx.fillRect(cx - open, y + h * 0.12, open * 2, h * 0.76);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.moveTo(cx - open, y + h * 0.1); ctx.lineTo(cx - open, y + h * 0.9); ctx.moveTo(cx + open, y + h * 0.1); ctx.lineTo(cx + open, y + h * 0.9); ctx.stroke();
  ctx.fillStyle = cyl(ctx, x, w, def.accent ?? '#d0a030');
  for (const f of [0.06, 0.9]) ctx.fillRect(x + w * 0.04, y + h * f, w * 0.92, Math.max(2, h * 0.04));
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.font = `${Math.max(7, Math.round(w * 0.12))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  if (w > 40) ctx.fillText('CX-25', cx - w * 0.25, y + h * 0.5);
}
