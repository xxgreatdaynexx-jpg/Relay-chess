import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { chipStack, dealOffset, fitTable, tableAspect, type Pt } from '@/lib/tableLayout';

/**
 * Felt casino table shell: padded rail, felt with texture + lamp light, scales to its window.
 * Children are positioned with `at()` in % of the table; sizes inside use cqw so everything scales together.
 */
export function FeltTable({ kind, children, testId }: { kind: 'bj' | 'he'; children: (aspect: number) => ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 300, aspect: tableAspect(400, kind) });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      const aspect = tableAspect(w, kind);
      const availH = Math.max(240, (el.closest('.sol-panel')?.clientHeight ?? window.innerHeight) - 120);
      const f = fitTable(w, availH, aspect, Math.min(280, w));
      setBox((b) => (b.w === f.w && b.h === f.h && b.aspect === aspect ? b : { ...f, aspect }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [kind]);
  return (
    <div className="felt-fit" ref={ref}>
      <div className={`felt-table felt-${kind}`} style={{ width: box.w, height: box.h }} data-testid={testId}>
        <div className="felt-rail" />
        <div className="felt-cloth" />
        <div className="felt-layer">{children(box.aspect)}</div>
      </div>
    </div>
  );
}

export const at = (p: Pt, extra?: CSSProperties): CSSProperties => ({ left: `${p.x}%`, top: `${p.y}%`, ...extra });

/** Style for a card dealt from `from` to `to` (both % of table), staggered by `i`. */
export function dealStyle(from: Pt, to: Pt, aspect: number, i: number): CSSProperties {
  const o = dealOffset(from, to, aspect);
  return { ['--dx' as string]: `${o.dx}cqw`, ['--dy' as string]: `${o.dy}cqw`, animationDelay: `${Math.min(i, 6) * 90}ms` };
}

/** A short pile of chips in casino colours; slides in from `from` when the amount changes. */
export function Chips({ amount, from, to, aspect, label, className = '' }: { amount: number; from?: Pt; to?: Pt; aspect?: number; label?: string; className?: string }) {
  if (amount <= 0) return null;
  const stack = chipStack(amount, 6).reverse();
  const style = from && to && aspect ? dealStyle(from, to, aspect, 0) : undefined;
  return (
    <div className={`felt-chips ${from ? 'chip-slide' : ''} ${className}`} style={style} key={amount} aria-label={`${amount} chips`}>
      <div className="felt-chip-pile">
        {stack.map((d, k) => <span key={k} className={`felt-chip c${d}`} style={{ bottom: `${k * 0.55}cqw` }} />)}
      </div>
      <span className="felt-chip-amt">{label ?? amount.toLocaleString()}</span>
    </div>
  );
}
