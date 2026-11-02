/**
 * Factory look (pt1342u): materials, lighting and small effects for the factory floor canvas.
 * Pure drawing helpers — no gameplay state. LOW = phones / weak devices / reduced motion: no blur shadows,
 * no particles, no light pools (just a cheap vignette), so the canvas stays smooth.
 */
const mm = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
export const LOW: boolean = typeof navigator !== 'undefined' && (
  (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3 || mm('(prefers-reduced-motion: reduce)')
  || (mm('(pointer: coarse)') && Math.min(window.screen?.width ?? 999, window.screen?.height ?? 999) < 500));

const hsh = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** 4 cached 64px polished-concrete tiles (speckle, a few hairline cracks, worn edges). */
let TILES: HTMLCanvasElement[] | null = null;
export function floorTiles(): HTMLCanvasElement[] | null {
  if (TILES || typeof document === 'undefined') return TILES;
  TILES = [0, 1, 2, 3].map((v) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); if (!g) return c;
    const base = 52 + v * 3; const gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, `rgb(${base + 6},${base + 7},${base + 8})`); gr.addColorStop(1, `rgb(${base - 4},${base - 3},${base - 2})`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) { const x = hsh(i, v + 1) * 64, y = hsh(v + 3, i) * 64; const l = hsh(i, i + v) > 0.5; g.fillStyle = l ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.09)'; g.fillRect(x, y, 1 + (i % 2), 1); }
    if (v === 1 || v === 3) { g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 0.7; g.beginPath(); let x = hsh(v, 9) * 64, y = 0; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (hsh(k, v) - 0.5) * 18; y += 11; g.lineTo(x, y); } g.stroke(); }
    if (v === 2) { g.fillStyle = 'rgba(20,16,10,.10)'; g.beginPath(); g.ellipse(40, 26, 13, 8, 0.4, 0, 7); g.fill(); }
    // expansion joint + bevel
    g.fillStyle = 'rgba(0,0,0,.42)'; g.fillRect(0, 0, 64, 1.5); g.fillRect(0, 0, 1.5, 64);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(1.5, 1.5, 62, 1); g.fillRect(1.5, 1.5, 1, 62);
    return c;
  });
  return TILES;
}

/** Diagonal yellow/black warning stripes clipped to a rect. */
export function hazard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 1) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#e7b416';
  const s = Math.max(4, Math.min(w, h) * 1.1); for (let i = -h - s; i < w + h; i += s * 2) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + s, y + h); ctx.lineTo(x + i + s + h, y); ctx.lineTo(x + i + h, y); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

/** Painted-steel fill: lit from the top-left, darker toward the bottom-right. */
export function steel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, gloss = 0.22) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h); g.addColorStop(0, shade(color, gloss)); g.addColorStop(0.55, color); g.addColorStop(1, shade(color, -0.32)); return g;
}
/** Brushed metal (bare steel) gradient. */
export function metal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, vertical = false) {
  const g = vertical ? ctx.createLinearGradient(x, y, x + w, y) : ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#9aa1a9'); g.addColorStop(0.35, '#d6dbe0'); g.addColorStop(0.5, '#a8afb7'); g.addColorStop(1, '#5d636a'); return g;
}
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
/** Soft drop shadow under a footprint (blur on capable devices, offset fill on LOW). */
export function dropShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, ts: number) {
  ctx.save();
  if (!LOW) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = ts * 0.35; ctx.shadowOffsetX = ts * 0.08; ctx.shadowOffsetY = ts * 0.14; ctx.fillStyle = 'rgba(0,0,0,.35)'; }
  else { ctx.fillStyle = 'rgba(0,0,0,.4)'; x += ts * 0.08; y += ts * 0.12; }
  rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
}
/** Bolt/rivet with a highlight. */
export function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#23262a'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); ctx.fill();
}
/** Louvred vent grille. */
export function vent(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#16181b'; rrect(ctx, x, y, w, h, Math.min(w, h) * 0.2); ctx.fill();
  const n = Math.max(2, Math.round(h / 3.2)); for (let i = 0; i < n; i++) { const yy = y + (h * (i + 0.5)) / n; ctx.fillStyle = 'rgba(160,168,176,.45)'; ctx.fillRect(x + w * 0.12, yy - 0.5, w * 0.76, Math.max(0.8, h / n * 0.35)); }
}
/** Deterministic sparks burst (time-based, no state). */
export function sparks(ctx: CanvasRenderingContext2D, cx: number, cy: number, ts: number, t: number, seed: number, hue = 45) {
  if (LOW) return; const ph = t / 1000;
  for (let i = 0; i < 7; i++) {
    const q = (ph * 1.7 + hsh(i, seed)) % 1; if (q > 0.55) continue; const a = -Math.PI / 2 + (hsh(seed, i) - 0.5) * 2.6;
    const d = q * ts * 0.9; const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d + q * q * ts * 0.9;
    ctx.fillStyle = `hsla(${hue},100%,${70 + 20 * (1 - q)}%,${1 - q / 0.55})`; ctx.fillRect(x, y, Math.max(1, ts * 0.05), Math.max(1, ts * 0.05));
  }
}
/** Soft rising steam puffs from (x, y). */
export function steam(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, t: number, n = 4, tint = '200,205,210') {
  const ph = t / 1000; const m = LOW ? 2 : n;
  for (let i = 0; i < m; i++) { const q = (ph * 0.6 + i / m) % 1; const r = ts * (0.1 + q * 0.32); const xx = x + Math.sin(q * 5 + i) * ts * 0.14, yy = y - q * ts * 1.2;
    if (LOW) { ctx.fillStyle = `rgba(${tint},${0.25 * (1 - q)})`; ctx.beginPath(); ctx.arc(xx, yy, r, 0, 7); ctx.fill(); continue; }
    const g = ctx.createRadialGradient(xx, yy, 0, xx, yy, r); g.addColorStop(0, `rgba(${tint},${0.32 * (1 - q)})`); g.addColorStop(1, `rgba(${tint},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(xx, yy, r, 0, 7); ctx.fill(); }
}
/** Glow halo (lamps, furnace mouths). */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
/** Overhead lighting: warm pools under ceiling lamps + edge vignette. */
export function lighting(ctx: CanvasRenderingContext2D, ox: number, oy: number, ts: number, size: number, W: number, H: number) {
  const fw = size * ts;
  if (!LOW) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const step = 6; const off = ((size % step) + step) / 2;
    for (let gy = off; gy < size; gy += step) for (let gx = off; gx < size; gx += step) { const x = ox + gx * ts, y = oy + gy * ts; if (x < -ts * 5 || y < -ts * 5 || x > W + ts * 5 || y > H + ts * 5) continue; glow(ctx, x, y, ts * 3.6, '255,226,170', 0.07); }
    ctx.restore();
  }
  const cx = ox + fw / 2, cy = oy + fw / 2; const g = ctx.createRadialGradient(cx, cy, fw * 0.3, cx, cy, fw * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.38)'); ctx.fillStyle = g; ctx.fillRect(ox, oy, fw, fw);
}
