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
export function paintPart(ctx: CanvasRenderingContext2D, def: PartDef, x: number, y: number, w: number, h: number, selected: boolean) {
  const accent = def.accent ?? '#888';
  const cx = x + w / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  switch (def.category) {
    case 'engine': {
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
export function drawPlume(ctx: CanvasRenderingContext2D, x: number, y: number, exitW: number, opts: { throttle: number; p: number; t: number; solid?: boolean; vab?: boolean }) {
  const { throttle, p } = opts;
  if (throttle <= 0.01) return;
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
