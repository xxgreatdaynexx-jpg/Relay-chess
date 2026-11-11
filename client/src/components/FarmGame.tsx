import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { socket } from '@/lib/net';
import { indexed } from '../../../shared/priceIndex';
import { TROPICAL_CROPS } from '../../../shared/resort';
import { FARM_UPGRADES, MAX_UPGRADE_LEVEL, NO_UPGRADES, upgradePrice } from '../../../shared/farmUpgrades';
import { CROPS as CITY_CROPS, cropById, cropSellValue, growProgressPct, type FarmView } from '../../../shared/farm';
import { boxOrigin, boxTiles, FARM_TEMPLATE_NAME_MAX, packSelection, stampLayout, tileAtPoint, type FarmTemplate } from '../../../shared/farmTemplates';
import { usePanelDrag } from '@/lib/panelDrag';

const chips = (n: number) => n.toLocaleString('en-US');
/** Compact countdown on ripe tiles, e.g. "11h" or "40m" (full text is in the tooltip). */
const witherHint = (ms: number) => { const m = Math.max(0, Math.ceil(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`; };
const dur = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${x}s` : `${x}s`; };
type Ack = { ok: boolean; error?: string; [k: string]: unknown };

/** FarmVille-style plot: a tile grid sized to the plot, a seed shop and real-time (server-clocked) crops. */
export function FarmGame({ id, label, onClose, onAllFarms }: { id: string; label: string; onClose: () => void; onAllFarms?: () => void }) {
  useDoing('farming', label);
  const dragFarm = usePanelDrag('farm');
  const [view, setView] = useState<FarmView | null>(null);
  const [skew, setSkew] = useState(0); // server now - client now
  const [now, setNow] = useState(Date.now());
  const CROPS = id.startsWith('rf:') ? TROPICAL_CROPS : CITY_CROPS; // resort plantation plots grow tropical crops only
  const resortPlot = id.startsWith('rf:');
  const pantryWhere = resortPlot ? 'resort pantry (Resort Warehouse)' : 'kitchen pantry';
  const [seed, setSeed] = useState(CROPS[0]!.id);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [box, setBox] = useState<[number, number] | null>(null);
  const [templates, setTemplates] = useState<FarmTemplate[]>([]);
  const [tplName, setTplName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragSel = useRef<{ start: number; moved: boolean; add: boolean } | null>(null);
  const skipClick = useRef(false);
  const viewRef = useRef(view); viewRef.current = view;
  const busyRef = useRef(busy); busyRef.current = busy;
  const skewRef = useRef(skew); skewRef.current = skew;
  const nowRef = useRef(now); nowRef.current = now;
  const load = useCallback(() => {
    socket.timeout(10_000).emit('farm_view', { id }, (err: Error | null, r?: Ack) => {
      if (err || !r?.ok) { setMsg(err ? 'No answer from the server.' : r?.error ?? 'Could not load the farm.'); return; }
      const v = r.farm as FarmView; setView(v); setSkew(v.now - Date.now()); if (v.auto?.crop && CROPS.some((c) => c.id === v.auto!.crop)) setSeed(v.auto.crop);
    });
  }, [id]);
  const loadTpl = useCallback(() => {
    socket.timeout(10_000).emit('farm_templates', {}, (err: Error | null, r?: Ack) => {
      if (!err && r?.ok && Array.isArray(r.templates)) setTemplates(r.templates as FarmTemplate[]);
    });
  }, []);
  useEffect(() => { load(); const h = (e: { id?: string }) => { if (e?.id === id) load(); }; socket.on('farm_changed', h); return () => { socket.off('farm_changed', h); }; }, [id, load]);
  useEffect(() => { loadTpl(); }, [loadTpl]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  // QA r8: live growth. Re-sync with the server right after the next crop ripens or withers, on tab focus, and every 30 s.
  useEffect(() => {
    if (!view) return; const tn = Date.now() + skew;
    const next = Math.min(...view.tiles.flatMap((x) => [x.readyAt, x.witherAt]).filter((v) => v > tn), tn + 30_000);
    const tm = window.setTimeout(load, Math.max(500, next - tn + 400));
    const vis = () => { if (document.visibilityState === 'visible') load(); }; document.addEventListener('visibilitychange', vis);
    return () => { window.clearTimeout(tm); document.removeEventListener('visibilitychange', vis); };
  }, [view, skew, load]);
  const t = now + skew; const idx = view?.index ?? 1;
  const byTile = new Map((view?.tiles ?? []).map((x) => [x.tile, x]));
  const stage = (tile: number) => {
    const x = byTile.get(tile); if (!x) return 'empty';
    if (t >= x.witherAt) return 'withered';
    return t >= x.readyAt ? 'ready' : 'growing';
  };
  const stageLive = (v: FarmView, tile: number) => {
    const x = v.tiles.find((row) => row.tile === tile); if (!x) return 'empty';
    const at = nowRef.current + skewRef.current;
    if (at >= x.witherAt) return 'withered';
    return at >= x.readyAt ? 'ready' : 'growing';
  };
  const n = view ? view.cols * view.rows : 0;
  const empties = Array.from({ length: n }, (_, i) => i).filter((i) => stage(i) === 'empty');
  const ready = Array.from({ length: n }, (_, i) => i).filter((i) => { const x = byTile.get(i); return !!x && t >= x.readyAt && t < x.witherAt; });
  const withered = Array.from({ length: n }, (_, i) => i).filter((i) => stage(i) === 'withered');
  const nextReadyIn = view ? Math.min(...view.tiles.map((x) => x.readyAt).filter((at) => at > t), Infinity) : Infinity;
  const boxed = view && box ? new Set(boxTiles(view.cols, view.rows, box[0], box[1])) : null;
  const act = (ev: string, body: Record<string, unknown>, ok: (r: Ack) => string) => {
    setBusy(true); setMsg(null);
    socket.timeout(10_000).emit(ev, { id, ...body }, (err: Error | null, r?: Ack) => { setBusy(false); setMsg(err ? 'No answer from the server.' : r?.ok ? ok(r) : r?.error ?? 'Something went wrong.'); setSel(new Set()); load(); });
  };
  const tplAct = (ev: string, body: Record<string, unknown>, ok: (r: Ack) => string) => {
    setBusy(true); setMsg(null);
    socket.timeout(10_000).emit(ev, body, (err: Error | null, r?: Ack) => {
      setBusy(false);
      setMsg(err ? 'No answer from the server.' : r?.ok ? ok(r) : r?.error ?? 'Something went wrong.');
      if (!err && r?.ok) {
        if (Array.isArray(r.templates)) setTemplates(r.templates as FarmTemplate[]);
        else loadTpl();
      }
    });
  };
  const crop = cropById(seed)!;
  const plant = (tiles: number[]) => tiles.length && act('farm_plant', { crop: seed, tiles }, (r) => `Planted ${r.planted} × ${crop.label} for 🪙 ${chips(Number(r.cost))}.`);
  const click = (i: number) => {
    if (skipClick.current) { skipClick.current = false; return; }
    if (!view?.mine || busy) return; const s = stage(i);
    if (ready.includes(i)) act('farm_harvest', { tiles: [i] }, (r) => `Harvested for 🪙 ${chips(Number(r.paid))}.`);
    else if (s === 'empty') setSel((p) => { const q = new Set(p); if (q.has(i)) q.delete(i); else q.add(i); return q; });
  };
  const tileFromPtr = (e: { clientX: number; clientY: number }) => {
    const el = gridRef.current, v = viewRef.current;
    if (!el || !v) return null;
    return tileAtPoint(v.cols, v.rows, el.getBoundingClientRect(), e.clientX, e.clientY);
  };
  const onGridPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!viewRef.current?.mine || busyRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const i = tileFromPtr(e); if (i == null) return;
    dragSel.current = { start: i, moved: false, add: e.shiftKey };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
  };
  const onGridPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragSel.current; if (!d) return;
    const i = tileFromPtr(e); if (i == null) return;
    if (i !== d.start) d.moved = true;
    if (d.moved) setBox([d.start, i]);
  };
  const onGridPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragSel.current; dragSel.current = null;
    const v = viewRef.current;
    if (!d || !v || !d.moved) { setBox(null); return; }
    skipClick.current = true;
    const end = tileFromPtr(e) ?? d.start;
    const tiles = boxTiles(v.cols, v.rows, d.start, end);
    setSel((p) => {
      const q = d.add ? new Set(p) : new Set<number>();
      for (const tile of tiles) if (stageLive(v, tile) === 'empty') q.add(tile);
      return q;
    });
    setBox(null);
  };
  const saveTemplate = () => {
    if (!view?.mine || busy) return;
    const label = tplName.trim();
    if (!label) { setMsg('Pick a template name (up to 32 characters).'); return; }
    let layout;
    if (sel.size) {
      const cells = [...sel].map((tile) => ({ tile, crop: byTile.get(tile)?.crop ?? seed }));
      layout = packSelection(view.cols, view.rows, cells);
    } else {
      const cells = view.tiles.map((row) => ({ tile: row.tile, crop: row.crop }));
      layout = cells.length ? { cols: view.cols, rows: view.rows, cells } : 'Plant or select tiles first.';
    }
    if (typeof layout === 'string') { setMsg(layout); return; }
    tplAct('farm_template_save', { name: label, cols: layout.cols, rows: layout.rows, cells: layout.cells }, () => `Saved template “${label}”.`);
  };
  const applyTemplate = (tmpl: FarmTemplate) => {
    if (!view?.mine || busy) return;
    const origin = sel.size ? boxOrigin(view.cols, [...sel]) : 0;
    const cells = stampLayout(tmpl, view.cols, view.rows, origin);
    const plantable = cells.filter((c) => stage(c.tile) === 'empty');
    if (!plantable.length) { setMsg(cells.length ? 'Every tile in that template is already planted.' : 'That template does not fit this field.'); return; }
    act('farm_template_apply', { templateId: tmpl.id, origin }, (r) => {
      const skipped = Number(r.skipped ?? 0);
      return `Planted ${r.planted} from “${tmpl.name}” for 🪙 ${chips(Number(r.cost))}${skipped ? ` (skipped ${skipped} already planted)` : ''}.`;
    });
  };
  const applyCost = (tmpl: FarmTemplate) => {
    if (!view) return 0;
    const origin = sel.size ? boxOrigin(view.cols, [...sel]) : 0;
    return stampLayout(tmpl, view.cols, view.rows, origin)
      .filter((c) => stage(c.tile) === 'empty')
      .reduce((sum, c) => sum + indexed(cropById(c.crop)?.seed ?? 0, idx), 0);
  };
  const canSaveField = !!view && view.tiles.length > 0;
  return (
    <MapSheet className="world-deed world-farm" data-testid="farm-game" data-drag-panel="farm" onPointerDown={dragFarm.onPointerDown} style={dragFarm.style()} ref={dragFarm.ref}>{dragFarm.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>🌾 {label}</h3>
      {onAllFarms && <button type="button" onClick={onAllFarms} data-testid="farm-all-farms">🏡 Barn · All my farms</button>}
      {!view ? <small>{msg ?? 'Loading the farm…'}</small> : <>
        <small>{view.mine ? 'Your farm. Pick a seed, then click empty tiles or drag a box to select a region (Shift-drag adds to the selection), and plant them. Save a crop layout as a named template and apply it later to plant the same pattern on empty tiles. Ripe crops wait at least 12 hours before they wither.' : `${view.owner ?? 'Nobody'}'s farm (visiting, read-only).`}</small>
        <div
          className="farm-grid"
          style={{ gridTemplateColumns: `repeat(${view.cols}, 1fr)` }}
          data-testid="farm-grid"
          data-no-drag
          ref={gridRef}
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerUp}
          onPointerCancel={() => { dragSel.current = null; setBox(null); }}
        >
          {Array.from({ length: n }, (_, i) => { const x = byTile.get(i); const s = stage(i); const c = x && cropById(x.crop);
            const title = !x ? 'Empty' : s === 'growing' ? `${c?.label}: ready in ${dur(x.readyAt - t)}` : s === 'ready' ? `${c?.label}: ready! withers in ${dur(x.witherAt - t)}` : `${c?.label}: withered`;
            return <button key={i} type="button" title={title} className={`farm-tile farm-${s}${sel.has(i) ? ' farm-sel' : ''}${boxed?.has(i) ? ' farm-box' : ''}`} onClick={() => click(i)} data-testid={`farm-tile-${i}`}>
              {s === 'empty' ? '' : s === 'withered' ? '🥀' : s === 'ready' ? c?.emoji : x && (t - x.plantedAt) / (x.readyAt - x.plantedAt) >= 0.5 ? '🌿' : '🌱'}
              {s === 'ready' && x && <b className="farm-wither" data-testid={`farm-wither-${i}`}>{witherHint(x.witherAt - t)}</b>}
              {s === 'growing' && x && <b className="farm-wither" data-testid={`farm-ready-in-${i}`}>{witherHint(x.readyAt - t)}</b>}
              {s === 'growing' && x && <i data-testid={`farm-grow-bar-${i}`} style={{ width: `${growProgressPct(x.plantedAt, x.readyAt, t)}%` }} />}
            </button>; })}
        </div>
        {view.mine && <>
          <h4>Seed shop</h4>
          <div className="farm-seeds" data-testid="farm-seeds">
            {CROPS.map((c) => <button key={c.id} type="button" className={seed === c.id ? 'on' : ''} onClick={() => { setSeed(c.id); if (view.auto?.plant) act('farm_auto', { harvest: view.auto?.harvest ?? false, pantry: view.auto?.pantry ?? false, plant: true, crop: c.id }, () => `Auto-plant seed set to ${c.label}.`); }} data-testid={`farm-seed-${c.id}`}>
              <b>{c.emoji} {c.label}</b><span>🪙{chips(indexed(c.seed, idx))} → {chips(indexed(cropSellValue(c), idx))} · {dur(c.grow)}</span></button>)}
          </div>
          <button type="button" disabled={busy || !sel.size} onClick={() => plant([...sel])} data-testid="farm-plant-sel">Plant {sel.size || ''} selected<span>🪙 {chips(indexed(crop.seed, idx) * sel.size)}</span></button>
          <button type="button" disabled={busy || !empties.length} onClick={() => plant(empties)} data-testid="farm-plant-all">Plant all {empties.length} empty<span>🪙 {chips(indexed(crop.seed, idx) * empties.length)}</span></button>
          <button type="button" disabled={busy || !ready.length} onClick={() => act('farm_harvest', {}, (r) => `Harvested ${r.harvested} for 🪙 ${chips(Number(r.paid))}.`)} data-testid="farm-harvest">Harvest {ready.length} ready{!ready.length && Number.isFinite(nextReadyIn) ? ` · first in ${witherHint(nextReadyIn - t)}` : ''}</button>
          <button type="button" disabled={busy || !ready.length} onClick={() => act('farm_harvest', { pantry: true }, (r) => `🧺 ${r.harvested} crop${r.harvested === 1 ? '' : 's'} into your ${pantryWhere}.`)} title={resortPlot ? 'Keep the crops in the Resort Warehouse for resort kitchen cooking' : 'Keep the crops for cooking instead of selling them'} data-testid="farm-harvest-pantry">🧺 To pantry</button>
          <div className="farm-templates" data-testid="farm-templates">
            <h4>Crop templates</h4>
            <small>Save the field as it is, or save the current selection (empty selected tiles use the seed you have picked). Apply stamps from the top-left of the field, or from the top-left of your selection. Only empty tiles are planted, and seeds cost the same as planting by hand.</small>
            <div className="farm-tpl-row">
              <input type="text" maxLength={FARM_TEMPLATE_NAME_MAX} value={tplName} placeholder="Template name" aria-label="Template name" data-testid="farm-tpl-name" onChange={(e) => setTplName(e.target.value)} />
              <button type="button" disabled={busy || !tplName.trim() || (!sel.size && !canSaveField)} onClick={saveTemplate} data-testid="farm-tpl-save">Save {sel.size ? 'selection' : 'field'} as template</button>
            </div>
            {templates.length === 0 ? <small>No saved templates yet.</small> : <ul>
              {templates.map((tmpl) => <li key={tmpl.id} className="farm-tpl-row" data-testid={`farm-tpl-${tmpl.id}`}>
                <b>{tmpl.name}</b>
                <small>{tmpl.cols}×{tmpl.rows} · {tmpl.cells.length} tile{tmpl.cells.length === 1 ? '' : 's'}</small>
                <button type="button" disabled={busy || applyCost(tmpl) <= 0} onClick={() => applyTemplate(tmpl)} data-testid={`farm-tpl-apply-${tmpl.id}`}>Apply{applyCost(tmpl) > 0 ? ` · 🪙 ${chips(applyCost(tmpl))}` : ''}</button>
                <button type="button" disabled={busy} onClick={() => tplAct('farm_template_delete', { id: tmpl.id }, () => `Deleted template “${tmpl.name}”.`)} data-testid={`farm-tpl-del-${tmpl.id}`}>Delete</button>
              </li>)}
            </ul>}
          </div>
          <div className="farm-auto" data-testid="farm-auto">
            <h4>Auto</h4>
            <label className="farm-auto-row"><input type="checkbox" checked={!!view.auto?.harvest && !view.auto?.pantry} disabled={busy}
              onChange={(e) => act('farm_auto', { harvest: e.target.checked, pantry: false, plant: view.auto?.plant ?? false, crop: view.auto?.crop ?? seed }, () => e.target.checked ? 'Auto-harvest on (sells for chips).' : 'Auto-harvest off.')}
              data-testid="farm-auto-harvest" /> Auto-harvest ready crops (sells for chips)</label>
            <label className="farm-auto-row"><input type="checkbox" checked={!!view.auto?.pantry} disabled={busy}
              onChange={(e) => act('farm_auto', { harvest: e.target.checked, pantry: e.target.checked, plant: view.auto?.plant ?? false, crop: view.auto?.crop ?? seed }, () => e.target.checked ? (resortPlot ? 'Auto-harvest to resort pantry on for this plantation.' : 'Auto-harvest to pantry on for this farm.') : 'Auto-harvest to pantry off.')}
              data-testid="farm-auto-pantry" /> Auto-harvest to {resortPlot ? 'resort pantry (Resort Warehouse)' : 'pantry (kitchen ingredients)'}</label>
            <label className="farm-auto-row"><input type="checkbox" checked={!!view.auto?.plant} disabled={busy}
              onChange={(e) => act('farm_auto', { harvest: view.auto?.harvest ?? false, pantry: view.auto?.pantry ?? false, plant: e.target.checked, crop: seed }, () => e.target.checked ? `Auto-plant on with ${crop.label}.` : 'Auto-plant off.')}
              data-testid="farm-auto-plant" /> Auto-plant empty tiles with selected seed</label>
            <small>Runs on the server about every 30 minutes even while you are logged out. Respects overnight sleep and farm rate limits. If the {resortPlot ? 'Resort Warehouse pantry' : 'pantry'} is full, ripe crops stay on the field — never lost. Sell and pantry auto are alternatives; turning one on clears the other. Changing seed updates auto-plant crop when auto-plant is on.</small>
          </div>
          <h4>Upgrades</h4>
          <div className="farm-upgrades" data-testid="farm-upgrades">
            {FARM_UPGRADES.map((u) => { const lvl = (view.upgrades ?? NO_UPGRADES)[u.id]; const base = upgradePrice(u.id, lvl, n); const cost = base === null ? null : indexed(base, idx);
              return <button key={u.id} type="button" disabled={busy || cost === null} title={u.blurb} data-testid={`farm-upgrade-${u.id}`}
                onClick={() => cost !== null && window.confirm(`Buy ${u.label} level ${lvl + 1} for 🪙 ${chips(cost)}?`) && act('farm_upgrade', { kind: u.id }, (r) => `${u.label} is now level ${r.level} (🪙 ${chips(Number(r.cost))}).`)}>
                <b>{u.emoji} {u.label} {lvl}/{MAX_UPGRADE_LEVEL}</b>
                <span>{lvl ? u.effect(lvl) : u.blurb}</span>
                <span>{cost === null ? 'Maxed out' : `Next: ${u.effect(lvl + 1)} · 🪙 ${chips(cost)}`}</span>
              </button>; })}
          </div>
          {withered.length > 0 && <button type="button" disabled={busy} onClick={() => act('farm_clear', {}, (r) => `Cleared ${r.cleared} withered.`)} data-testid="farm-clear">Clear {withered.length} withered</button>}
          <small data-testid="farm-today">Today’s farm profit: 🪙 {chips(view.today.gross)} (paid 🪙 {chips(view.today.paid)}). There is no daily farm profit cap — every harvest pays its full value.</small>
        </>}
        {msg && <small data-testid="farm-msg">{msg}</small>}
      </>}
    </MapSheet>
  );
}
