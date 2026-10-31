import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import type { Stack } from '../../../shared/mines';
import { CHEST_ITEMS, DX, DY, FLOOR_LEVELS, FRECIPES, KINDS, KIND_ORDER, TICK_MS, colorOfKey, floorSize, frecipe, gridOf, cellId, nameOfKey, priceOfKey, recipeTicks, recipesFor, step, canPlace, type Dir, type Ent, type FState, type Grid, type Kind } from '../../../shared/factory';

export type FAck = { ok: boolean; error?: string; state?: FState | null; level?: number; storage?: Stack[]; guest?: boolean; now?: number; result?: unknown };
type Tool = 'select' | 'remove' | Kind;
const ICON: Record<Kind, string> = { belt: '➡', splitter: '⑂', inserter: '🦾', chest_in: '📥', chest_out: '📤', smelter: '🔥', press: '🔨', roller: '⚙', drawer: '🧵', assembler: '🏗', jeweler: '💎', fabricator: '🏭' };
const hash = (x: number, y: number) => { let h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0; h ^= h >>> 13; return (h % 1000) / 1000; };

/** Factorio-ish grid factory: server-authoritative sim, predicted locally between syncs. */
export function FactoryBuilder({ guest, flash, onStorage }: { guest: boolean; flash: (t: string) => void; onStorage: (s: Stack[]) => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sim = useRef<{ s: FState | null; g: Grid; store: Map<string, number>; skew: number; shown: number; shownFrom: number; shownAt: number }>({ s: null, g: new Map(), store: new Map(), skew: 0, shown: 0, shownFrom: 0, shownAt: 0 });
  const [level, setLevel] = useState(0);
  const [fs, setFs] = useState<FState | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [dir, setDir] = useState<Dir>(0);
  const [sel, setSel] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [side, setSide] = useState<'build' | 'shop' | 'recipes'>('build');
  const [buyN, setBuyN] = useState(1);
  const ui = useRef({ tool, dir, sel, moving, hover: null as null | [number, number], drag: [] as Array<{ x: number; y: number; d: Dir }>, dragging: false, removing: new Set<number>() });
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
      const k = e.key.toLowerCase();
      if (k === 'r') { e.preventDefault(); const u = ui.current; if (u.tool === 'select' && u.hover) { const ent = sim.current.g.get(cellId(u.hover[0], u.hover[1])); if (ent) { call('fac_edit', { id: ent.id, d: (ent.d + (e.shiftKey ? 3 : 1)) % 4 }); return; } } setDir((d) => ((d + (e.shiftKey ? 3 : 1)) % 4) as Dir); }
      else if (k === 'escape' || k === 'q') { setTool('select'); setMoving(null); }
      else if (k === 'x') setTool('remove');
      else if (k === 'b') setTool('belt');
      else if (k === 'i') setTool('inserter');
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cellAt = (ev: { clientX: number; clientY: number }): [number, number] | null => {
    const cv = cvRef.current; const s = sim.current.s; if (!cv || !s) return null;
    const r = cv.getBoundingClientRect(); const L = layout(cv.width, cv.height, floorSize(s.floor)); const dpr = cv.width / r.width;
    const x = Math.floor(((ev.clientX - r.left) * dpr - L.ox) / L.ts), y = Math.floor(((ev.clientY - r.top) * dpr - L.oy) / L.ts);
    return [x, y];
  };
  const onDown = (ev: React.PointerEvent) => {
    const c = cellAt(ev); if (!c) return; const u = ui.current; u.hover = c;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    if (ev.button === 2 || u.tool === 'remove') { u.dragging = true; u.removing = new Set(); const e = sim.current.g.get(cellId(c[0], c[1])); if (e) u.removing.add(e.id); return; }
    if (u.tool === 'belt') { u.dragging = true; u.drag = [{ x: c[0], y: c[1], d: u.dir }]; return; }
  };
  const onMove = (ev: React.PointerEvent) => {
    const c = cellAt(ev); const u = ui.current; u.hover = c; if (!c || !u.dragging) return;
    if (u.removing.size || u.tool === 'remove' || (ev.buttons & 2)) { const e = sim.current.g.get(cellId(c[0], c[1])); if (e) u.removing.add(e.id); return; }
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
      {level === 0 && <button type="button" className="mines-sell" onClick={() => call('fac_expand', {}, () => flash('Factory built! You got a starter kit.'))} data-testid="fac-build">Buy the building (12×12) · 🪙 {FLOOR_LEVELS[0].cost}</button>}
      {level > 0 && <p className="mines-note">Loading…</p>}
    </div>
  );
  const next = FLOOR_LEVELS[fs.floor];
  const kitN = (k: Kind) => fs.kit[k] ?? 0;
  return (
    <div className="fac" data-testid="fac">
      <div className="fac-top">
        <span className="fac-chip">🏭 {floorSize(fs.floor)}×{floorSize(fs.floor)}</span>
        {next && <button type="button" className="fac-btn" onClick={() => call('fac_expand', {}, () => flash(`Walls pushed out to ${next.size}×${next.size}!`))} data-testid="fac-expand">Expand to {next.size}×{next.size} · 🪙 {next.cost.toLocaleString()}</button>}
        <span className="fac-tools">
          <button type="button" className={tool === 'select' ? 'on' : ''} onClick={() => { setTool('select'); setMoving(null); }} title="Select (Esc)">👆</button>
          <button type="button" className={tool === 'remove' ? 'on' : ''} onClick={() => setTool('remove')} title="Pick up (X / right-click, drag for many)" data-testid="fac-remove">🧲</button>
          <button type="button" onClick={() => setDir((d) => ((d + 1) % 4) as Dir)} title="Rotate (R)" data-testid="fac-rotate">⟳ {['→', '↓', '←', '↑'][dir]}</button>
        </span>
      </div>
      <div className="fac-main">
        <div className="fac-canvas" ref={wrapRef}>
          <canvas ref={cvRef} data-testid="fac-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { ui.current.hover = null; }} onContextMenu={(e) => e.preventDefault()} />
          {moving !== null && <div className="fac-hint">Click where to move it (R rotates) · Esc cancels</div>}
        </div>
        <aside className="fac-side">
          <div className="fac-tabs">
            {(['build', 'shop', 'recipes'] as const).map((t) => <button type="button" key={t} className={side === t ? 'on' : ''} onClick={() => setSide(t)} data-testid={`fac-tab-${t}`}>{t === 'build' ? '🧰 Build' : t === 'shop' ? '🛒 Machinist' : '📜 Recipes'}</button>)}
          </div>
          {selEnt && <Inspect e={selEnt} storage={storageList} store={sim.current.store} onEdit={(b) => call('fac_edit', { id: selEnt.id, ...b })} onRemove={() => { call('fac_remove', { ids: [selEnt.id] }); setSel(null); }} onMove={() => { setMoving(selEnt.id); setDir(selEnt.d); }} onClose={() => setSel(null)} />}
          {side === 'build' && <div className="fac-palette">
            {KIND_ORDER.map((k) => (
              <button type="button" key={k} disabled={!kitN(k)} className={tool === k ? 'on' : ''} onClick={() => { setTool(k); setSel(null); }} title={KINDS[k].desc} data-testid={`fac-pal-${k}`}>
                <span className="fac-ic">{ICON[k]}</span><span>{KINDS[k].name}</span><b>×{kitN(k)}</b>
              </button>
            ))}
            <p className="mines-note">Click to place, R rotates, drag belts. Inserters grab from behind and drop in front. Machines push output out the side their arrow faces.</p>
          </div>}
          {side === 'shop' && <div className="fac-shop" data-testid="fac-shop">
            <div className="fac-buyn">Buy {[1, 5, 10, 25].map((n) => <button type="button" key={n} className={buyN === n ? 'on' : ''} onClick={() => setBuyN(n)}>×{n}</button>)}</div>
            {KIND_ORDER.map((k) => { const d = KINDS[k]; const locked = fs.floor < d.minFloor; return (
              <div key={k} className="fac-shoprow"><span className="fac-ic">{ICON[k]}</span><span><b>{d.name}</b><small>{locked ? `Unlocks at building level ${d.minFloor}` : d.desc}</small></span>
                <button type="button" disabled={locked} onClick={() => call('fac_buy', { kind: k, n: buyN }, () => flash(`Bought ${buyN}× ${d.name}`))} data-testid={`fac-buy-${k}`}>🪙 {(d.cost * buyN).toLocaleString()}</button></div>
            ); })}
          </div>}
          {side === 'recipes' && <div className="fac-recipes">
            {KIND_ORDER.filter((k) => KINDS[k].machine).map((k) => (
              <div key={k}><h4>{ICON[k]} {KINDS[k].name}</h4>
                {recipesFor(k).map((r) => <div key={r.id} className="fac-rec"><span>{r.in.map(([key, q]) => <i key={key}><Dot k={key} />{q} {nameOfKey(key)}</i>)}</span><span>→ <Dot k={r.out[0]} />{r.out[1]} {nameOfKey(r.out[0])} <small>{r.secs}s · 🪙{priceOfKey(r.out[0])}</small></span></div>)}
              </div>
            ))}
          </div>}
        </aside>
      </div>
    </div>
  );
}

function Dot({ k }: { k: string }) { return <span className="mines-dot" style={{ background: colorOfKey(k) }} />; }

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
        <span>→ <Dot k={r.out[0]} />{e.ob ?? 0} ready</span>
        <div className="mines-bar"><i style={{ width: `${((e.p ?? 0) / recipeTicks(r)) * 100}%` }} /></div>
      </div>}
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

