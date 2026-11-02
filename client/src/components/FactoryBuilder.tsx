import type React from 'react';
import { ItemIcon } from './ItemIcon';
import { FactoryRecipeSearch } from './FactoryRecipeSearch';
import { itemIconUriKey } from '../../../shared/itemIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ix, usePriceIndex } from '../lib/priceIndex';
import { socket } from '@/lib/net';
import { LOW, bolt, dropShadow, floorTiles, glow, hazard, lighting, metal, rrect, shade, sparks, steam, steel, vent } from '@/lib/factoryLook';
import { GOODS, type Stack } from '../../../shared/mines';
import { madeBy, tierOf, usedIn, CHEST_ITEMS, DX, DY, FLOOR_LEVELS, FRECIPES, KINDS, KIND_ORDER, TICK_MS, colorOfKey, floorSize, frecipe, gridOf, cellId, nameOfKey, priceOfKey, recipeTicks, recipesFor, step, canPlace, splitWeights, splitLabel, MAX_SPLIT_W, type Dir, type Ent, type FState, type Grid, type Kind, undergroundPairs } from '../../../shared/factory';

export type FAck = { ok: boolean; error?: string; state?: FState | null; level?: number; storage?: Stack[]; guest?: boolean; now?: number; result?: unknown };
type Tool = 'select' | 'remove' | Kind;
const ICON: Record<Kind, string> = { belt: '➡', underground: '⤵', splitter: '⑂', inserter: '🦾', chest_in: '📥', chest_out: '📤', smelter: '🔥', press: '🔨', roller: '⚙', drawer: '🧵', assembler: '🏗', jeweler: '💎', fabricator: '🏭', mill: '🌾', cannery: '🥫' };
const hash = (x: number, y: number) => { let h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0; h ^= h >>> 13; return (h % 1000) / 1000; };

