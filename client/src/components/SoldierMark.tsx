import { SOLDIER_CUT, SOLDIER_FILL } from '@/lib/soldier';

/** The Conquest logo: same art the particle morph forms, as a static SVG (reduced motion, thumbnails). */
export function SoldierMark({ className, color = '#d9ae66' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Napoleonic soldier, the Chud Conquest emblem" data-testid="soldier-mark">
      <defs><mask id="cq-soldier-cut"><rect width="100" height="100" fill="#fff" />
        {SOLDIER_CUT.map(([a, b, c, d, w], i) => <line key={i} x1={a} y1={b} x2={c} y2={d} stroke="#000" strokeWidth={w} strokeLinecap="round" />)}</mask></defs>
      <g mask="url(#cq-soldier-cut)" fill={color}>{SOLDIER_FILL.map((d, i) => <path key={i} d={d} />)}</g>
    </svg>
  );
}