// ------------------------------------------------------------------ rendering
function layout(w: number, h: number, size: number) { const pad = Math.min(w, h) * 0.05 + 14; const ts = Math.max(6, Math.floor(Math.min((w - pad * 2) / size, (h - pad * 2) / size))); return { ts, ox: Math.floor((w - ts * size) / 2), oy: Math.floor((h - ts * size) / 2) }; }
type SimRef = { s: FState | null; g: Grid; store: Map<string, number>; shown: number; shownFrom: number; shownAt: number };
type UiRef = { tool: Tool; dir: Dir; sel: number | null; moving: number | null; hover: null | [number, number]; drag: Array<{ x: number; y: number; d: Dir }>; removing: Set<number> };

function render(cv: HTMLCanvasElement, c: SimRef, frac: number, t: number, u: UiRef) {
  const ctx = cv.getContext('2d'); const s = c.s; if (!ctx || !s) return;
  const W = cv.width, H = cv.height; const size = floorSize(s.floor);
  const L = layout(W, H, size); const ts = L.ts;
  // wall animation: shown size eases from old to new
  const k = Math.min(1, (performance.now() - c.shownAt) / 1400); const ease = 1 - (1 - k) ** 3;
  const vis = c.shownFrom + (size - c.shownFrom) * ease;
  ctx.fillStyle = '#121416'; ctx.fillRect(0, 0, W, H);
  // exterior gravel
  for (let i = 0; i < 160; i++) { const x = hash(i, 7) * W, y = hash(i, 13) * H; ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(x, y, 3, 3); }
  const X = (x: number) => L.ox + x * ts, Y = (y: number) => L.oy + y * ts;
  // floor
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x >= vis || y >= vis) continue;
    const v = hash(x, y); ctx.fillStyle = `rgb(${38 + v * 10},${40 + v * 10},${42 + v * 9})`; ctx.fillRect(X(x), Y(y), ts, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(X(x), Y(y), ts, 1); ctx.fillRect(X(x), Y(y), 1, ts);
    if (v > 0.93) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(X(x) + ts * 0.6, Y(y) + ts * 0.4, ts * 0.22, 0, 7); ctx.fill(); }
  }
  // walls (hazard-striped band, moves out on expansion)
  const wt = Math.max(5, ts * 0.45); const wx = L.ox - wt, wy = L.oy - wt, ww = vis * ts + wt * 2;
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, ww); ctx.rect(L.ox, L.oy, vis * ts, vis * ts); ctx.clip('evenodd');
  ctx.fillStyle = '#3a3d42'; ctx.fillRect(wx, wy, ww, ww);
  ctx.strokeStyle = 'rgba(230,180,40,0.55)'; ctx.lineWidth = wt * 0.35;
  for (let i = -ww; i < ww * 2; i += wt * 1.4) { ctx.beginPath(); ctx.moveTo(wx + i, wy); ctx.lineTo(wx + i - ww, wy + ww); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#1b1d20'; ctx.lineWidth = 2; ctx.strokeRect(wx, wy, ww, ww); ctx.strokeRect(L.ox, L.oy, vis * ts, vis * ts);
  if (k < 1) { ctx.fillStyle = `rgba(255,210,80,${0.5 * (1 - k)})`; ctx.font = `bold ${Math.max(14, ts)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('EXPANDING', L.ox + (vis * ts) / 2, L.oy + (vis * ts) / 2); }
  const anim = t / TICK_MS; // belt chevron phase
  // belts first, then items, then buildings
  for (const e of s.ents) if (e.k === 'belt' || e.k === 'splitter') drawBelt(ctx, e, X(e.x), Y(e.y), ts, anim);
  for (const e of s.ents) {
    if (e.k === 'belt' || e.k === 'splitter') { if (e.it) { const back = e.m ? 1 - frac : 0; const md = e.m ? e.m - 1 : e.d; drawItem(ctx, e.it, X(e.x) + ts / 2 - DX[md] * ts * back, Y(e.y) + ts / 2 - DY[md] * ts * back, ts * 0.34); } }
  }
  for (const e of s.ents) {
    const px = X(e.x), py = Y(e.y);
    if (e.k === 'inserter') drawInserter(ctx, e, px, py, ts, frac);
    else if (e.k === 'chest_in' || e.k === 'chest_out') drawChest(ctx, e, px, py, ts);
    else if (KINDS[e.k].machine) drawMachine(ctx, e, px, py, ts, t);
    if (u.sel === e.id || u.removing.has(e.id)) { const sz = KINDS[e.k].size * ts; ctx.strokeStyle = u.removing.has(e.id) ? '#ff5050' : '#ffe066'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, sz - 2, sz - 2); }
  }
  // ghost
  const h = u.hover; const g = c.g;
  if (u.drag.length) for (const p of u.drag) { ctx.globalAlpha = 0.6; drawBelt(ctx, { id: -1, k: 'belt', x: p.x, y: p.y, d: p.d }, X(p.x), Y(p.y), ts, anim); ctx.globalAlpha = 1; if (g.get(cellId(p.x, p.y)) || p.x < 0 || p.y < 0 || p.x >= size || p.y >= size) { ctx.fillStyle = 'rgba(255,60,60,.35)'; ctx.fillRect(X(p.x), Y(p.y), ts, ts); } }
  else if (h && (u.moving !== null || (u.tool !== 'select' && u.tool !== 'remove'))) {
    const me = u.moving !== null ? s.ents.find((e) => e.id === u.moving) : null; const kind = (me ? me.k : u.tool) as Kind;
    const bad = canPlace(s, g, kind, h[0], h[1], u.dir, me?.id);
    const sz = KINDS[kind].size * ts; ctx.globalAlpha = 0.55;
    const ghost: Ent = { id: -1, k: kind, x: h[0], y: h[1], d: u.dir };
    if (kind === 'belt' || kind === 'splitter') drawBelt(ctx, ghost, X(h[0]), Y(h[1]), ts, anim); else if (kind === 'inserter') drawInserter(ctx, ghost, X(h[0]), Y(h[1]), ts, 0); else if (KINDS[kind].machine) drawMachine(ctx, ghost, X(h[0]), Y(h[1]), ts, t); else drawChest(ctx, ghost, X(h[0]), Y(h[1]), ts);
    ctx.globalAlpha = 1; ctx.fillStyle = bad ? 'rgba(255,60,60,.3)' : 'rgba(80,255,120,.18)'; ctx.fillRect(X(h[0]), Y(h[1]), sz, sz);
  } else if (h && h[0] >= 0 && h[1] >= 0 && h[0] < size && h[1] < size) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(X(h[0]) + 0.5, Y(h[1]) + 0.5, ts - 1, ts - 1); }
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number, r: number) {
  const a = (d * Math.PI) / 2; ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.4, -r * 0.7); ctx.lineTo(-r * 0.4, r * 0.7); ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawBelt(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, anim: number) {
  ctx.fillStyle = '#1e1f21'; ctx.fillRect(x, y, ts, ts);
  ctx.save(); ctx.beginPath(); ctx.rect(x + ts * 0.1, y + ts * 0.1, ts * 0.8, ts * 0.8); ctx.clip();
  ctx.fillStyle = '#2f3134'; ctx.fillRect(x, y, ts, ts);
  ctx.translate(x + ts / 2, y + ts / 2); ctx.rotate((e.d * Math.PI) / 2);
  const ph = (anim % 1) * (ts / 2);
  ctx.strokeStyle = e.k === 'splitter' ? '#e8c64a' : '#c9a227'; ctx.lineWidth = Math.max(1, ts * 0.08);
  for (let i = -2; i <= 2; i++) { const ox = i * (ts / 2) + ph; ctx.beginPath(); ctx.moveTo(ox - ts * 0.12, -ts * 0.28); ctx.lineTo(ox + ts * 0.06, 0); ctx.lineTo(ox - ts * 0.12, ts * 0.28); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = '#55585d'; const rail = Math.max(1, ts * 0.09);
  if (e.d % 2 === 0) { ctx.fillRect(x, y + ts * 0.06, ts, rail); ctx.fillRect(x, y + ts * 0.94 - rail, ts, rail); } else { ctx.fillRect(x + ts * 0.06, y, rail, ts); ctx.fillRect(x + ts * 0.94 - rail, y, rail, ts); }
  if (e.k === 'splitter') { ctx.fillStyle = 'rgba(232,198,74,.85)'; for (const dd of [3, 0, 1]) arrow(ctx, x + ts / 2 + DX[(e.d + dd) % 4] * ts * 0.28, y + ts / 2 + DY[(e.d + dd) % 4] * ts * 0.28, (e.d + dd) % 4, ts * 0.13); }
}
function drawItem(ctx: CanvasRenderingContext2D, key: string, cx: number, cy: number, r: number) {
  const type = key.split(':')[0]; ctx.fillStyle = colorOfKey(key); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  if (type === 'ore') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const rr = r * (0.75 + 0.25 * ((i * 37) % 5) / 4); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); }
  else if (type === 'bar') { ctx.moveTo(cx - r, cy + r * 0.45); ctx.lineTo(cx - r * 0.6, cy - r * 0.45); ctx.lineTo(cx + r * 0.6, cy - r * 0.45); ctx.lineTo(cx + r, cy + r * 0.45); ctx.closePath(); }
  else ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(cx - r * 0.35, cy - r * 0.3, r * 0.3, r * 0.18);
}
function drawChest(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number) {
  const p = ts * 0.1; ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x + p, y + p, ts - 2 * p, ts - 2 * p);
  ctx.fillStyle = e.k === 'chest_in' ? '#3f7fbf' : '#3fa060'; ctx.fillRect(x + p, y + ts * 0.42, ts - 2 * p, ts * 0.14);
  ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = Math.max(1, ts * 0.06); ctx.strokeRect(x + p, y + p, ts - 2 * p, ts - 2 * p);
  if (e.k === 'chest_in' && e.f) drawItem(ctx, e.f, x + ts / 2, y + ts * 0.28, ts * 0.16);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; arrow(ctx, x + ts / 2 + DX[e.d] * ts * 0.3, y + ts / 2 + DY[e.d] * ts * 0.3, e.d, ts * 0.12);
}
function drawInserter(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, frac: number) {
  const cx = x + ts / 2, cy = y + ts / 2;
  ctx.fillStyle = '#3b3e44'; ctx.beginPath(); ctx.arc(cx, cy, ts * 0.3, 0, 7); ctx.fill();
  ctx.fillStyle = '#d9b43a'; ctx.beginPath(); ctx.arc(cx, cy, ts * 0.14, 0, 7); ctx.fill();
  // arm swings from the back (pick) to the front (drop)
  const holding = !!e.it; const swing = holding ? (e.t ? 0.5 * frac : 0.5 + 0.5 * Math.min(1, frac * 2)) : 0;
  const back = ((e.d + 2) * Math.PI) / 2, front = (e.d * Math.PI) / 2;
  let da = front - back; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
  const a = holding ? back + Math.PI * (e.t ? swing : Math.min(1, 0.5 + frac)) : back;
  void da;
  const ex = cx + Math.cos(a) * ts * 0.44, ey = cy + Math.sin(a) * ts * 0.44;
  ctx.strokeStyle = '#e0c040'; ctx.lineWidth = Math.max(2, ts * 0.12); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.lineCap = 'butt';
  if (e.it) drawItem(ctx, e.it, ex, ey, ts * 0.2);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; arrow(ctx, cx + DX[e.d] * ts * 0.38, cy + DY[e.d] * ts * 0.38, e.d, ts * 0.08);
}
function drawMachine(ctx: CanvasRenderingContext2D, e: Ent, x: number, y: number, ts: number, t: number) {
  const d = KINDS[e.k]; const S = ts * 2; const p = ts * 0.08; const r = frecipe(e.r); const working = !!e.p;
  // shadow + body
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x + p + ts * 0.1, y + p + ts * 0.12, S - 2 * p, S - 2 * p);
  ctx.fillStyle = '#4a4d52'; ctx.fillRect(x + p, y + p, S - 2 * p, S - 2 * p);
  ctx.fillStyle = d.color; ctx.fillRect(x + p * 2.5, y + p * 2.5, S - 5 * p, S - 5 * p);
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x + p * 2.5, y + p * 2.5, S - 5 * p, ts * 0.12);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + p * 2.5, y + S - p * 2.5 - ts * 0.12, S - 5 * p, ts * 0.12);
  // rivets
  ctx.fillStyle = '#2a2c30'; for (const [rx, ry] of [[1, 1], [S - 1, 1], [1, S - 1], [S - 1, S - 1]]) { ctx.beginPath(); ctx.arc(x + (rx < 2 ? p * 1.6 : S - p * 1.6), y + (ry < 2 ? p * 1.6 : S - p * 1.6), Math.max(1, ts * 0.05), 0, 7); ctx.fill(); }
  const cx = x + S / 2, cy = y + S / 2; const ph = t / 1000;
  if (e.k === 'smelter') {
    const glow = working ? 0.6 + 0.4 * Math.sin(ph * 9) : 0.15;
    const gr = ctx.createRadialGradient(cx, cy + ts * 0.2, 1, cx, cy + ts * 0.2, ts * 0.6); gr.addColorStop(0, `rgba(255,200,80,${glow})`); gr.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = '#1a1210'; ctx.fillRect(cx - ts * 0.4, cy, ts * 0.8, ts * 0.45); ctx.fillStyle = gr; ctx.fillRect(cx - ts * 0.7, cy - ts * 0.4, ts * 1.4, ts * 1.2);
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(x + S - ts * 0.6, y + ts * 0.2, ts * 0.3, ts * 0.5); // chimney
    if (working) for (let i = 0; i < 4; i++) { const q = (ph * 0.8 + i / 4) % 1; ctx.fillStyle = `rgba(180,180,180,${0.35 * (1 - q)})`; ctx.beginPath(); ctx.arc(x + S - ts * 0.45 + Math.sin(q * 6 + i) * ts * 0.12, y + ts * 0.2 - q * ts * 1.1, ts * (0.12 + q * 0.25), 0, 7); ctx.fill(); }
  } else if (e.k === 'press') {
    const off = working ? Math.abs(Math.sin(ph * 5)) * ts * 0.35 : ts * 0.35;
    ctx.fillStyle = '#2b2e33'; ctx.fillRect(cx - ts * 0.5, cy + ts * 0.25, ts, ts * 0.2);
    ctx.fillStyle = '#9aa3ad'; ctx.fillRect(cx - ts * 0.42, cy - ts * 0.55 + off * 0.0, ts * 0.84, ts * 0.25 + (ts * 0.35 - off));
    ctx.fillStyle = '#c0c6cc'; ctx.fillRect(cx - ts * 0.08, y + p * 2.5, ts * 0.16, cy - y - ts * 0.4);
  } else if (e.k === 'roller' || e.k === 'drawer') {
    const rot = working ? ph * 6 : 0;
    for (const sy of [-0.25, 0.25]) { ctx.save(); ctx.translate(cx, cy + sy * ts); ctx.fillStyle = '#b8bec6'; ctx.fillRect(-ts * 0.6, -ts * 0.16, ts * 1.2, ts * 0.32); ctx.strokeStyle = '#5a5f66'; ctx.lineWidth = Math.max(1, ts * 0.05); for (let i = 0; i < 6; i++) { const xx = ((i / 6 + rot / 6.28) % 1) * ts * 1.2 - ts * 0.6; ctx.beginPath(); ctx.moveTo(xx, -ts * 0.16); ctx.lineTo(xx, ts * 0.16); ctx.stroke(); } ctx.restore(); }
    if (e.k === 'drawer') { ctx.strokeStyle = '#e08a4a'; ctx.lineWidth = Math.max(1, ts * 0.05); ctx.beginPath(); ctx.arc(cx, cy, ts * 0.45, rot, rot + 5); ctx.stroke(); }
  } else {
    // assembler / jeweler / fabricator: spinning gear + lights
    const rot = working ? ph * 2.5 : 0; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.fillStyle = 'rgba(30,30,34,.85)';
    ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const rr = i % 2 ? ts * 0.42 : ts * 0.55; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(0, 0, ts * 0.18, 0, 7); ctx.fill(); ctx.restore();
    if (working) { ctx.fillStyle = e.k === 'jeweler' ? `rgba(220,140,255,${0.4 + 0.3 * Math.sin(ph * 7)})` : `rgba(120,220,255,${0.4 + 0.3 * Math.sin(ph * 7)})`; ctx.beginPath(); ctx.arc(cx, cy, ts * 0.7, 0, 7); ctx.fill(); }
  }
  // status lamp, output arrow, recipe icon, progress
  ctx.fillStyle = working ? '#5dff7a' : r ? '#ffb340' : '#ff4d4d'; ctx.beginPath(); ctx.arc(x + p * 4, y + p * 4, Math.max(2, ts * 0.08), 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,240,180,.9)'; arrow(ctx, cx + DX[e.d] * ts * 0.82, cy + DY[e.d] * ts * 0.82, e.d, ts * 0.16);
  if (r) { drawItem(ctx, r.out[0], x + S - ts * 0.35, y + S - ts * 0.35, ts * 0.2); if (e.p) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x + p * 3, y + S - p * 3 - 4, S - p * 6, 4); ctx.fillStyle = '#5dff7a'; ctx.fillRect(x + p * 3, y + S - p * 3 - 4, (S - p * 6) * (e.p / recipeTicks(r)), 4); } }
  if (ts >= 18) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `${Math.floor(ts * 0.3)}px sans-serif`; ctx.textAlign = 'left'; ctx.fillText(d.name, x + p * 6, y + p * 5.5); }
  void FRECIPES;
}
