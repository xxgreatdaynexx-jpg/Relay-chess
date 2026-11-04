/** MU #9 v2: (i) explainer bubble for any stock term, and the Learn glossary. Display only. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, GROUPS, TERM } from '../../../../shared/stockGlossary';

/** Small (i) button; tap/click (or hover on desktop) shows the plain-English explainer. */
export function Info({ id, label }: { id: string; label?: string }) {
  const t = TERM.get(id); const [open, setOpen] = useState(false); const ref = useRef<HTMLSpanElement>(null); const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  useEffect(() => { if (!open || !ref.current) return; const r = ref.current.getBoundingClientRect(); const w = Math.min(260, window.innerWidth - 16); const up = r.bottom + 170 > window.innerHeight; setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top: up ? r.top - 6 : r.bottom + 6, up }); }, [open]);
  useEffect(() => {
    if (!open) return; const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', off); return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  if (!t) return null;
  return (
    <span ref={ref} className="ivx-info-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="ivx-info" aria-label={`What is ${label ?? t.term}?`} aria-expanded={open} data-testid={`ivx-info-${id}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>i</button>
      {open && createPortal(<span role="tooltip" className={`ivx-tip${pos?.up ? ' up' : ''}`} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }} data-testid={`ivx-tip-${id}`} onPointerDown={(e) => e.stopPropagation()}><b>{t.term}</b><span className="block">{t.short}</span><span className="mt-1 block opacity-75">{t.long}</span></span>, document.body)}
    </span>
  );
}
/** A label followed by its (i). */
export const Term = ({ id, children }: { id: string; children: React.ReactNode }) => <span className="inline-flex items-center gap-1">{children}<Info id={id} /></span>;

export function LearnView() {
  const [q, setQ] = useState(''); const s = q.trim().toLowerCase();
  const list = GLOSSARY.filter((t) => !s || `${t.term} ${t.short} ${t.long}`.toLowerCase().includes(s));
  return (
    <div data-testid="stk-learn">
      <div className="ivx-card mb-2"><b className="text-base">📚 Learn the market</b><p className="mt-1 text-xs opacity-75">Every word on the exchange, explained simply. Tap any <span className="ivx-info pointer-events-none">i</span> next to a number to see its explainer right there.</p></div>
      <input className="mb-2 w-full rounded bg-black/30 px-2 py-1" placeholder="Search a word, like P/E or put" value={q} onChange={(e) => setQ(e.target.value)} data-testid="stk-learn-search" />
      {GROUPS.map((g) => { const ts = list.filter((t) => t.group === g); return ts.length ? (
        <section key={g} className="mb-3"><h4 className="mb-1 text-xs uppercase tracking-wide opacity-70">{g}</h4>
          <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{ts.map((t) => <div key={t.id} className="ivx-stat" data-testid={`stk-learn-${t.id}`}><dt className="font-bold">{t.term}</dt><dd className="text-xs"><span className="text-amber-200">{t.short}</span> <span className="opacity-75">{t.long}</span></dd></div>)}</dl>
        </section>) : null; })}
      {!list.length && <p className="text-xs opacity-60">No matches.</p>}
    </div>
  );
}
