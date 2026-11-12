import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanelDrag } from '@/lib/panelDrag';
import { render, type SimRef, type UiRef } from './FactoryBuilder';
import { FLOOR_LEVELS, TICK_MS, floorSize, frecipe, gridOf, nameOfKey, step, type FState, type Kind } from '../../../shared/factory';

/** Opens the read-only factory viewer for `name` from anywhere (profiles, leaderboard, factory picker). */
export const openFactoryView = (name: string) => window.dispatchEvent(new CustomEvent('open-factory-view', { detail: name }));

type View = { ok: boolean; error?: string; name?: string; level?: number; state?: FState; machines?: number; now?: number };
const LOGISTICS = new Set<Kind>(['belt', 'underground', 'splitter', 'inserter', 'chest_in', 'chest_out', 'chest_sell']);
const KIND_NAME: Record<Kind, string> = { belt: 'Belt', underground: 'Underground belt', splitter: 'Splitter', inserter: 'Inserter', chest_in: 'Input chest', chest_out: 'Output chest', chest_sell: 'Auto-sell chest', smelter: 'Smelter', press: 'Press', roller: 'Roller', drawer: 'Wire drawer', assembler: 'Assembler', jeweler: 'Jeweler', fabricator: 'Fabricator', mill: 'Mill', cannery: 'Cannery' };

