/** Market buy requests: post in Market → Resources; fill from Factory / Warehouse only when a matching open request exists. */
import { useCallback, useEffect, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { request } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { matchesItemSearch, type CatEntry } from '@/lib/marketCatalog';
import { listFee, receiveFor } from '../../../shared/marketSell';

export type PackItem = { type: string; id: string; qty: number; name: string };
const houseFmt = (n: number | undefined) => (n != null && n > 0 ? `${(+n.toFixed(2)).toLocaleString()} 🪙` : '—');

export type RequestRow = { id: string; type: string; itemId: string; name: string; qty: number; total: number; unit: number; escrow: number; buyer: string; at: number; mine: boolean };
export type MatchItem = { type: string; id: string; qty: number; name: string; requests: RequestRow[] };
type Ack = { ok: boolean; error?: string; [k: string]: unknown };
const fmt = (n: number) => `${n.toLocaleString()} 🪙`;

export function useMatchingRequests(enabled = true) {
  const [items, setItems] = useState<MatchItem[]>([]);
  const load = useCallback(() => {
    if (!enabled) { setItems([]); return; }
    void request('mkt_matching_requests', {}).then((r) => { const a = r as Ack; if (a.ok) setItems((a.items as MatchItem[]) ?? []); });
  }, [enabled]);
  useEffect(() => { load(); if (!enabled) return; const t = window.setInterval(load, 4000); return () => window.clearInterval(t); }, [load, enabled]);
  return { items, reload: load };
}

/** Fill one open request (or pick among several) for a stack the player already has. Renders nothing when there is no match. */
export function SellToMarketRequest({ type, id, have, name, onSold, testid = 'req-sell' }: { type: string; id: string; have: number; name: string; onSold?: (msg: string) => void; testid?: string }) {
  const { items, reload } = useMatchingRequests(have > 0);
  const match = items.find((x) => x.type === type && x.id === id);
  if (!match || !match.requests.length || have < 1) return null;
  return <FillRequestCard item={{ ...match, qty: have, name }} onSold={onSold} onReload={reload} testid={testid} />;
}

export function FillRequestCard({ item, onSold, onReload, testid = 'req-sell' }: { item: MatchItem; onSold?: (msg: string) => void; onReload?: () => void; testid?: string }) {
  const [pick, setPick] = useState(item.requests[0]?.id ?? '');
  const [n, setN] = useState(1);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const r = item.requests.find((x) => x.id === pick) ?? item.requests[0];
  if (!r) return null;
  const max = Math.max(1, Math.min(item.qty, r.qty));
  const q = Math.max(1, Math.min(max, Math.floor(n) || 1));
  const get = receiveFor(q, r.unit); const fee = listFee(q, r.unit);
  return (
    <div className="mreq-fill" data-testid={testid}>
      <p className="mreq-fill-h">Sell to a market request</p>
      {item.requests.length > 1 && (
        <label className="msell-l">Buyer / bid
          <select value={r.id} onChange={(e) => { setPick(e.target.value); setN(1); }} data-testid={`${testid}-pick`}>
            {item.requests.map((x) => <option key={x.id} value={x.id}>{x.buyer} · {x.unit.toLocaleString()} each · wants {x.qty.toLocaleString()}</option>)}
          </select>
        </label>
      )}
      {item.requests.length === 1 && <p className="inv-note">{r.buyer} wants {r.qty.toLocaleString()} {item.name} at {fmt(r.unit)} each.</p>}
      <label className="msell-l">Quantity (you have {item.qty.toLocaleString()}, they want {r.qty.toLocaleString()})</label>
      <div className="msell-qrow">
        <input type="range" min={1} max={max} value={q} onChange={(e) => setN(Number(e.target.value))} data-testid={`${testid}-slider`} />
        <input type="number" min={1} max={max} value={n} onChange={(e) => setN(Number(e.target.value))} data-testid={`${testid}-qty`} />
      </div>
      <p className="msell-get">You receive <b>{fmt(get)}</b> after the 5% fee ({fmt(fee)}). The house-sell cap does not apply.</p>
      <button type="button" className="msell-list" disabled={busy} data-testid={`${testid}-go`} onClick={() => {
        setBusy(true); setErr('');
        void request('mkt_fill_request', { id: r.id, qty: q }).then((res) => {
          const a = res as Ack; setBusy(false);
          if (!a.ok) { setErr(a.error ?? 'Failed'); return; }
          onReload?.();
          onSold?.(`Sold ${q} ${item.name} to ${r.buyer}'s request for ${get.toLocaleString()} after fee.`);
        });
      }}>Sell {q.toLocaleString()} for {fmt(q * r.unit)}</button>
      {err && <p className="inv-err">{err}</p>}
    </div>
  );
}

/** Market → Resources: post a buy request (chips escrowed up front) and browse / cancel / fill open ones. */
export function BuyRequestsBoard({ pack, cat, onChanged }: { pack: PackItem[]; cat: CatEntry[]; onChanged?: () => void }) {
  const account = useAccount();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [q, setQ] = useState('');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState(10);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void request('mkt_requests', {}).then((r) => { const a = r as Ack; if (a.ok) setRows((a.requests as RequestRow[]) ?? []); });
  }, []);
  useEffect(() => { load(); }, [load, account]);
  const act = async (ev: string, body: object, ok: string) => {
    setErr(''); setMsg(''); setBusy(true);
    const r = (await request(ev, body)) as Ack; setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
    setMsg(ok); load(); onChanged?.();
  };
  const options = cat.map((e) => { const parts = e.what.startsWith('stack:') ? e.what.slice(6).split(':') : []; return { key: e.what, type: parts[0] ?? e.type, id: parts[1] ?? e.what, name: e.name, house: e.house ?? 0 }; }).filter((o) => o.type && o.id && matchesItemSearch(o.name, q));
  const sel = options.find((o) => o.key === item) ?? options[0];
  const shown = rows.filter((r) => matchesItemSearch(r.name, q));
  const n = Math.max(1, Math.floor(qty) || 1); const u = Math.max(1, Math.floor(unit) || 1); const escrow = n * u;
  const have = (type: string, id: string) => pack.find((p) => p.type === type && p.id === id)?.qty ?? 0;
  return (
    <div className="mreq" data-testid="mkt-requests">
      <h3 className="msell-h">📋 Buy requests <small>post a want; chips are held until it fills or you cancel</small></h3>
      <div className="inv-filters"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" data-testid="mkt-request-search" aria-label="Search buy requests and items" /></div>
      {account && sel && (
        <form className="mreq-post" data-testid="mkt-request-post" onSubmit={(e) => { e.preventDefault(); void act('mkt_request', { type: sel.type, id: sel.id, qty: n, unit: u }, `Posted a request for ${n} ${sel.name} at ${u} each. ${escrow.toLocaleString()} chips held.`); }}>
          <label>Item <select value={sel.key} onChange={(e) => setItem(e.target.value)} data-testid="mkt-request-item">{options.map((o) => <option key={o.key} value={o.key}>{o.name}{o.house > 0 ? ` · house ${houseFmt(o.house)}` : ''}</option>)}</select></label>
          <label>Quantity <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} data-testid="mkt-request-qty" /></label>
          <label>Price each <input type="number" min={1} value={unit} onChange={(e) => setUnit(Number(e.target.value))} data-testid="mkt-request-unit" /></label>
          {sel.house > 0 && <p className="inv-note" data-testid="mkt-request-house">House pays {houseFmt(sel.house)} each for {sel.name}.</p>}
          <button type="submit" disabled={busy} data-testid="mkt-request-go">Post · hold {fmt(escrow)}</button>
        </form>
      )}
      {!account && <p className="inv-note">Sign in to post a buy request.</p>}
      {account && q.trim() && !options.length && <p className="inv-note">No items match that search.</p>}
      <table className="mkt-table" data-testid="mkt-request-table">
        <thead><tr><th>Item</th><th>Unit</th><th>Wanted</th><th>Buyer</th><th /></tr></thead>
        <tbody>
          {shown.map((r) => {
            const own = have(r.type, r.itemId);
            const k = Math.max(1, Math.min(r.qty, own));
            return (
              <tr key={r.id}>
                <td><ItemIcon type={r.type} id={r.itemId} size={20} className="mkt-mat-icon" /> {r.name}</td>
                <td>{fmt(r.unit)}</td>
                <td>{r.qty.toLocaleString()}{r.total !== r.qty ? ` / ${r.total.toLocaleString()}` : ''}</td>
                <td>{r.buyer}{r.mine ? ' (you)' : ''}</td>
                <td>
                  {r.mine ? <button type="button" onClick={() => void act('mkt_cancel_request', { id: r.id }, 'Request cancelled; leftover chips returned.')} data-testid="mkt-request-cancel">Cancel</button>
                    : own > 0 ? <button type="button" disabled={!account || busy} onClick={() => void act('mkt_fill_request', { id: r.id, qty: k }, `Sold ${k} ${r.name} to the request.`)} data-testid="mkt-request-fill">Sell {k.toLocaleString()}</button>
                    : <span className="inv-note"> </span>}
                </td>
              </tr>
            );
          })}
          {!shown.length && <tr><td colSpan={5} className="inv-note">{rows.length ? 'No open requests match that search.' : 'No open buy requests.'}</td></tr>}
        </tbody>
      </table>
      {msg && <p className="mkt-ok">{msg}</p>}{err && <p className="inv-err">{err}</p>}
      <p className="inv-note">The buyer pays the posted unit price up front. Sellers keep the price minus the usual 5% Market fee. Cancel returns any leftover escrow. The house-sell cap does not apply.</p>
    </div>
  );
}
