import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { MODES, fmtEta, type Mode } from '../../../shared/logistics';

type Item = { item: string; label: string; qty: number };
type Loc = { id: string; label: string; hub: string; dest: boolean; sells: boolean; held?: boolean; items: Item[] };
type Ship = { id: string; fromLabel: string; toLabel: string; label: string; qty: number; mode: Mode; fee: number; departAt: number; arriveAt: number };
export type LocView = { now: number; locations: Loc[]; shipments: Ship[]; trucks: Array<{ id: string; model: string; busy: boolean }> };
const fmt = (n: number) => n.toLocaleString('en-US');
const LEG_MODES: Mode[] = ['truck', 'hired', 'plane', 'ship', 'jet', 'boat'];

/** Per-location stock: every farm / mine / fishing spot / kitchen / factory / warehouse holds its own goods.
 *  Goods move only by a real leg (truck on the same map; plane or ship between maps). Only the Warehouse sells. */
export function LocationStock({ me }: { me: string | null }) {
  const [v, setV] = useState<LocView | null>(null);
  const [sel, setSel] = useState<{ from: string; item: string } | null>(null);
  const [to, setTo] = useState(''); const [qty, setQty] = useState(1); const [mode, setMode] = useState<Mode>('truck');
  const [q, setQ] = useState<{ fee: number; trips: number; arriveAt: number } | null>(null); const [qErr, setQErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const take = (a: { ok: boolean; view?: unknown }) => { if (a.ok && a.view) setV(a.view as LocView); };
  const load = () => { void request('loc_view').then((a) => take(a as { ok: boolean; view?: unknown })); };
  useEffect(() => { if (!me) return; load(); const r = window.setInterval(load, 15_000);
    const arr = () => load(); socket.on('loc_arrived', arr); return () => { window.clearInterval(r); socket.off('loc_arrived', arr); }; }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = v?.locations.find((l) => l.id === sel?.from); const it = src?.items.find((i) => i.item === sel?.item);
  const dests = v?.locations.filter((l) => l.dest && l.id !== sel?.from) ?? [];
  const toLoc = v?.locations.find((l) => l.id === to); const same = !!(src && toLoc && src.hub === toLoc.hub);
  const modes = LEG_MODES.filter((m) => (same ? m === 'truck' || m === 'hired' : m !== 'truck' && m !== 'hired')); // same map: by truck only; other maps: plane/ship (server enforces both)
  useEffect(() => { if (!modes.includes(mode) && modes[0]) setMode(modes[0]); }, [same, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(null); setQErr(null); if (!sel || !to || !it) return; const t = window.setTimeout(() => {
    void request('loc_quote', { from: sel.from, to, item: sel.item, qty, mode }).then((a) => { if (a.ok) setQ((a as unknown as { quote: { fee: number; trips: number; arriveAt: number } }).quote); else setQErr(a.error ?? null); }); }, 200);
    return () => window.clearTimeout(t); }, [sel?.from, sel?.item, to, qty, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (ev: string, data: unknown, ok: (a: Record<string, unknown>) => string) => { setBusy(true); setMsg(null); const a = await request(ev, data); setBusy(false); take(a as { ok: boolean; view?: unknown }); setMsg(a.ok ? ok(a as unknown as Record<string, unknown>) : a.error ?? 'Something went wrong.'); };
  if (!me) return <p>Sign in to see the stock at each of your places.</p>;
  if (!v) return <p>Loading your stock…</p>;
  const now = Date.now();
  return (
    <div className="loc-stock" data-testid="loc-stock">
      <p className="loc-hint">Goods stay where they were made. Trucks move goods between places on the same map; between maps use the plane or ship. Only the Warehouse sells, and the co-op takes Warehouse stock.</p>
      {v.locations.map((l) => <div key={l.id} className="loc-card" data-testid={`loc-${l.id}`}>
        <h4>{l.label}{l.sells && ' · sells here'}</h4>
        {!l.items.length ? <small>Empty</small> : <ul>{l.items.map((i) => <li key={i.item}>
          <span>{i.label} × {fmt(i.qty)}</span>
          {!l.held && <button type="button" onClick={() => { setSel({ from: l.id, item: i.item }); setQty(i.qty); setTo(''); setMsg(null); }} data-testid={`loc-move-${l.id}-${i.item}`}>🚚 Move</button>}
          {l.sells && <button type="button" disabled={busy} onClick={() => void act('loc_sell', { item: i.item, qty: i.qty }, (a) => { const r = a.result as { sold: number; paid: number }; return `💰 Sold ${fmt(r.sold)} ${i.label} for 🪙 ${fmt(r.paid)}.`; })} data-testid={`loc-sell-${i.item}`}>💰 Sell all</button>}
        </li>)}</ul>}
      </div>)}
      {sel && it && src && <div className="freight-form loc-form" data-testid="loc-form">
        <b>Move {it.label} from {src.label}</b>
        <label>Quantity<input type="number" min={1} max={it.qty} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(it.qty, Math.floor(+e.target.value || 1))))} data-testid="loc-qty" /></label>
        <label>To<select value={to} onChange={(e) => setTo(e.target.value)} data-testid="loc-to"><option value="">Pick a place…</option>{dests.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        {to && <div className="freight-modes">{modes.map((m) => <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => setMode(m)} data-testid={`loc-mode-${m}`}><b>{MODES[m].icon} {MODES[m].label}</b></button>)}</div>}
        {to && <div className="freight-quote" data-testid="loc-quote">{q ? <>Fee <b>🪙 {fmt(q.fee)}</b> · {q.trips} trip{q.trips === 1 ? '' : 's'} · arrives in {fmtEta(q.arriveAt - now)}</> : qErr ?? '…'}</div>}
        <button type="button" className="dealer-drive" disabled={busy || !to || !q} onClick={() => void act('loc_move', { from: sel.from, to, item: sel.item, qty, mode }, () => { setSel(null); return `${MODES[mode].icon} ${fmt(qty)} ${it.label} on the way to ${toLoc?.label ?? to}.`; })} data-testid="loc-send">Send</button>
        <button type="button" onClick={() => setSel(null)}>Cancel</button>
      </div>}
      {msg && <p className="freight-msg" data-testid="loc-msg">{msg}</p>}
      {!!v.shipments.length && <div className="loc-card"><h4>On the road</h4><ul>{v.shipments.map((s) => <li key={s.id} data-testid="loc-shipment">{MODES[s.mode].icon} {fmt(s.qty)} {s.label}: {s.fromLabel} → {s.toLabel} · {s.arriveAt > now ? `arrives in ${fmtEta(s.arriveAt - now)}` : 'unloading'}</li>)}</ul></div>}
    </div>
  );
}
