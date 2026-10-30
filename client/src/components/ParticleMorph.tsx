import { prefersReducedMotion } from '@/lib/motion';
import { useEffect, useRef } from 'react';

type Pt = [number, number];

/** Sample N points (0..1 square) from a shape drawn on an offscreen canvas. */
function sample(draw: (g: CanvasRenderingContext2D, s: number) => void, n: number, seed: number): Pt[] {
  const s = 220;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  draw(g, s);
  const data = g.getImageData(0, 0, s, s).data;
  const hits: Pt[] = [];
  for (let y = 0; y < s; y += 1) for (let x = 0; x < s; x += 1) if (data[(y * s + x) * 4 + 3]! > 140) hits.push([x / s, y / s]);
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const h = hits[Math.floor(rnd() * hits.length)] ?? [0.5, 0.5];
    out.push([h[0] + (rnd() - 0.5) / s, h[1] + (rnd() - 0.5) / s]);
  }
  return out;
}

const drawKing = (g: CanvasRenderingContext2D, s: number) => {
  g.font = `${s * 0.92}px "DejaVu Sans", "Segoe UI Symbol", "Noto Sans Symbols 2", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♚', s / 2, s * 0.54);
};

const drawCheckers = (g: CanvasRenderingContext2D, s: number) => {
  g.lineWidth = s * 0.03;
  const disc = (cx: number, cy: number, r: number) => {
    const ry = r * 0.42, th = r * 0.22;
    g.beginPath(); g.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(cx, cy, r * 0.62, ry * 0.62, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(cx, cy + th, r, ry, 0, 0, Math.PI); g.stroke();
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx - r, cy + th); g.moveTo(cx + r, cy); g.lineTo(cx + r, cy + th); g.stroke();
  };
  disc(s * 0.5, s * 0.72, s * 0.4);
  disc(s * 0.5, s * 0.47, s * 0.4);
  g.beginPath();
  const y = s * 0.3, w = s * 0.18;
  g.moveTo(s * 0.5 - w, y); g.lineTo(s * 0.5 - w, y - s * 0.12); g.lineTo(s * 0.5 - w / 2, y - s * 0.05); g.lineTo(s * 0.5, y - s * 0.15);
  g.lineTo(s * 0.5 + w / 2, y - s * 0.05); g.lineTo(s * 0.5 + w, y - s * 0.12); g.lineTo(s * 0.5 + w, y); g.closePath(); g.fill();
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Fixed canvas that draws a particle chess king over the first panel's visual slot and, as the
 * checkers panel slides over, scatters it into a swirl that reassembles as stacked checkers.
 * Scrubbed by scroll (reverses on scroll up); reduced motion gets a plain crossfade.
 */
export function ParticleMorph({ slots }: { slots: () => Array<HTMLElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const n = window.innerWidth < 760 ? 800 : 1800;
    const a = sample(drawKing, n, 7);
    const b = sample(drawCheckers, n, 11);
    const seeds = Array.from({ length: n }, (_, i) => [Math.sin(i * 12.9898) * 43758.5453 % 1, Math.sin(i * 78.233) * 12543.123 % 1]);
    let raf = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    };
    resize();
    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      const [s0, s1] = slots();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (!s0 || !s1) return;
      const r0 = s0.getBoundingClientRect();
      const r1 = s1.getBoundingClientRect();
      if (r1.bottom < 0) return;
      const h = window.innerHeight;
      const raw = Math.min(1, Math.max(0, 1 - s1.closest('section')!.getBoundingClientRect().top / h));
      const t = ease(raw);
      // Where to draw: blend the two slot rects (the first is pinned, the second slides up).
      const lerp = (x: number, y: number, k: number) => x + (y - x) * k;
      const left = lerp(r0.left, r1.left, t), top = lerp(r0.top, Math.max(r1.top, r0.top), t);
      const size = lerp(Math.min(r0.width, r0.height), Math.min(r1.width, r1.height), t);
      const ox = left + (lerp(r0.width, r1.width, t) - size) / 2, oy = top + (lerp(r0.height, r1.height, t) - size) / 2;
      const ps = window.innerWidth < 760 ? 1.6 : 1.4;
      if (prefersReducedMotion()) {
        for (const [pts, alpha, col] of [[a, 1 - raw, '#e0b56a'], [b, raw, '#e9e2d4']] as const) {
          g.globalAlpha = alpha; g.fillStyle = col;
          for (const [x, y] of pts) g.fillRect(ox + x * size, oy + y * size, ps, ps);
        }
        g.globalAlpha = 1;
        return;
      }
      const swirl = Math.sin(Math.PI * t);
      const spin = t * Math.PI * 2.2 + time * 0.0002 * swirl;
      const cx = ox + size / 2, cy = oy + size / 2;
      const cr = Math.round(224 + (233 - 224) * t), cg = Math.round(181 + (226 - 181) * t), cb = Math.round(106 + (212 - 106) * t);
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = a[i]!; const [bx, by] = b[i]!; const [n1, n2] = seeds[i]!;
        // stagger: each particle leaves/arrives at a slightly different moment
        const k = Math.min(1, Math.max(0, (t - Math.abs(n1) * 0.25) / 0.75));
        let x = lerp(ax, bx, ease(k)) * size + ox;
        let y = lerp(ay, by, ease(k)) * size + oy;
        const rad = swirl * size * (0.25 + Math.abs(n2) * 0.55);
        const ang = spin * (0.6 + Math.abs(n1)) + n2 * 6.28;
        x += Math.cos(ang) * rad - (x - cx) * swirl * 0.35;
        y += Math.sin(ang) * rad * 0.7 - (y - cy) * swirl * 0.35;
        g.globalAlpha = 0.55 + 0.45 * (1 - swirl * Math.abs(n2));
        g.fillRect(x, y, ps, ps);
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [slots]);
  return <canvas ref={ref} className="si-particles" aria-hidden="true" data-testid="particle-morph" />;
}