/** Read-only view of another player's factory: no socket ops, no pointer tools, nothing to collect, move, build or edit. */
export function FactoryViewer() {
  const [name, setName] = useState<string | null>(null);
  const [v, setV] = useState<View | null>(null);
  const dragView = usePanelDrag('factory-view');
  const cvRef = useRef<HTMLCanvasElement>(null); const wrapRef = useRef<HTMLDivElement>(null);
  const sim = useRef<SimRef & { skew: number }>({ s: null, g: new Map(), store: new Map(), shown: 0, shownFrom: 0, shownAt: 0, skew: 0 });
  const ui = useRef<UiRef>({ tool: 'select', dir: 0, sel: null, moving: null, sels: [], hover: null, drag: [], removing: new Set(), marquee: null, z: 1, px: 0, py: 0, mini: null });
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<string>).detail; if (typeof d === 'string' && d.trim()) { setV(null); setName(d.trim()); } };
    window.addEventListener('open-factory-view', on); return () => window.removeEventListener('open-factory-view', on);
  }, []);
  useEffect(() => {
    if (!name) return; let dead = false;
    const load = () => fetch(`/api/factory/view/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(12_000) }).then(async (r) => {
      const j = await r.json().catch(() => ({ ok: false, error: 'Could not load that factory.' })) as View; if (dead) return;
      if (r.status === 429) return;
      setV(j);
      if (j.ok && j.state) { const c = sim.current; const size = floorSize(j.state.floor); c.s = j.state; c.g = gridOf(j.state); c.shown = size; c.shownFrom = size; c.shownAt = 0; if (j.now) c.skew = j.now - Date.now(); }
    }).catch((e: unknown) => { if (!dead) setV((c) => c ?? { ok: false, error: e instanceof DOMException && e.name === 'AbortError' ? 'This is taking too long. Try again.' : 'Network error — try again.' }); });
    load(); const t = window.setInterval(load, 4000);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setName(null); } };
    window.addEventListener('keydown', key, true);
    return () => { dead = true; window.clearInterval(t); window.removeEventListener('keydown', key, true); sim.current.s = null; };
  }, [name]);
  useEffect(() => {
    if (!name) return; let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw); if (t - last < 40) return; last = t;
      const cv = cvRef.current, c = sim.current; if (!cv || !c.s) return; const s = c.s;
      // animation only: a throwaway local store, so belts move between polls; nothing is sent anywhere
      const store = { get: () => 0, add: () => {} }; const now = Date.now() + c.skew;
      let n = 0; while (s.at + TICK_MS <= now && n++ < 8) { step(s, c.g, store); s.at += TICK_MS; } if (s.at + TICK_MS <= now) s.at = now - (now % TICK_MS);
      render(cv, c, Math.max(0, Math.min(1, (now - s.at) / TICK_MS)), t, ui.current);
    };
    raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
  }, [name]);
  useEffect(() => {
    const cv = cvRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const ro = new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(100, r.width * dpr); cv.height = Math.max(100, r.height * dpr); cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`; });
    ro.observe(wrap); return () => ro.disconnect();
  }, [name, v?.ok]);
  if (!name) return null;
  const close = () => setName(null); const s = v?.state;
  const machines = s ? s.ents.filter((e) => !LOGISTICS.has(e.k)) : [];
  const count = (k: Kind) => s?.ents.filter((e) => e.k === k).length ?? 0;
  const made = s ? Object.entries(s.made).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 8) : [];
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-3" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }} data-testid="factory-viewer">
      <div role="dialog" aria-label={`${name}'s factory (view only)`} className="factory-viewer-shell flex h-[85vh] h-[85dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#1b1d2e] text-cream shadow-2xl" data-drag-panel="factory-view" onPointerDown={dragView.onPointerDown} style={dragView.style()} ref={dragView.ref}>{dragView.handle}
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
          <h2 className="font-bold">🏭 {v?.name ?? name}'s factory</h2>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide opacity-80" data-testid="factory-viewer-readonly">View only</span>
          {s && <span className="text-xs opacity-70">Level {v?.level ?? 0} · Floor {FLOOR_LEVELS[s.floor]?.level ?? s.floor + 1} ({floorSize(s.floor)}×{floorSize(s.floor)}) · {v?.machines ?? machines.length} machines</span>}
          <button type="button" aria-label="Close" className="modal-shell-x ml-auto" onClick={close} data-testid="factory-viewer-close">✕</button>
        </div>
        {!v ? <p className="p-4 text-sm opacity-70">Loading {name}'s factory…</p> : !v.ok || !s ? <p className="p-4 text-sm opacity-80" data-testid="factory-viewer-error">{v.error ?? 'No factory.'}</p> : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div ref={wrapRef} className="relative min-h-[260px] flex-1"><canvas ref={cvRef} className="absolute inset-0" data-testid="factory-viewer-canvas" /></div>
            <aside className="w-full overflow-y-auto border-t border-white/10 p-3 text-sm md:w-72 md:border-l md:border-t-0">
              <h3 className="mb-1 font-semibold">⚙ Machines</h3>
              <ul className="space-y-0.5" data-testid="factory-viewer-machines">
                {machines.map((e) => { const r = frecipe(e.r); return <li key={e.id} className="flex justify-between gap-2"><span>{KIND_NAME[e.k]}</span><span className="text-right opacity-75">{r ? `${e.p ? '⏳ ' : ''}${r.name}` : 'idle (no recipe)'}</span></li>; })}
                {!machines.length && <li className="opacity-60">No machines placed.</li>}
              </ul>
              <h3 className="mb-1 mt-3 font-semibold">🛤 Logistics</h3>
              <p className="opacity-80">Belts {count('belt')} · Undergrounds {count('underground')} · Splitters {count('splitter')} · Inserters {count('inserter')} · Input chests {count('chest_in')} · Output chests {count('chest_out')} · Auto-sell chests {count('chest_sell')}</p>
              {s.ents.some((e) => e.k === 'chest_in' && e.f) && <p className="mt-1 opacity-70">Input chest filters: {[...new Set(s.ents.filter((e) => e.k === 'chest_in' && e.f).map((e) => nameOfKey(e.f!)))].join(', ')}</p>}
              {made.length > 0 && <><h3 className="mb-1 mt-3 font-semibold">📈 Made (lifetime)</h3><ul>{made.map(([k, q]) => <li key={k} className="flex justify-between"><span>{nameOfKey(k)}</span><b>{q.toLocaleString('en-US')}</b></li>)}</ul></>}
              <p className="mt-3 text-xs opacity-60">Read-only. You can't collect, move, build or edit anything here.</p>
            </aside>
          </div>
        )}
      </div>
    </div>, document.body);
}