/** Factorio-ish grid factory: server-authoritative sim, predicted locally between syncs. */
export function FactoryBuilder({ guest, flash, onStorage }: { guest: boolean; flash: (t: string) => void; onStorage: (s: Stack[]) => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sim = useRef<{ s: FState | null; g: Grid; store: Map<string, number>; skew: number; shown: number; shownFrom: number; shownAt: number }>({ s: null, g: new Map(), store: new Map(), skew: 0, shown: 0, shownFrom: 0, shownAt: 0 });
  const pidx = usePriceIndex();
  const [level, setLevel] = useState(0);
  const [fs, setFs] = useState<FState | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [dir, setDir] = useState<Dir>(0);
  const [sel, setSel] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [side, setSide] = useState<'build' | 'shop' | 'recipes' | 'import'>('build');
  const [chain, setChain] = useState<string>('');
  const [buyN, setBuyN] = useState(1);
  const ui = useRef({ tool, dir, sel, moving, hover: null as null | [number, number], drag: [] as Array<{ x: number; y: number; d: Dir }>, dragging: false, removing: new Set<number>(), z: 1, px: 0, py: 0, pan: null as null | { x: number; y: number; px: number; py: number; moved: boolean; btn: number }, pts: new Map<number, { x: number; y: number }>(), pinch: null as null | { d: number; z: number; cx: number; cy: number; px: number; py: number }, space: false, mini: null as null | { x: number; y: number; w: number; s: number } });
  const [zoomed, setZoomed] = useState(false);
  ui.current.tool = tool; ui.current.dir = dir; ui.current.sel = sel; ui.current.moving = moving;

  const apply = (r?: FAck) => {
    if (!r) return;
    if (r.storage) { onStorage(r.storage); sim.current.store = new Map(r.storage.map((x) => [`${x.type}:${x.id}`, x.qty])); }
    if (r.level !== undefined) setLevel(r.level);
    if (r.state !== undefined) {
      const c = sim.current; const s = r.state ? (JSON.parse(JSON.stringify(r.state)) as FState) : null;
      if (s) { const size = floorSize(s.floor); if (size !== c.shown) { c.shownFrom = c.shown || size; c.shown = size; c.shownAt = performance.now(); } }
      c.s = s; c.g = s ? gridOf(s) : new Map(); if (r.now) c.skew = r.now - Date.now(); setFs(s);
    }
  };
  const call = (ev: string, body: object, ok?: (r: FAck) => void) => socket.timeout(6000).emit(ev, body, (err: Error | null, r?: FAck) => {
    if (err || !r) return flash('Factory busy, try again.');
    apply(r); if (!r.ok) return flash(r.error ?? 'Failed.'); ok?.(r);
  });
  useEffect(() => { if (guest) return; call('fac_state', {}); const t = window.setInterval(() => call('fac_state', {}), 3000); return () => window.clearInterval(t); }, [guest]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- render loop
  useEffect(() => {
    let raf = 0; let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 28) return; last = t;
      const cv = cvRef.current; const c = sim.current; if (!cv) return;
      const s = c.s; const store = { get: (k: string) => c.store.get(k) ?? 0, add: (k: string, d: number) => c.store.set(k, (c.store.get(k) ?? 0) + d) };
      const now = Date.now() + c.skew;
      if (s) { let n = 0; while (s.at + TICK_MS <= now && n++ < 8) { step(s, c.g, store); s.at += TICK_MS; } if (s.at + TICK_MS <= now) s.at = now - (now % TICK_MS); }
      const frac = s ? Math.max(0, Math.min(1, (now - s.at) / TICK_MS)) : 0;
      render(cv, c, frac, t, ui.current);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  // canvas size
  useEffect(() => {
    const cv = cvRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const ro = new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(100, r.width * dpr); cv.height = Math.max(100, r.height * dpr); cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`; });
    ro.observe(wrap); return () => ro.disconnect();
  }, [fs !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA')) return;
      if (!sim.current.s) return;
      if (e.key === ' ') { e.preventDefault(); ui.current.space = true; return; }
      const k = e.key.toLowerCase();
      if (k === '0') { resetView(); return; }
      if (k === '=' || k === '+' || k === '-') { zoomAt(null, k === '-' ? 1 / 1.25 : 1.25); return; }
      if (k === 'r') { e.preventDefault(); const u = ui.current; if (u.tool === 'select' && u.hover) { const ent = sim.current.g.get(cellId(u.hover[0], u.hover[1])); if (ent) { call('fac_edit', { id: ent.id, d: (ent.d + (e.shiftKey ? 3 : 1)) % 4 }); return; } } setDir((d) => ((d + (e.shiftKey ? 3 : 1)) % 4) as Dir); }
      else if (k === 'escape' || k === 'q') { setTool('select'); setMoving(null); }
      else if (k === 'x') setTool('remove');
      else if (k === 'b') setTool('belt');
      else if (k === 'i') setTool('inserter');
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') ui.current.space = false; };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canvasXY = (ev: { clientX: number; clientY: number }) => { const cv = cvRef.current!; const r = cv.getBoundingClientRect(); const dpr = cv.width / r.width; return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr] as const; };
  const cellAt = (ev: { clientX: number; clientY: number }): [number, number] | null => {
    const cv = cvRef.current; const s = sim.current.s; if (!cv || !s) return null;
    const L = view(cv.width, cv.height, floorSize(s.floor), ui.current); const [mx, my] = canvasXY(ev);
    return [Math.floor((mx - L.ox) / L.ts), Math.floor((my - L.oy) / L.ts)];
  };
  /** Zoom by `f` around a canvas point (or the centre), keeping that point fixed. */
  const zoomAt = (pt: readonly [number, number] | null, f: number) => {
    const cv = cvRef.current; const s = sim.current.s; if (!cv || !s) return; const u = ui.current;
    const size = floorSize(s.floor); const before = view(cv.width, cv.height, size, u);
    const [mx, my] = pt ?? [cv.width / 2, cv.height / 2];
    const wx = (mx - before.ox) / before.ts, wy = (my - before.oy) / before.ts;
    u.z = Math.max(1, Math.min(ZMAX, u.z * f));
    const after = view(cv.width, cv.height, size, { ...u, px: 0, py: 0 });
    u.px = mx - wx * after.ts - after.ox; u.py = my - wy * after.ts - after.oy; clampPan(); setZoomed(u.z > 1.01);
  };
  const clampPan = () => {
    const cv = cvRef.current; const s = sim.current.s; if (!cv || !s) return; const u = ui.current;
    const L = view(cv.width, cv.height, floorSize(s.floor), { ...u, px: 0, py: 0 }); const span = L.ts * floorSize(s.floor);
    const lim = (W: number) => Math.max(0, (span - W) / 2 + W * 0.25);
    u.px = Math.max(-lim(cv.width), Math.min(lim(cv.width), u.px)); u.py = Math.max(-lim(cv.height), Math.min(lim(cv.height), u.py));
  };
  const resetView = () => { const u = ui.current; u.z = 1; u.px = 0; u.py = 0; setZoomed(false); };
  // wheel needs a non-passive listener to stop page scroll
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); zoomAt(canvasXY(ev), Math.exp(-Math.max(-60, Math.min(60, ev.deltaY)) * 0.0045)); };
    cv.addEventListener('wheel', onWheel, { passive: false }); return () => cv.removeEventListener('wheel', onWheel);
  }, [fs !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Minimap click: centre the view there. */
  const miniHit = (mx: number, my: number) => {
    const m = ui.current.mini; const cv = cvRef.current; const s = sim.current.s; if (!m || !cv || !s) return false;
    if (mx < m.x || my < m.y || mx > m.x + m.w || my > m.y + m.w) return false;
    const size = floorSize(s.floor); const cx = (mx - m.x) / m.s, cy = (my - m.y) / m.s; const u = ui.current;
    const L = view(cv.width, cv.height, size, { ...u, px: 0, py: 0 });
    u.px = cv.width / 2 - cx * L.ts - L.ox; u.py = cv.height / 2 - cy * L.ts - L.oy; clampPan(); return true;
  };
  const onDown = (ev: React.PointerEvent) => {
    const c = cellAt(ev); if (!c) return; const u = ui.current; u.hover = c;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    const [mx, my] = canvasXY(ev);
    u.pts.set(ev.pointerId, { x: mx, y: my });
    if (u.pts.size === 2) { // two fingers: pinch-zoom + pan; cancel any one-finger action
      const [a, b] = [...u.pts.values()]; u.dragging = false; u.drag = []; u.removing = new Set(); u.pan = null;
      u.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: u.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: u.px, py: u.py }; return;
    }
    if (ev.button === 0 && miniHit(mx, my)) { u.pan = { x: mx, y: my, px: u.px, py: u.py, moved: true, btn: -1 }; return; }
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && u.space)) { ev.preventDefault(); u.pan = { x: mx, y: my, px: u.px, py: u.py, moved: false, btn: ev.button }; return; }
    if (u.tool === 'remove') { u.dragging = true; u.removing = new Set(); const e = sim.current.g.get(cellId(c[0], c[1])); if (e) u.removing.add(e.id); return; }
    if (u.tool === 'belt') { u.dragging = true; u.drag = [{ x: c[0], y: c[1], d: u.dir }]; return; }
  };
  const onMove = (ev: React.PointerEvent) => {
    const u = ui.current;
    if (u.pts.has(ev.pointerId)) { const [mx, my] = canvasXY(ev); u.pts.set(ev.pointerId, { x: mx, y: my }); }
    if (u.pinch && u.pts.size >= 2) {
      const [a, b] = [...u.pts.values()]; const p = u.pinch; const cv = cvRef.current; const s = sim.current.s; if (!cv || !s) return;
      const size = floorSize(s.floor); const before = view(cv.width, cv.height, size, { ...u, z: p.z, px: p.px, py: p.py });
      const wx = (p.cx - before.ox) / before.ts, wy = (p.cy - before.oy) / before.ts;
      u.z = Math.max(1, Math.min(ZMAX, p.z * (Math.hypot(a.x - b.x, a.y - b.y) / p.d)));
      const after = view(cv.width, cv.height, size, { ...u, px: 0, py: 0 }); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      u.px = cx - wx * after.ts - after.ox; u.py = cy - wy * after.ts - after.oy; clampPan(); setZoomed(u.z > 1.01); return;
    }
    if (u.pan) {
      const [mx, my] = canvasXY(ev);
      if (u.pan.btn === -1) { miniHit(mx, my); return; }
      if (!u.pan.moved && Math.hypot(mx - u.pan.x, my - u.pan.y) > 6) u.pan.moved = true;
      if (u.pan.moved) { u.px = u.pan.px + (mx - u.pan.x); u.py = u.pan.py + (my - u.pan.y); clampPan(); }
      return;
    }
    const c = cellAt(ev); u.hover = c; if (!c || !u.dragging) return;
    if (u.removing.size || u.tool === 'remove') { const e = sim.current.g.get(cellId(c[0], c[1])); if (e) u.removing.add(e.id); return; }
    if (u.tool === 'belt') {
      const lastC = u.drag[u.drag.length - 1]; if (lastC.x === c[0] && lastC.y === c[1]) return;
      // walk an L path to the pointer so fast drags don't skip tiles
      let { x, y } = lastC; let guard = 0;
      while ((x !== c[0] || y !== c[1]) && guard++ < 64) {
        const dx = Math.sign(c[0] - x), dy = dx ? 0 : Math.sign(c[1] - y);
        const d: Dir = dx > 0 ? 0 : dx < 0 ? 2 : dy > 0 ? 1 : 3;
        u.drag[u.drag.length - 1].d = d; x += dx; y += dy;
        if (u.drag.some((p) => p.x === x && p.y === y)) break;
        u.drag.push({ x, y, d });
      }
      setDir(u.drag[u.drag.length - 1].d);
    }
  };
  const onUp = (ev: React.PointerEvent) => {
    const u = ui.current; const c = cellAt(ev); const s = sim.current.s;
    u.pts.delete(ev.pointerId);
    if (u.pinch) { if (u.pts.size < 2) u.pinch = null; return; }
    if (u.pan) {
      const p = u.pan; u.pan = null; if (p.moved || p.btn !== 2) return;
      // right-click without dragging: pick up what's under the cursor
      if (c) { const e = sim.current.g.get(cellId(c[0], c[1])); if (e) { call('fac_remove', { ids: [e.id] }); if (e.id === sel) setSel(null); } }
      return;
    }
    if (u.dragging) {
      u.dragging = false;
      if (u.removing.size) { const ids = [...u.removing]; u.removing = new Set(); call('fac_remove', { ids }); if (ids.includes(sel ?? -1)) setSel(null); return; }
      if (u.tool === 'belt' && u.drag.length) { const items = u.drag.filter((p) => !sim.current.g.get(cellId(p.x, p.y))).map((p) => ({ k: 'belt', x: p.x, y: p.y, d: p.d })); u.drag = []; if (items.length) call('fac_place', { items }); return; }
    }
    if (!c || !s) return;
    if (moving !== null) { const e = s.ents.find((x) => x.id === moving); if (e) { const off = KINDS[e.k].size === 2 ? 0 : 0; call('fac_edit', { id: e.id, x: c[0] - off, y: c[1] - off, d: dir }, () => setMoving(null)); } return; }
    if (u.tool === 'select') { const e = sim.current.g.get(cellId(c[0], c[1])); setSel(e ? e.id : null); return; }
    if (u.tool !== 'remove') {
      const k = u.tool; const extra: Record<string, unknown> = {};
      if (KINDS[k].machine) extra.r = recipesFor(k)[0]?.id;
      call('fac_place', { items: [{ k, x: c[0], y: c[1], d: dir, ...extra }] }, (r) => { const ent = r.state?.ents.find((e) => e.x === c[0] && e.y === c[1]); if (ent && (KINDS[k].machine || k === 'chest_in')) { setSel(ent.id); } if ((r.state?.kit[k] ?? 0) < 1) setTool('select'); });
    }
  };

  const selEnt = fs?.ents.find((e) => e.id === sel) ?? null;
  const storageList = useMemo(() => CHEST_ITEMS, []);
  if (guest) return <p className="mines-note">Sign in to build a factory.</p>;
  if (!fs) return (
    <div className="fac-empty" data-testid="fac-empty">
      <h3>🏭 Your factory building</h3>
      <p className="mines-note">Lay belts, place smelters, presses and rollers, and chain ore into ingots, plates, rods, wire, gears, circuits, jewelry and engines. It keeps running while you're offline (up to 8 hours), feeding from your banked storage.</p>
      {level === 0 && <button type="button" className="mines-sell" onClick={() => call('fac_expand', {}, () => flash('Factory built! You got a starter kit.'))} data-testid="fac-build">Buy the building (12×12) · 🪙 {ix(FLOOR_LEVELS[0].cost, pidx)}</button>}
      {level > 0 && <p className="mines-note">Loading…</p>}
    </div>
  );
  const next = FLOOR_LEVELS[fs.floor];
  const kitN = (k: Kind) => fs.kit[k] ?? 0;
  return (
    <div className="fac" data-testid="fac">
      <div className="fac-top">
        <span className="fac-chip">🏭 {floorSize(fs.floor)}×{floorSize(fs.floor)}</span>
        {next && <button type="button" className="fac-btn" onClick={() => call('fac_expand', {}, () => flash(`Walls pushed out to ${next.size}×${next.size}!`))} data-testid="fac-expand">Expand to {next.size}×{next.size} · 🪙 {ix(next.cost, pidx).toLocaleString()}</button>}
        <span className="fac-tools">
          <button type="button" className={tool === 'select' ? 'on' : ''} onClick={() => { setTool('select'); setMoving(null); }} title="Select (Esc)">👆</button>
          <button type="button" className={tool === 'remove' ? 'on' : ''} onClick={() => setTool('remove')} title="Pick up (X / right-click, drag for many)" data-testid="fac-remove">🧲</button>
          <button type="button" onClick={() => setDir((d) => ((d + 1) % 4) as Dir)} title="Rotate (R)" data-testid="fac-rotate">⟳ {['→', '↓', '←', '↑'][dir]}</button>
        </span>
      </div>
      <div className="fac-main">
        <div className="fac-canvas" ref={wrapRef}>
          <canvas ref={cvRef} data-testid="fac-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(ev) => { const u = ui.current; u.pts.delete(ev.pointerId); if (u.pts.size < 2) u.pinch = null; u.pan = null; }} onPointerLeave={() => { ui.current.hover = null; }} onContextMenu={(e) => e.preventDefault()} />
          <div className="fac-zoom">
            <button type="button" onClick={() => zoomAt(null, 1.25)} title="Zoom in (wheel / pinch / +)" data-testid="fac-zoom-in">＋</button>
            <button type="button" onClick={() => zoomAt(null, 0.8)} title="Zoom out (−)" data-testid="fac-zoom-out">－</button>
            {zoomed && <button type="button" onClick={resetView} title="Fit whole floor (0)" data-testid="fac-zoom-fit">⤢</button>}
          </div>
          {moving !== null && <div className="fac-hint">Click where to move it (R rotates) · Esc cancels</div>}
        </div>
        <aside className="fac-side">
          <div className="fac-tabs">
            {(['build', 'shop', 'recipes', 'import'] as const).map((t) => <button type="button" key={t} className={side === t ? 'on' : ''} onClick={() => setSide(t)} data-testid={`fac-tab-${t}`}>{t === 'build' ? '🧰 Build' : t === 'shop' ? '🛒 Machinist' : t === 'recipes' ? '📜 Recipes' : '🚚 Bring in'}</button>)}
          </div>
          {selEnt && <Inspect e={selEnt} storage={storageList} store={sim.current.store} onEdit={(b) => call('fac_edit', { id: selEnt.id, ...b })} onRemove={() => { call('fac_remove', { ids: [selEnt.id] }); setSel(null); }} onMove={() => { setMoving(selEnt.id); setDir(selEnt.d); }} onClose={() => setSel(null)} />}
          {side === 'build' && <div className="fac-palette">
            {KIND_ORDER.map((k) => (
              <button type="button" key={k} disabled={!kitN(k)} className={tool === k ? 'on' : ''} onClick={() => { setTool(k); setSel(null); }} title={KINDS[k].desc} data-testid={`fac-pal-${k}`}>
                <span className="fac-ic">{ICON[k]}</span><span>{KINDS[k].name}</span><b>×{kitN(k)}</b>
              </button>
            ))}
            <p className="mines-note">Click to place, R rotates, drag belts. Inserters grab from behind and drop in front (set a filter to grab one item only). Undergrounds pair with the next one ahead facing the same way, up to 5 tiles, so belts can cross. Machines push output out the side their arrow faces. Wheel or pinch to zoom; right/middle-drag, Space-drag or two fingers to pan.</p>
          </div>}
          {side === 'shop' && <div className="fac-shop" data-testid="fac-shop">
            <div className="fac-buyn">Buy {[1, 5, 10, 25].map((n) => <button type="button" key={n} className={buyN === n ? 'on' : ''} onClick={() => setBuyN(n)}>×{n}</button>)}</div>
            {KIND_ORDER.map((k) => { const d = KINDS[k]; const locked = fs.floor < d.minFloor; return (
              <div key={k} className="fac-shoprow"><span className="fac-ic">{ICON[k]}</span><span><b>{d.name}</b><small>{locked ? `Unlocks at building level ${d.minFloor}` : d.desc}</small></span>
                <button type="button" disabled={locked} onClick={() => call('fac_buy', { kind: k, n: buyN }, () => flash(`Bought ${buyN}× ${d.name}`))} data-testid={`fac-buy-${k}`}>🪙 {(ix(d.cost, pidx) * buyN).toLocaleString()}</button></div>
            ); })}
          </div>}
          {side === 'recipes' && <div className="fac-recipes" data-testid="fac-recipes">
            <FactoryRecipeSearch icons={ICON} pick={(k) => { setChain(k); window.setTimeout(() => document.querySelector('[data-testid=fac-chain]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0); }} />
            <label className="fac-chainpick">Show chain for <select value={chain} onChange={(ev) => setChain(ev.target.value)} data-testid="fac-chain-pick">
              <option value="">— pick a product —</option>
              {FRECIPES.map((r) => r.out[0]).filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => tierOf(a) - tierOf(b) || nameOfKey(a).localeCompare(nameOfKey(b))).map((k) => <option key={k} value={k}>T{tierOf(k)} · {nameOfKey(k)}</option>)}
            </select></label>
            {chain && <Chain k={chain} pick={setChain} />}
            {KIND_ORDER.filter((k) => KINDS[k].machine).map((k) => (
              <div key={k}><h4>{ICON[k]} {KINDS[k].name}{KINDS[k].minFloor > 1 ? <small> · level {KINDS[k].minFloor}+</small> : null}</h4>
                {recipesFor(k).map((r) => <div key={r.id} className="fac-rec" title={recTip(r.out[0])} onClick={() => setChain(r.out[0])}><span>{r.in.map(([key, q]) => <i key={key}><Dot k={key} />{q} {nameOfKey(key)}</i>)}</span><span>→ <Dot k={r.out[0]} />{r.out[1]} {nameOfKey(r.out[0])} <small>T{tierOf(r.out[0])} · {r.secs}s · 🪙{ix(priceOfKey(r.out[0]), pidx)}</small></span></div>)}
              </div>
            ))}
          </div>}
          {side === 'import' && <div className="fac-import" data-testid="fac-import">
            <p className="mines-note">Bring resources in from the rest of the game. They land in your banked storage, where an Input Chest can pull them. Ore from every cave (The Mine, Frostbite, Magma, Coral Grotto) is already there when you bank it.</p>
            <button type="button" className="fac-btn" onClick={() => call('fac_import_farm', {}, (r) => { const g = (r.result as { toFactory?: Array<[string, number]> } | undefined)?.toFactory ?? []; flash(`Sent to the factory: ${g.map(([id, n]) => `${n} ${nameOfKey(`good:${id}`)}`).join(', ')}`); })} data-testid="fac-import-farm">🌾 Harvest every ready crop into the factory</button>
            <small className="mines-note">Instead of selling them: no chips now and no farm tier used. Plantation crops only while you're at Chud Resort.</small>
            <button type="button" className="fac-btn" onClick={() => call('fac_import_fish', {}, (r) => { const g = (r.result as { items?: Array<[string, number]>; moved?: number } | undefined); flash(`Moved ${g?.moved ?? 0} fish: ${(g?.items ?? []).map(([id, n]) => `${n} ${nameOfKey(`good:${id}`)}`).join(', ')}`); })} data-testid="fac-import-fish">🐟 Send my cooler to the factory</button>
            <small className="mines-note">Raw fish become Fish Fillets (1 per 8 chips of value), cooked dishes become Cooked Fish Portions (1 per 10). Junk stays. Imported crops and fish can't be sold raw to the house: craft them.</small>
            <h4>Imported stock</h4>
            <ul className="fac-stock">{CHEST_ITEMS.filter((k) => isRawKey(k) && (sim.current.store.get(k) ?? 0) > 0).map((k) => <li key={k}><Dot k={k} />{sim.current.store.get(k)} {nameOfKey(k)}</li>)}</ul>
          </div>}
        </aside>
      </div>
    </div>
  );
}

const recTip = (k: string) => { const u = usedIn(k); return `${nameOfKey(k)} (tier ${tierOf(k)})${u.length ? `\nUsed in: ${u.map((r) => nameOfKey(r.out[0])).join(', ')}` : '\nEnd product: sell it'}`; };
const isRawKey = (k: string) => { const [t, id] = k.split(':'); return t !== 'ore' && !!GOODS[id]?.raw; };
/** Recipe tree for one product: what makes it (recursively, down to raw inputs) and what it feeds. */
function Chain({ k, pick }: { k: string; pick: (k: string) => void }) {
  const node = (key: string, q: number, depth: number): React.ReactElement => { const r = madeBy(key); return (
    <li key={`${key}:${depth}`}><button type="button" className="fac-chainitem" onClick={() => r && pick(key)}><Dot k={key} />{q}× {nameOfKey(key)}</button>{r ? <small> ({ICON[r.machine]} {KINDS[r.machine].name}, {r.secs}s)</small> : <small> · raw</small>}
      {r && depth < 6 && <ul>{r.in.map(([ik, iq]) => node(ik, iq, depth + 1))}</ul>}</li>); };
  const r = madeBy(k); const u = usedIn(k);
  return (
    <div className="fac-chain" data-testid="fac-chain">
      <ul>{node(k, r?.out[1] ?? 1, 0)}</ul>
      <p className="mines-note">{u.length ? <>Feeds: {u.map((x) => <button type="button" key={x.id} className="fac-chainitem" onClick={() => pick(x.out[0])}><Dot k={x.out[0]} />{nameOfKey(x.out[0])}</button>)}</> : 'End product — sell it from storage.'}</p>
    </div>
  );
}

function Dot({ k }: { k: string }) { return <ItemIcon k={k} size={16} />; }

function Inspect({ e, storage, store, onEdit, onRemove, onMove, onClose }: { e: Ent; storage: string[]; store: Map<string, number>; onEdit: (b: object) => void; onRemove: () => void; onMove: () => void; onClose: () => void }) {
  const d = KINDS[e.k]; const r = frecipe(e.r);
  return (
    <div className="fac-inspect" data-testid="fac-inspect">
      <div className="fac-ihead"><b>{ICON[e.k]} {d.name}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
      {d.machine && <label>Recipe <select value={e.r ?? ''} onChange={(ev) => onEdit({ r: ev.target.value })} data-testid="fac-recipe">
        {!e.r && <option value="">— pick —</option>}
        {recipesFor(e.k).map((x) => <option key={x.id} value={x.id}>{x.out[1]}× {nameOfKey(x.out[0])} ← {x.in.map(([k, q]) => `${q} ${nameOfKey(k)}`).join(' + ')}</option>)}
      </select></label>}
      {d.machine && r && <div className="fac-buf">
        {r.in.map(([k, q]) => <span key={k}><Dot k={k} />{e.ib?.[k] ?? 0}/{q}</span>)}
        <span>→ <Dot k={r.out[0]} />{e.ob ?? 0}/{r.out[1]} ready{(e.ob ?? 0) > 0 && <b className="fac-backed" data-testid="fac-backed"> · backed up — waiting for pickup</b>}</span>
        <div className="mines-bar"><i style={{ width: `${((e.p ?? 0) / recipeTicks(r)) * 100}%` }} /></div>
      </div>}
      {e.k === 'inserter' && <label>Only grab <select value={e.f ?? ''} onChange={(ev) => onEdit({ f: ev.target.value || null })} data-testid="fac-ins-filter">
        <option value="">— anything —</option>
        {storage.map((k) => <option key={k} value={k}>{nameOfKey(k)}</option>)}
      </select></label>}
      {e.k === 'splitter' && <SplitRatio e={e} onEdit={onEdit} />}
      {e.k === 'underground' && <p className="mines-note">Pairs with the next underground ahead facing the same way (2–6 tiles). Items skip everything in between.</p>}
      {e.k === 'chest_out' && <label>Only accept <select value={e.f ?? ''} onChange={(ev) => onEdit({ f: ev.target.value || null })} data-testid="fac-out-filter">
        <option value="">— anything —</option>
        {storage.map((k) => <option key={k} value={k}>{nameOfKey(k)}</option>)}
      </select></label>}
      {e.k === 'chest_in' && <label>Pulls <select value={e.f ?? ''} onChange={(ev) => onEdit({ f: ev.target.value || null })} data-testid="fac-filter">
        <option value="">— nothing —</option>
        {storage.map((k) => <option key={k} value={k}>{nameOfKey(k)} ({store.get(k) ?? 0} banked)</option>)}
      </select></label>}
      <div className="fac-iact">
        <button type="button" onClick={() => onEdit({ d: (e.d + 1) % 4 })}>⟳ Rotate</button>
        <button type="button" onClick={onMove}>✥ Move</button>
        <button type="button" onClick={onRemove}>🧲 Pick up</button>
      </div>
    </div>
  );
}

const SPLIT_PRESETS: Array<[string, [number, number, number]]> = [['Even 1:1:1', [1, 1, 1]], ['L/R 1:1', [1, 0, 1]], ['2:1', [2, 0, 1]], ['3:1', [3, 0, 1]], ['Ahead 2:1:1', [1, 2, 1]]];
function SplitRatio({ e, onEdit }: { e: Ent; onEdit: (b: object) => void }) {
  const w = splitWeights(e); const set = (nw: [number, number, number]) => { if (nw.some((n) => n > 0)) onEdit({ w: nw }); };
  return (
    <div className="fac-ratio" data-testid="fac-split-ratio">
      <div>Ratio <b data-testid="fac-split-label">{splitLabel(e)}</b> <small>(left : ahead : right)</small></div>
      <div className="fac-iact">{SPLIT_PRESETS.map(([n, p]) => <button key={n} type="button" aria-pressed={p.join() === w.join()} onClick={() => set(p)}>{n}</button>)}</div>
      <div className="fac-iact">{(['Left', 'Ahead', 'Right'] as const).map((n, i) => <label key={n}>{n} <input type="number" min={0} max={MAX_SPLIT_W} step={1} value={w[i]} data-testid={`fac-split-w${i}`}
        onChange={(ev) => { const v = Math.max(0, Math.min(MAX_SPLIT_W, Math.floor(Number(ev.target.value) || 0))); const nw = [...w] as [number, number, number]; nw[i] = v; set(nw); }} style={{ width: '3em', background: 'rgba(0,0,0,.4)', border: '1px solid #666', borderRadius: 4, color: 'inherit', padding: '0 4px' }} /></label>)}</div>
      <p className="mines-note">Items go out in this ratio, in a fixed repeating order. 0 shuts an output. If the next output is full, the item takes the next free one.</p>
    </div>
  );
}

// ------------------------------------------------------------------ rendering
const ZMAX = 5;
function view(w: number, h: number, size: number, u: { z: number; px: number; py: number }) { const L = layout(w, h, size); const ts = Math.max(6, Math.round(L.ts * u.z)); return { ts, ox: Math.floor((w - ts * size) / 2 + u.px), oy: Math.floor((h - ts * size) / 2 + u.py) }; }
function layout(w: number, h: number, size: number) { const pad = Math.min(w, h) * 0.05 + 14; const ts = Math.max(6, Math.floor(Math.min((w - pad * 2) / size, (h - pad * 2) / size))); return { ts, ox: Math.floor((w - ts * size) / 2), oy: Math.floor((h - ts * size) / 2) }; }
type SimRef = { s: FState | null; g: Grid; store: Map<string, number>; shown: number; shownFrom: number; shownAt: number };
type UiRef = { tool: Tool; dir: Dir; sel: number | null; moving: number | null; hover: null | [number, number]; drag: Array<{ x: number; y: number; d: Dir }>; removing: Set<number>; z: number; px: number; py: number; mini: null | { x: number; y: number; w: number; s: number } };

function render(cv: HTMLCanvasElement, c: SimRef, frac: number, t: number, u: UiRef) {
  const ctx = cv.getContext('2d'); const s = c.s; if (!ctx || !s) return;
  const W = cv.width, H = cv.height; const size = floorSize(s.floor);
  const L = view(W, H, size, u); const ts = L.ts;
  // wall animation: shown size eases from old to new
  const k = Math.min(1, (performance.now() - c.shownAt) / 1400); const ease = 1 - (1 - k) ** 3;
  const vis = c.shownFrom + (size - c.shownFrom) * ease;
  ctx.fillStyle = '#121416'; ctx.fillRect(0, 0, W, H);
  // exterior gravel
  for (let i = 0; i < 160; i++) { const x = hash(i, 7) * W, y = hash(i, 13) * H; ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(x, y, 3, 3); }
  const X = (x: number) => L.ox + x * ts, Y = (y: number) => L.oy + y * ts;
  // floor (polished concrete tiles)
  const tiles = floorTiles();
  const x0 = Math.max(0, Math.floor(-L.ox / ts)), y0 = Math.max(0, Math.floor(-L.oy / ts)), x1 = Math.min(size, Math.ceil((W - L.ox) / ts)), y1 = Math.min(size, Math.ceil((H - L.oy) / ts));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (x >= vis || y >= vis) continue;
    const v = hash(x, y); const tl = tiles?.[Math.floor(v * 4) % 4];
    if (tl) ctx.drawImage(tl, X(x), Y(y), ts, ts);
    else { ctx.fillStyle = `rgb(${46 + v * 10},${48 + v * 10},${50 + v * 9})`; ctx.fillRect(X(x), Y(y), ts, ts); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(X(x), Y(y), ts, 1); ctx.fillRect(X(x), Y(y), 1, ts); }
  }
  // painted walkway lines one tile in from the walls
  if (vis >= 6) { ctx.strokeStyle = 'rgba(231,180,22,.28)'; ctx.lineWidth = Math.max(1, ts * 0.06); ctx.setLineDash([ts * 0.5, ts * 0.3]); ctx.strokeRect(L.ox + ts * 0.5, L.oy + ts * 0.5, vis * ts - ts, vis * ts - ts); ctx.setLineDash([]); }
  // walls (hazard-striped band, moves out on expansion)
  const wt = Math.max(6, ts * 0.6); const wx = L.ox - wt, wy = L.oy - wt, ww = vis * ts + wt * 2;
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, ww); ctx.rect(L.ox, L.oy, vis * ts, vis * ts); ctx.clip('evenodd');
  drawWalls(ctx, wx, wy, ww, wt, ts, L.ox, L.oy, vis, t);
  ctx.restore();
  ctx.strokeStyle = '#1b1d20'; ctx.lineWidth = 2; ctx.strokeRect(wx, wy, ww, ww); ctx.strokeRect(L.ox, L.oy, vis * ts, vis * ts);
  if (k < 1) { ctx.fillStyle = `rgba(255,210,80,${0.5 * (1 - k)})`; ctx.font = `bold ${Math.max(14, ts)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('EXPANDING', L.ox + (vis * ts) / 2, L.oy + (vis * ts) / 2); }
  const anim = t / TICK_MS; // belt chevron phase
  // belts first, then items, then buildings
  const off = (e: Ent) => { const n = KINDS[e.k].size; return X(e.x + n) < 0 || Y(e.y + n) < 0 || X(e.x) > W || Y(e.y) > H; };
  const pairs = undergroundPairs(s, c.g);
  for (const e of s.ents) if ((e.k === 'belt' || e.k === 'splitter') && !off(e)) drawBelt(ctx, e, X(e.x), Y(e.y), ts, anim);
  // underground tunnels: dashed line between paired hoods
  ctx.save(); ctx.setLineDash([ts * 0.18, ts * 0.14]); ctx.strokeStyle = 'rgba(176,138,32,.55)'; ctx.lineWidth = Math.max(1, ts * 0.1);
  for (const [id, out] of pairs) { const a = s.ents.find((x) => x.id === id); if (!a) continue; ctx.beginPath(); ctx.moveTo(X(a.x) + ts / 2, Y(a.y) + ts / 2); ctx.lineTo(X(out.x) + ts / 2, Y(out.y) + ts / 2); ctx.stroke(); }
  ctx.restore();
  const exits = new Set([...pairs.values()].map((x) => x.id));
  for (const e of s.ents) if (e.k === 'underground' && !off(e)) drawUnderground(ctx, e, X(e.x), Y(e.y), ts, anim, pairs.has(e.id) ? 'in' : exits.has(e.id) ? 'out' : 'none');
  for (const e of s.ents) {
    if (off(e)) continue;
    if (e.k === 'belt' || e.k === 'splitter' || e.k === 'underground') { if (e.it) { const back = e.m ? 1 - frac : 0; const md = e.m ? e.m - 1 : e.d; drawItem(ctx, e.it, X(e.x) + ts / 2 - DX[md] * ts * back, Y(e.y) + ts / 2 - DY[md] * ts * back, ts * 0.34); } }
  }
  for (const e of s.ents) if (e.k === 'splitter' && !off(e)) drawSplitLabel(ctx, e, X(e.x), Y(e.y), ts);
  for (const e of s.ents) {
    if (off(e)) continue;
    const px = X(e.x), py = Y(e.y);
    if (e.k === 'inserter') drawInserter(ctx, e, px, py, ts, frac);
    else if (e.k === 'chest_in' || e.k === 'chest_out') drawChest(ctx, e, px, py, ts);
    else if (KINDS[e.k].machine) drawMachine(ctx, e, px, py, ts, t);
    if (u.sel === e.id || u.removing.has(e.id)) { const sz = KINDS[e.k].size * ts; ctx.strokeStyle = u.removing.has(e.id) ? '#ff5050' : '#ffe066'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, sz - 2, sz - 2); }
  }
  lighting(ctx, L.ox, L.oy, ts, vis, W, H);
  // ghost
  const h = u.hover; const g = c.g;
  if (u.drag.length) for (const p of u.drag) { ctx.globalAlpha = 0.6; drawBelt(ctx, { id: -1, k: 'belt', x: p.x, y: p.y, d: p.d }, X(p.x), Y(p.y), ts, anim); ctx.globalAlpha = 1; if (g.get(cellId(p.x, p.y)) || p.x < 0 || p.y < 0 || p.x >= size || p.y >= size) { ctx.fillStyle = 'rgba(255,60,60,.35)'; ctx.fillRect(X(p.x), Y(p.y), ts, ts); } }
  else if (h && (u.moving !== null || (u.tool !== 'select' && u.tool !== 'remove'))) {
    const me = u.moving !== null ? s.ents.find((e) => e.id === u.moving) : null; const kind = (me ? me.k : u.tool) as Kind;
    const bad = canPlace(s, g, kind, h[0], h[1], u.dir, me?.id);
    const sz = KINDS[kind].size * ts; ctx.globalAlpha = 0.55;
    const ghost: Ent = { id: -1, k: kind, x: h[0], y: h[1], d: u.dir };
    if (kind === 'underground') drawUnderground(ctx, ghost, X(h[0]), Y(h[1]), ts, anim, 'none'); else if (kind === 'belt' || kind === 'splitter') drawBelt(ctx, ghost, X(h[0]), Y(h[1]), ts, anim); else if (kind === 'inserter') drawInserter(ctx, ghost, X(h[0]), Y(h[1]), ts, 0); else if (KINDS[kind].machine) drawMachine(ctx, ghost, X(h[0]), Y(h[1]), ts, t); else drawChest(ctx, ghost, X(h[0]), Y(h[1]), ts);
    ctx.globalAlpha = 1; ctx.fillStyle = bad ? 'rgba(255,60,60,.3)' : 'rgba(80,255,120,.18)'; ctx.fillRect(X(h[0]), Y(h[1]), sz, sz);
  } else if (h && h[0] >= 0 && h[1] >= 0 && h[0] < size && h[1] < size) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(X(h[0]) + 0.5, Y(h[1]) + 0.5, ts - 1, ts - 1); }
  // minimap (big floors, zoomed in)
  u.mini = null;
  if (size >= 20 && u.z > 1.01) {
    const mw = Math.round(Math.min(W, H) * 0.24); const ms = mw / size; const mx = W - mw - 10, my = H - mw - 10;
    ctx.fillStyle = 'rgba(10,11,13,.85)'; ctx.fillRect(mx - 3, my - 3, mw + 6, mw + 6);
    ctx.fillStyle = '#2b2d31'; ctx.fillRect(mx, my, mw, mw);
    for (const e of s.ents) { const n = KINDS[e.k].size; ctx.fillStyle = e.k === 'belt' || e.k === 'splitter' || e.k === 'underground' ? '#c9a227' : e.k === 'inserter' ? '#e0c040' : e.k === 'chest_in' ? '#3f7fbf' : e.k === 'chest_out' ? '#3fa060' : KINDS[e.k].color; ctx.fillRect(mx + e.x * ms, my + e.y * ms, Math.max(1, n * ms), Math.max(1, n * ms)); }
    const vx = (-L.ox / ts) * ms, vy = (-L.oy / ts) * ms, vw = (W / ts) * ms, vh = (H / ts) * ms;
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mw); ctx.clip(); ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2; ctx.strokeRect(mx + vx, my + vy, vw, vh); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.strokeRect(mx - 0.5, my - 0.5, mw + 1, mw + 1);
    u.mini = { x: mx, y: my, w: mw, s: ms };
  }
}

function drawUnderground(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, anim: number, role: 'in' | 'out' | 'none') {
  drawBelt(ctx, { ...e, k: 'belt' }, x, y, ts, anim);
  // hood: entrances are closed in front (items dive in), exits closed behind (items surface)
  ctx.save(); ctx.translate(x + ts / 2, y + ts / 2); ctx.rotate((e.d * Math.PI) / 2);
  const front = role === 'out' ? -1 : 1;
  ctx.fillStyle = steel(ctx, -ts / 2, -ts / 2, ts, ts, role === 'none' ? '#6b5a2a' : '#a8821e', 0.3); ctx.strokeStyle = '#2a1f08'; ctx.lineWidth = Math.max(1, ts * 0.06);
  ctx.beginPath(); ctx.rect(front > 0 ? 0 : -ts / 2, -ts * 0.44, ts / 2, ts * 0.88); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(0, 0, ts * 0.12, ts * 0.32, 0, 0, 7); ctx.fill();
  ctx.restore();
  if (role === 'none') { ctx.fillStyle = 'rgba(255,90,90,.85)'; ctx.font = `bold ${Math.floor(ts * 0.36)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('?', x + ts / 2, y + ts * 0.62); }
}

/** Concrete wall band: panel seams, a pipe run with flanges, vents, and a warning stripe along the inner edge. */
function drawWalls(ctx: CanvasRenderingContext2D, wx: number, wy: number, ww: number, wt: number, ts: number, ox: number, oy: number, vis: number, t: number) {
  const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + ww); g.addColorStop(0, '#5a5e64'); g.addColorStop(1, '#3a3d42'); ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, ww);
  const fw = vis * ts;
  // panel seams
  ctx.fillStyle = 'rgba(0,0,0,.28)'; const seam = Math.max(ts * 2, 12);
  for (let i = 0; i <= fw; i += seam) { ctx.fillRect(ox + i, wy, 1, wt); ctx.fillRect(ox + i, oy + fw, 1, wt); ctx.fillRect(wx, oy + i, wt, 1); ctx.fillRect(ox + fw, oy + i, wt, 1); }
  // pipe along the outer half of the band
  const pr = Math.max(1.5, wt * 0.16); const po = wt * 0.3;
  const pipe = (x0: number, y0: number, x1: number, y1: number) => { const v = x0 === x1; const pg = v ? ctx.createLinearGradient(x0 - pr, 0, x0 + pr, 0) : ctx.createLinearGradient(0, y0 - pr, 0, y0 + pr);
    pg.addColorStop(0, '#6a4a2a'); pg.addColorStop(0.4, '#c88a4a'); pg.addColorStop(1, '#4a2f18'); ctx.fillStyle = pg; ctx.fillRect(Math.min(x0, x1) - (v ? pr : 0), Math.min(y0, y1) - (v ? 0 : pr), v ? pr * 2 : Math.abs(x1 - x0), v ? Math.abs(y1 - y0) : pr * 2);
    ctx.fillStyle = '#3a2614'; const len = Math.abs(v ? y1 - y0 : x1 - x0); for (let i = seam / 2; i < len; i += seam) ctx.fillRect(v ? x0 - pr * 1.4 : Math.min(x0, x1) + i, v ? Math.min(y0, y1) + i : y0 - pr * 1.4, v ? pr * 2.8 : Math.max(1, pr * 0.7), v ? Math.max(1, pr * 0.7) : pr * 2.8); };
  pipe(wx, wy + po, wx + ww, wy + po); pipe(wx + po, wy, wx + po, wy + ww);
  pipe(wx, wy + ww - po, wx + ww, wy + ww - po); pipe(wx + ww - po, wy, wx + ww - po, wy + ww);
  // vents on the top and right walls, with a wisp of steam on capable devices
  if (wt >= 8) for (let i = seam; i < fw - seam / 2; i += seam * 2) { const vw = Math.min(seam * 0.5, wt * 1.4), vh = wt * 0.42; vent(ctx, ox + i - vw / 2, wy + wt * 0.5, vw, vh); vent(ctx, ox + fw + wt * 0.5 - vh / 2 + vh * 0.0, oy + i - vw / 2, vh, vw); }
  if (!LOW && wt >= 8) for (let i = seam * 3; i < fw; i += seam * 6) steam(ctx, ox + i, wy + wt * 0.5, ts * 0.7, t + i * 37, 3);
  // warning stripe on the inner lip
  const sw = Math.max(3, wt * 0.24);
  hazard(ctx, ox - sw, oy - sw, fw + sw * 2, sw); hazard(ctx, ox - sw, oy + fw, fw + sw * 2, sw); hazard(ctx, ox - sw, oy, sw, fw); hazard(ctx, ox + fw, oy, sw, fw);
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number, r: number) {
  const a = (d * Math.PI) / 2; ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.4, -r * 0.7); ctx.lineTo(-r * 0.4, r * 0.7); ctx.closePath(); ctx.fill(); ctx.restore();
}
/** Conveyor: steel side frames, rubber belt with moving cleats, end rollers, and a faint direction chevron. */
function drawBelt(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, anim: number) {
  ctx.save(); ctx.translate(x + ts / 2, y + ts / 2); ctx.rotate((e.d * Math.PI) / 2);
  const h = ts / 2; const fr = Math.max(1.5, ts * 0.12);
  // belt surface (rubber)
  const bg = ctx.createLinearGradient(0, -h, 0, h); bg.addColorStop(0, '#2a2c2f'); bg.addColorStop(0.5, '#34373b'); bg.addColorStop(1, '#232528'); ctx.fillStyle = bg; ctx.fillRect(-h, -h + fr, ts, ts - fr * 2);
  // moving cleats
  const ph = (anim % 1) * (ts / 2); ctx.fillStyle = 'rgba(0,0,0,.45)';
  for (let i = -2; i <= 2; i++) { const ox = i * (ts / 4) + (ph % (ts / 4)); if (ox < -h || ox > h - 1) continue; ctx.fillRect(ox, -h + fr, Math.max(1, ts * 0.04), ts - fr * 2); }
  ctx.fillStyle = 'rgba(255,255,255,.05)'; for (let i = -2; i <= 2; i++) { const ox = i * (ts / 4) + (ph % (ts / 4)) + Math.max(1, ts * 0.04); if (ox < -h || ox > h - 1) continue; ctx.fillRect(ox, -h + fr, 1, ts - fr * 2); }
  // direction chevron (painted on the belt)
  ctx.strokeStyle = e.k === 'splitter' ? 'rgba(240,205,80,.8)' : 'rgba(231,180,22,.45)'; ctx.lineWidth = Math.max(1, ts * 0.07); const cx0 = ((ph * 2) % ts) - h;
  ctx.save(); ctx.beginPath(); ctx.rect(-h, -h + fr, ts, ts - fr * 2); ctx.clip();
  for (const o of [cx0, cx0 - ts, cx0 + ts]) { ctx.beginPath(); ctx.moveTo(o - ts * 0.1, -ts * 0.2); ctx.lineTo(o + ts * 0.06, 0); ctx.lineTo(o - ts * 0.1, ts * 0.2); ctx.stroke(); }
  ctx.restore();
  // side frames (painted steel with a bright top edge)
  for (const sy of [-h, h - fr]) { ctx.fillStyle = steel(ctx, -h, sy, ts, fr, e.k === 'splitter' ? '#a8892a' : '#5b6068', 0.35); ctx.fillRect(-h, sy, ts, fr); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(-h, sy, ts, Math.max(0.6, fr * 0.22)); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(-h, sy + fr - Math.max(0.6, fr * 0.2), ts, Math.max(0.6, fr * 0.2)); }
  if (ts >= 14) { ctx.fillStyle = '#2b2e33'; for (const sy of [-h + fr / 2, h - fr / 2]) { ctx.beginPath(); ctx.arc(-h + ts * 0.15, sy, Math.max(0.8, fr * 0.22), 0, 7); ctx.arc(h - ts * 0.15, sy, Math.max(0.8, fr * 0.22), 0, 7); ctx.fill(); } }
  ctx.restore();
  if (e.k === 'splitter') {
    ctx.fillStyle = steel(ctx, x, y, ts, ts, '#c9a227'); rrect(ctx, x + ts * 0.3, y + ts * 0.3, ts * 0.4, ts * 0.4, ts * 0.08); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,236,150,.95)'; for (const dd of [3, 0, 1]) { if (!splitWeights(e)[[3, 0, 1].indexOf(dd)]) continue; arrow(ctx, x + ts / 2 + DX[(e.d + dd) % 4] * ts * 0.3, y + ts / 2 + DY[(e.d + dd) % 4] * ts * 0.3, (e.d + dd) % 4, ts * 0.12); }
  }
}
function drawSplitLabel(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number) {
  if (!e.w || ts < 18) return; const t = splitLabel(e); ctx.font = `bold ${Math.max(7, Math.round(ts * 0.2))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const tw = ctx.measureText(t).width; ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(x + ts / 2 - tw / 2 - 2, y + ts * 0.84 - ts * 0.12, tw + 4, ts * 0.24); ctx.fillStyle = '#ffe9a0'; ctx.fillText(t, x + ts / 2, y + ts * 0.85);
}
const ICON_IMG = new Map<string, HTMLImageElement>();
function iconImg(key: string) { let im = ICON_IMG.get(key); if (!im) { im = new Image(); im.src = itemIconUriKey(key); ICON_IMG.set(key, im); } return im.complete && im.naturalWidth ? im : null; }
function drawItem(ctx: CanvasRenderingContext2D, key: string, cx: number, cy: number, r: number) {
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(cx + r * 0.12, cy + r * 0.55, r * 0.8, r * 0.32, 0, 0, 7); ctx.fill();
  const im = typeof Image !== 'undefined' ? iconImg(key) : null; if (im) { ctx.drawImage(im, cx - r * 1.15, cy - r * 1.15, r * 2.3, r * 2.3); return; }
  const type = key.split(':')[0]; ctx.fillStyle = colorOfKey(key); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  if (type === 'ore') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const rr = r * (0.75 + 0.25 * ((i * 37) % 5) / 4); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); }
  else if (type === 'bar') { ctx.moveTo(cx - r, cy + r * 0.45); ctx.lineTo(cx - r * 0.6, cy - r * 0.45); ctx.lineTo(cx + r * 0.6, cy - r * 0.45); ctx.lineTo(cx + r, cy + r * 0.45); ctx.closePath(); }
  else ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(cx - r * 0.35, cy - r * 0.3, r * 0.3, r * 0.18);
}
/** Steel crate: corner brackets, coloured band (blue in / green out), bolts. */
function drawChest(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number) {
  const p = ts * 0.1, w = ts - 2 * p; const col = e.k === 'chest_in' ? '#3f7fbf' : '#3fa060';
  dropShadow(ctx, x + p, y + p, w, w, ts * 0.08, ts * 0.6);
  ctx.fillStyle = steel(ctx, x + p, y + p, w, w, '#5d636b', 0.3); rrect(ctx, x + p, y + p, w, w, ts * 0.08); ctx.fill();
  ctx.fillStyle = steel(ctx, x + p, y + ts * 0.42, w, ts * 0.16, col, 0.3); ctx.fillRect(x + p, y + ts * 0.42, w, ts * 0.16);
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = Math.max(1, ts * 0.05); rrect(ctx, x + p, y + p, w, w, ts * 0.08); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.strokeRect(x + p * 2, y + p * 2, w - p * 2, w - p * 2);
  if (ts >= 14) for (const [bx, by] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) bolt(ctx, x + ts * bx, y + ts * by, Math.max(0.8, ts * 0.04));
  if ((e.k === 'chest_in' || e.k === 'chest_out') && e.f) drawItem(ctx, e.f, x + ts / 2, y + ts * 0.28, ts * 0.16);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; arrow(ctx, x + ts / 2 + DX[e.d] * ts * 0.3, y + ts / 2 + DY[e.d] * ts * 0.3, e.d, ts * 0.12);
}
function drawInserter(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, frac: number) {
  const cx = x + ts / 2, cy = y + ts / 2;
  // base plate with warning ring
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(cx + ts * 0.05, cy + ts * 0.07, ts * 0.33, 0, 7); ctx.fill();
  ctx.fillStyle = steel(ctx, cx - ts * 0.32, cy - ts * 0.32, ts * 0.64, ts * 0.64, '#454950', 0.3); ctx.beginPath(); ctx.arc(cx, cy, ts * 0.32, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(231,180,22,.8)'; ctx.lineWidth = Math.max(1, ts * 0.05); ctx.setLineDash([ts * 0.08, ts * 0.08]); ctx.beginPath(); ctx.arc(cx, cy, ts * 0.27, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  // arm swings from the back (pick) to the front (drop)
  const holding = !!e.it;
  const back = ((e.d + 2) * Math.PI) / 2;
  const a = holding ? back + Math.PI * (e.t ? 0.5 * frac : Math.min(1, 0.5 + frac)) : back;
  const ex = cx + Math.cos(a) * ts * 0.44, ey = cy + Math.sin(a) * ts * 0.44;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(2, ts * 0.14); ctx.beginPath(); ctx.moveTo(cx + ts * 0.04, cy + ts * 0.06); ctx.lineTo(ex + ts * 0.04, ey + ts * 0.06); ctx.stroke();
  ctx.strokeStyle = '#e0b62a'; ctx.lineWidth = Math.max(2, ts * 0.12); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,245,200,.55)'; ctx.lineWidth = Math.max(0.8, ts * 0.035); ctx.beginPath(); ctx.moveTo(cx, cy - ts * 0.025); ctx.lineTo(ex, ey - ts * 0.025); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = metal(ctx, cx - ts * 0.1, cy - ts * 0.1, ts * 0.2, ts * 0.2); ctx.beginPath(); ctx.arc(cx, cy, ts * 0.1, 0, 7); ctx.fill();
  ctx.fillStyle = '#2b2e33'; ctx.beginPath(); ctx.arc(ex, ey, ts * 0.07, 0, 7); ctx.fill();
  if (e.it) drawItem(ctx, e.it, ex, ey, ts * 0.2);
  if (e.f) { ctx.fillStyle = 'rgba(0,0,0,.7)'; rrect(ctx, x + ts * 0.58, y + ts * 0.02, ts * 0.4, ts * 0.4, ts * 0.06); ctx.fill(); drawItem(ctx, e.f, x + ts * 0.78, y + ts * 0.22, ts * 0.14); }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; arrow(ctx, cx + DX[e.d] * ts * 0.38, cy + DY[e.d] * ts * 0.38, e.d, ts * 0.08);
}
/** 2×2 machine: soft shadow, painted-steel housing with bevel, warning-striped skirt, vents, kind-specific works and effects. */
function drawMachine(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, t: number) {
  const d = KINDS[e.k]; const S = ts * 2; const p = ts * 0.08; const r = frecipe(e.r); const working = !!e.p;
  const bx = x + p, by = y + p, bw = S - 2 * p; const rad = ts * 0.12;
  dropShadow(ctx, bx, by, bw, bw, rad, ts);
  // frame (bare metal) then painted housing
  ctx.fillStyle = steel(ctx, bx, by, bw, bw, '#4d5258', 0.25); rrect(ctx, bx, by, bw, bw, rad); ctx.fill();
  const sk = Math.max(2, ts * 0.13); hazard(ctx, bx + rad * 0.5, by + bw - sk - p * 0.6, bw - rad, sk, 0.9);
  const ix = x + p * 2.4, iy = y + p * 2.4, iw = S - p * 4.8, ih = S - p * 4.8 - sk;
  ctx.fillStyle = steel(ctx, ix, iy, iw, ih, d.color, 0.28); rrect(ctx, ix, iy, iw, ih, rad * 0.7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(ix + rad * 0.5, iy, iw - rad, Math.max(1, ts * 0.05));
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = Math.max(1, ts * 0.04); rrect(ctx, ix, iy, iw, ih, rad * 0.7); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = Math.max(1, ts * 0.05); rrect(ctx, bx, by, bw, bw, rad); ctx.stroke();
  if (ts >= 12) for (const [rx, ry] of [[0, 0], [1, 0], [0, 1], [1, 1]]) bolt(ctx, bx + (rx ? bw - p * 1.2 : p * 1.2), by + (ry ? bw - p * 1.2 : p * 1.2), Math.max(1, ts * 0.045));
  if (ts >= 16) vent(ctx, ix + iw - ts * 0.42, iy + ih - ts * 0.34, ts * 0.32, ts * 0.22);
  const cx = x + S / 2, cy = y + S / 2 - sk * 0.3; const ph = t / 1000;
  if (e.k === 'smelter') {
    const fl = working ? 0.65 + 0.35 * Math.sin(ph * 9) * Math.sin(ph * 3.3) : 0.12;
    ctx.fillStyle = '#17110e'; rrect(ctx, cx - ts * 0.42, cy - ts * 0.05, ts * 0.84, ts * 0.5, ts * 0.12); ctx.fill();
    const gr = ctx.createLinearGradient(0, cy - ts * 0.05, 0, cy + ts * 0.45); gr.addColorStop(0, `rgba(255,120,30,${fl * 0.5})`); gr.addColorStop(1, `rgba(255,220,120,${fl})`); ctx.fillStyle = gr; rrect(ctx, cx - ts * 0.36, cy + ts * 0.02, ts * 0.72, ts * 0.38, ts * 0.1); ctx.fill();
    if (working) glow(ctx, cx, cy + ts * 0.2, ts * 0.9, '255,150,60', 0.28 * fl);
    // chimney with cap
    const chx = x + S - ts * 0.62, chy = y + ts * 0.16; ctx.fillStyle = metal(ctx, chx, chy, ts * 0.3, ts * 0.5, true); ctx.fillRect(chx, chy, ts * 0.3, ts * 0.5); ctx.fillStyle = '#1d1f22'; ctx.fillRect(chx - ts * 0.04, chy, ts * 0.38, ts * 0.08);
    if (working) steam(ctx, chx + ts * 0.15, chy, ts, t, 5, '170,172,176');
    if (working) sparks(ctx, cx, cy + ts * 0.1, ts * 0.6, t, e.id, 30);
  } else if (e.k === 'press') {
    const off = working ? Math.abs(Math.sin(ph * 5)) * ts * 0.3 : ts * 0.3;
    ctx.fillStyle = metal(ctx, cx - ts * 0.55, 0, ts * 1.1, 1, true); ctx.fillRect(cx - ts * 0.55, iy + ts * 0.08, ts * 0.12, ih - ts * 0.16); ctx.fillRect(cx + ts * 0.43, iy + ts * 0.08, ts * 0.12, ih - ts * 0.16);
    ctx.fillStyle = '#25282c'; ctx.fillRect(cx - ts * 0.45, cy + ts * 0.22, ts * 0.9, ts * 0.2);
    ctx.fillStyle = metal(ctx, cx - ts * 0.4, cy - ts * 0.5, ts * 0.8, ts * 0.3); ctx.fillRect(cx - ts * 0.4, cy - ts * 0.5 + (ts * 0.3 - off), ts * 0.8, ts * 0.3);
    ctx.fillStyle = '#c0c6cc'; ctx.fillRect(cx - ts * 0.07, iy + ts * 0.02, ts * 0.14, cy - iy - ts * 0.48 + (ts * 0.3 - off));
    if (working && off < ts * 0.06) sparks(ctx, cx, cy + ts * 0.2, ts, t, e.id, 50);
  } else if (e.k === 'roller' || e.k === 'drawer') {
    const rot = working ? ph * 6 : 0;
    for (const sy of [-0.25, 0.25]) { ctx.save(); ctx.translate(cx, cy + sy * ts); ctx.fillStyle = metal(ctx, 0, -ts * 0.16, 1, ts * 0.32); rrect(ctx, -ts * 0.6, -ts * 0.16, ts * 1.2, ts * 0.32, ts * 0.14); ctx.fill(); ctx.strokeStyle = 'rgba(60,64,70,.7)'; ctx.lineWidth = Math.max(1, ts * 0.04); for (let i = 0; i < 6; i++) { const xx = ((i / 6 + rot / 6.28) % 1) * ts * 1.2 - ts * 0.6; ctx.beginPath(); ctx.moveTo(xx, -ts * 0.14); ctx.lineTo(xx, ts * 0.14); ctx.stroke(); } ctx.restore(); }
    if (e.k === 'drawer') { ctx.strokeStyle = '#e08a4a'; ctx.lineWidth = Math.max(1, ts * 0.05); ctx.beginPath(); ctx.arc(cx, cy, ts * 0.45, rot, rot + 5); ctx.stroke(); if (working) glow(ctx, cx + Math.cos(rot + 5) * ts * 0.45, cy + Math.sin(rot + 5) * ts * 0.45, ts * 0.2, '255,170,90', 0.5); }
    if (working) steam(ctx, cx - ts * 0.4, iy + ts * 0.1, ts * 0.6, t + e.id * 333, 3);
  } else {
    // assembler / jeweler / fabricator / mill / cannery: geared drive under a glass dome + work light
    const rot = working ? ph * 2.5 : 0; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.fillStyle = metal(ctx, -ts * 0.55, -ts * 0.55, ts * 1.1, ts * 1.1);
    ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const rr = i % 2 ? ts * 0.42 : ts * 0.55; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = Math.max(1, ts * 0.03); ctx.stroke();
    ctx.fillStyle = '#25282c'; ctx.beginPath(); ctx.arc(0, 0, ts * 0.26, 0, 7); ctx.fill();
    ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(0, 0, ts * 0.16, 0, 7); ctx.fill(); ctx.restore();
    const dome = ctx.createRadialGradient(cx - ts * 0.18, cy - ts * 0.2, 1, cx, cy, ts * 0.6); dome.addColorStop(0, 'rgba(255,255,255,.28)'); dome.addColorStop(0.5, 'rgba(255,255,255,.04)'); dome.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = dome; ctx.beginPath(); ctx.arc(cx, cy, ts * 0.6, 0, 7); ctx.fill();
    if (working) { const c = e.k === 'jeweler' ? '220,140,255' : '120,220,255'; glow(ctx, cx, cy, ts * 0.85, c, 0.22 + 0.12 * Math.sin(ph * 7)); if (e.k === 'fabricator' || e.k === 'assembler') sparks(ctx, cx + ts * 0.3, cy - ts * 0.1, ts * 0.7, t, e.id, e.k === 'fabricator' ? 200 : 45); }
  }
  // status lamp (with halo), output arrow, recipe icon, progress
  const lc = working ? '93,255,122' : r ? '255,179,64' : '255,77,77'; const lx = x + p * 4.2, ly = y + p * 4.2;
  glow(ctx, lx, ly, Math.max(4, ts * 0.22), lc, working ? 0.6 : 0.4);
  ctx.fillStyle = `rgb(${lc})`; ctx.beginPath(); ctx.arc(lx, ly, Math.max(2, ts * 0.075), 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(lx - ts * 0.02, ly - ts * 0.02, Math.max(0.8, ts * 0.025), 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,240,180,.95)'; arrow(ctx, x + S / 2 + DX[e.d] * ts * 0.82, y + S / 2 + DY[e.d] * ts * 0.82, e.d, ts * 0.16);
  if (r) { ctx.fillStyle = 'rgba(0,0,0,.55)'; rrect(ctx, x + S - ts * 0.6, y + S - ts * 0.6 - sk, ts * 0.5, ts * 0.5, ts * 0.1); ctx.fill(); drawItem(ctx, r.out[0], x + S - ts * 0.35, y + S - ts * 0.35 - sk, ts * 0.2);
    if (e.p) { const pw = S - p * 6, py2 = y + S - p * 3 - sk - 5; ctx.fillStyle = 'rgba(0,0,0,.6)'; rrect(ctx, x + p * 3, py2, pw, 4, 2); ctx.fill(); const gg = ctx.createLinearGradient(x, 0, x + pw, 0); gg.addColorStop(0, '#3ad16a'); gg.addColorStop(1, '#a8ff8a'); ctx.fillStyle = gg; rrect(ctx, x + p * 3, py2, pw * (e.p / recipeTicks(r)), 4, 2); ctx.fill(); } }
  if (ts >= 18) { ctx.font = `600 ${Math.floor(ts * 0.28)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(d.name, x + p * 6.5 + 1, y + p * 5.6 + 1); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(d.name, x + p * 6.5, y + p * 5.6); }
  void FRECIPES; void shade;
}
