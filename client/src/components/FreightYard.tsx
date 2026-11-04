import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { usePanelDrag } from '@/lib/panelDrag';
import { WarehouseSales } from './BuildingInventory';
import { HUBS, HUB_IDS, MODES, feeBase, fmtEta, type HubId, type LiveVehicle, type Mode, type TruckModel } from '../../../shared/logistics';

type Stack = { type: string; id: string; qty: number; name: string };
type Ship = { id: string; ownerName: string; toName: string; mode: Mode; from: HubId; to: HubId; itemId: string; type: string; qty: number; fee: number; departAt: number; arriveAt: number };
type View = { now: number; signedIn: boolean; chips: number | null; store: Array<TruckModel & { travelMs: number }>; fleet: Array<{ id: string; truckId: string; paid: number; busy: boolean }>;
  modes: Array<{ id: Mode; label: string; icon: string; blurb: string; next: number; cap: number; minFeeNow: number }>; stacks: Stack[]; shipments: Ship[]; live: LiveVehicle[] };
const fmt = (n: number) => n.toLocaleString('en-US');
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Logistics: ship goods map to map (own truck, hired truck, hourly freight plane, 2-hourly cargo ship) + the truck store. */
export function FreightYard({ onClose, me }: { onClose: () => void; me: string | null }) {
  useDoing('logistics');
  const drag = usePanelDrag('freight');
  const [v, setV] = useState<View | null>(null); const [tab, setTab] = useState<'ship' | 'store' | 'live' | 'sales'>('ship');
  const [item, setItem] = useState(''); const [qty, setQty] = useState(1); const [mode, setMode] = useState<Mode>('ship'); const [to, setTo] = useState<HubId>('resort'); const [who, setWho] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [, tick] = useState(0); useEffect(() => setMsg(null), [tab]); // Tess QA #5
  const load = () => { void request('freight_view').then((a) => { if (a.ok) setV(a as unknown as View); }); };
  useEffect(() => { load(); const t = window.setInterval(() => { tick((n) => n + 1); }, 1000); const r = window.setInterval(load, 15_000);
    const arr = (e: { qty: number; what: string }) => { setMsg(`📦 Delivered: ${e.qty} ${e.what}.`); load(); }; socket.on('freight_arrived', arr);
    return () => { window.clearInterval(t); window.clearInterval(r); socket.off('freight_arrived', arr); }; }, []);
  useEffect(() => { if (v && !item && v.stacks[0]) setItem(`${v.stacks[0].type}:${v.stacks[0].id}`); if (v && !v.fleet.length && mode === 'truck') setMode('hired'); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = v?.stacks.find((s) => `${s.type}:${s.id}` === item); const now = Date.now();
  const idx = v ? (v.modes.find((m) => m.id === 'ship')?.minFeeNow ?? 5) / 5 : 1;
  const fee = mode === 'truck' ? 0 : Math.round(feeBase(mode, qty) * idx);
  const freeTruck = v?.fleet.find((t) => !t.busy);
  const act = async (ev: string, data: unknown, ok: (a: Record<string, unknown>) => string) => { setBusy(true); setMsg(null); const a = await request(ev, data); setBusy(false); setMsg(a.ok ? ok(a as unknown as Record<string, unknown>) : a.error ?? 'Something went wrong.'); load(); };
  const send = () => { if (!st) return; const [type, id] = item.split(':'); void act('freight_ship', { type, id, qty, mode, from: 'city', to, recipient: who.trim() || undefined }, (a) => { const s = (a as { shipment: Ship }).shipment; return `${MODES[mode].icon} ${qty} ${st.name} booked. ${s.departAt > Date.now() ? `Departs ${clock(s.departAt)}, ` : ''}arrives ${clock(s.arriveAt)}.${s.fee ? ` Fee 🪙 ${fmt(s.fee)}.` : ''}`; }); };
  return (
    <div className="dealer freight" data-testid="freight-yard" {...backdropDismiss(() => onClose())}>
      <div className="dealer-box" data-drag-panel="freight" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
        <header><h3>📦 Chud Logistics</h3>{v?.chips != null && <span className="dealer-chips">{fmt(v.chips)} chips</span>}<button type="button" onClick={onClose} aria-label="Close" data-testid="freight-close">✕</button></header>
        <nav className="freight-tabs">{(['ship', 'store', 'live', 'sales'] as const).map((t) => <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={`freight-tab-${t}`}>{t === 'ship' ? '📦 Ship goods' : t === 'store' ? '🚚 Truck store' : t === 'sales' ? '💰 Warehouse sales' : `🗺 On the map (${v?.live.length ?? 0})`}</button>)}</nav>
        <div className="freight-body">
          {tab === 'sales' && <section><WarehouseSales /></section>}
          {tab === 'ship' && <section>
            <div className="freight-modes">{v?.modes.map((m) => { const dis = m.id === 'truck' && !freeTruck; return (
              <button key={m.id} type="button" disabled={dis} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} data-testid={`freight-mode-${m.id}`}>
                <b>{m.icon} {m.label}</b><small>{m.id === 'truck' ? (v.fleet.length ? (freeTruck ? 'Free · leaves now' : 'All trucks out') : 'You own no truck') : m.id === 'hired' ? 'Fee · leaves now' : `Next ${clock(m.next)} · in ${fmtEta(m.next - now)}`}</small>
                <em>{m.blurb}</em></button>); })}</div>
            {!me ? <p>Sign in to ship goods. Guests can watch the traffic on the map.</p> : !v?.stacks.length ? <p>Your storage is empty. Mine, farm or craft something to ship.</p> : <div className="freight-form">
              <label>Goods<select value={item} onChange={(e) => { setItem(e.target.value); setQty(1); }} data-testid="freight-item">{v.stacks.map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.name} ({fmt(s.qty)})</option>)}</select></label>
              <label>Quantity<input type="number" min={1} max={st?.qty ?? 1} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(st?.qty ?? 1, Math.floor(+e.target.value || 1))))} data-testid="freight-qty" /><button type="button" onClick={() => setQty(st?.qty ?? 1)}>All</button></label>
              <label>To<select value={to} onChange={(e) => setTo(e.target.value as HubId)} data-testid="freight-to">{HUB_IDS.map((h) => <option key={h} value={h}>{HUBS[h].icon} {HUBS[h].label}</option>)}</select></label>
              <label>Recipient<input placeholder="Me (or a player's name)" value={who} onChange={(e) => setWho(e.target.value)} data-testid="freight-who" /></label>
              <div className="freight-quote" data-testid="freight-quote">{mode === 'truck' ? 'Your truck: no fee.' : <>Fee <b>🪙 {fmt(fee)}</b> <small>({MODES[mode].label})</small></>} · ETA {fmtEta((mode === 'plane' || mode === 'ship' ? (v.modes.find((m) => m.id === mode)!.next - now) : 0) + MODES[mode].travelMs)}</div>
              <button type="button" className="dealer-drive" disabled={busy || !st} onClick={send} data-testid="freight-send">{MODES[mode].icon} Ship {fmt(qty)} {st?.name ?? ''}</button>
            </div>}
            <small className="dealer-note">Cargo ships leave every 2 hours from the ocean port and are the cheapest way to move goods. Freight planes leave the Airport every hour. No truck? Hire one for a fee. Every load shows on the map while it moves.</small>
            {!!v?.shipments.length && <div className="dealer-garage" data-testid="freight-mine"><h4>My shipments</h4>{v.shipments.map((s) => (
              <div key={s.id}><span>{MODES[s.mode].icon} {s.qty} {s.itemId} → {HUBS[s.to].label}{s.toName.toLowerCase() !== s.ownerName.toLowerCase() ? ` for ${s.toName}` : ''}</span><b>{s.departAt > now ? `loading · departs ${clock(s.departAt)}` : `arrives in ${fmtEta(s.arriveAt - now)}`}</b></div>))}</div>}
          </section>}
          {tab === 'store' && <section className="freight-store" data-testid="truck-store">
            {v?.store.map((t) => <div key={t.id} className="freight-truck"><i style={{ background: '#' + t.color.toString(16).padStart(6, '0') }} /><div><b>{t.name}</b><small>Hauls {fmt(t.cap)} units · {fmtEta(t.travelMs)} a trip · free shipping forever</small></div>
              <button type="button" disabled={busy || !v.signedIn} onClick={() => void act('truck_buy', { truck: t.id }, (a) => `Bought the ${t.name} for 🪙 ${fmt(Number(a.price))}.`)} data-testid={`truck-buy-${t.id}`}>🪙 {fmt(t.price)}</button></div>)}
            {!!v?.fleet.length && <div className="dealer-garage" data-testid="truck-fleet"><h4>My fleet</h4>{v.fleet.map((t) => <div key={t.id}><span>🚚 {v.store.find((s) => s.id === t.truckId)?.name ?? t.truckId}{t.busy ? ' (on a delivery)' : ''}</span>
              <button type="button" disabled={busy || t.busy} onClick={() => { if (confirm(`Sell for 🪙 ${fmt(Math.floor(t.paid / 2))}?`)) void act('truck_sell', { id: t.id }, (a) => `Sold for 🪙 ${fmt(Number(a.paid))}.`); }}>Sell {fmt(Math.floor(t.paid / 2))}</button></div>)}</div>}
            <small className="dealer-note">Trucks carry your goods for free and show on the map with your name while they drive. Sell back for 50% of what you paid.</small>
          </section>}
          {tab === 'live' && <section data-testid="freight-live">{v?.live.length ? v.live.map((x) => <div key={x.id} className="freight-live-row"><b>{MODES[x.mode].icon} {x.label}</b><span>{HUBS[x.from].label} → {HUBS[x.to].label} · {fmt(x.units)} units</span><em>{x.departAt > now ? `loading · departs ${clock(x.departAt)}` : `arrives in ${fmtEta(x.arriveAt - now)}`}</em></div>) : <p>Nothing moving right now.</p>}</section>}
          {msg && <div className="dealer-msg" role="status" data-testid="freight-msg">{msg}</div>}
        </div>
      </div>
    </div>
  );
}
