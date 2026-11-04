import { useCallback, useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { BUILDINGS, AUTO_DEFAULT, AUTO_MIN_LOAD, AUTO_MAX_FEE_SHARE, type AutoCfg, type BuildingId, type SaleLogRow } from '../../../shared/autosell';
import { MODES, MODE_IDS, feeBase, type Mode } from '../../../shared/logistics';

type Item = { key: string; label: string; qty: number; unit: number; needed: boolean };
type View = { buildings: Array<{ id: BuildingId; label: string; icon: string; items: Item[] }>; cfg: Record<string, AutoCfg>; log: SaleLogRow[]; truck: { id: string; cap: number } | null };
const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60_000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

/**
 * A building's own inventory (Millionaire Update): what is stored HERE, Ship & sell to the Chud City Warehouse (the only
 * market) by truck / plane / ship, and per-output auto-sell (toggle, reserve, keep for my recipes). Server: wh_* sockets.
 */
export function BuildingInventory({ building, compact }: { building: BuildingId; compact?: boolean }) {
  const [v, setV] = useState<View | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('hired'); const [qty, setQty] = useState<Record<string, string>>({});
  const load = useCallback(() => { void request('wh_view').then((r) => { const x = r as { ok: boolean } & View; if (x.ok) setV(x); }); }, []);
  useEffect(() => { load(); const on = () => load(); socket.on('wh_sold', on); socket.on('freight_arrived', on); const t = setInterval(load, 15_000); return () => { socket.off('wh_sold', on); socket.off('freight_arrived', on); clearInterval(t); }; }, [load]);
  const b = v?.buildings.find((x) => x.id === building); const meta = BUILDINGS[building];
  const cfgOf = (item: string): AutoCfg => v?.cfg[`${building}|${item}`] ?? AUTO_DEFAULT;
  const setCfg = async (item: string, patch: Partial<AutoCfg>) => { const r = await request('wh_cfg', { building, item, ...patch }) as { ok: boolean; error?: string } & View; if (r.ok) setV(r); else setMsg(r.error ?? 'Failed.'); };
  const ship = async (it: Item) => {
    const n = Math.floor(Number(qty[it.key] ?? it.qty)); setBusy(true); setMsg(null);
    const r = await request('wh_ship', { building, item: it.key, qty: n, mode }) as { ok: boolean; error?: string; result?: { fee: number; arriveAt: number } } & View;
    setBusy(false); if (r.ok) { setV(r); setMsg(`🚚 ${fmt(n)} ${it.label} on the road to the Chud City Warehouse${r.result?.fee ? ` (freight 🪙 ${fmt(r.result.fee)})` : ' (your truck, free)'}. It sells when it arrives.`); } else setMsg(r.error ?? 'Failed.');
  };
  const log = (v?.log ?? []).filter((r) => r.building === building).slice(0, compact ? 4 : 8);
  return (
    <div className="bldg-inv" data-testid={`bldg-inv-${building}`}>
      <h4>{meta.icon} {meta.label} inventory</h4>
      <small>{meta.blurb}</small>
      {building === 'farm' || (building === 'resort_farm') ? <label className="bldg-auto-row" data-testid={`auto-harvest-${building}`}>
        <input type="checkbox" checked={cfgOf('harvest').on} onChange={(e) => void setCfg('harvest', { on: e.target.checked })} /> Auto-harvest ready crops {building === 'farm' ? '(sold at the Warehouse market: city farms are in Chud City)' : 'into this barn'}
      </label> : null}
      {building !== 'farm' && <>
        <div className="bldg-modes">Ship by: {MODE_IDS.map((m) => <button key={m} type="button" className={mode === m ? 'on' : ''} disabled={m === 'truck' && !v?.truck} onClick={() => setMode(m)} data-testid={`bldg-mode-${m}`}>{MODES[m].icon} {MODES[m].label}</button>)}</div>
        {!b?.items.length ? <small className="bldg-empty">Nothing stored here yet.</small> : <table className="bldg-table"><tbody>
          {b.items.map((it) => { const c = cfgOf(it.key); const n = Math.floor(Number(qty[it.key] ?? it.qty)) || 0; return (
            <tr key={it.key} data-testid={`bldg-row-${it.key}`}>
              <td><b>{it.label}</b><br /><small>{fmt(it.qty)} here · ~🪙 {fmt(it.unit)}/u</small></td>
              <td><input type="number" min={1} max={it.qty} value={qty[it.key] ?? String(it.qty)} onChange={(e) => setQty({ ...qty, [it.key]: e.target.value })} style={{ width: 70 }} />
                <button type="button" disabled={busy || n < 1 || n > it.qty} onClick={() => void ship(it)} data-testid={`bldg-ship-${it.key}`}>🚚 Ship &amp; sell{mode !== 'truck' && n > 0 ? ` · fee 🪙 ${fmt(feeBase(mode, n))}` : ''}</button></td>
              <td className="bldg-auto"><label><input type="checkbox" checked={c.on} onChange={(e) => void setCfg(it.key, { on: e.target.checked })} data-testid={`bldg-auto-${it.key}`} /> Auto-sell</label>
                <label>Keep <input type="number" min={0} value={c.reserve} onChange={(e) => void setCfg(it.key, { reserve: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ width: 64 }} data-testid={`bldg-reserve-${it.key}`} /></label>
                <label title={it.needed ? 'Used by your recipes / running units' : 'Not used by any recipe'}><input type="checkbox" checked={c.keepRecipe} onChange={(e) => void setCfg(it.key, { keepRecipe: e.target.checked })} /> Keep for my recipes{it.needed ? ' ⚙' : ''}</label></td>
            </tr>); })}
        </tbody></table>}
        <small className="bldg-note">Auto-sell checks every minute: it sends a load once at least {AUTO_MIN_LOAD} units sit above your reserve, on your idle truck (free) or a hired rig only if the fee is ≤ {Math.round(AUTO_MAX_FEE_SHARE * 100)}% of the load’s value.</small>
      </>}
      {msg && <p className="bldg-msg" data-testid="bldg-msg">{msg}</p>}
      {log.length > 0 && <div className="bldg-log"><b>Warehouse sales</b>{log.map((r) => <div key={r.id}>{r.auto ? '🤖' : '🚚'} {fmt(r.qty)} {r.item} · {r.status === 'sold' ? `sold 🪙 ${fmt(r.paid)}` : 'stored at the Warehouse'}{r.fee ? ` · freight 🪙 ${fmt(r.fee)}` : ''} · {ago(r.at)}</div>)}</div>}
    </div>
  );
}

/** Every warehouse sale (manual + auto) with its freight fee, for the Chud Logistics yard. */
export function WarehouseSales() {
  const [v, setV] = useState<View | null>(null);
  useEffect(() => { const l = () => { void request('wh_view').then((r) => { const x = r as { ok: boolean } & View; if (x.ok) setV(x); }); }; l(); socket.on('wh_sold', l); const t = setInterval(l, 15_000); return () => { socket.off('wh_sold', l); clearInterval(t); }; }, []);
  if (!v) return <p>Loading…</p>;
  if (!v.log.length) return <p>No warehouse sales yet. Use Ship &amp; sell in a building’s inventory, or turn on auto-sell.</p>;
  return <div className="bldg-log" data-testid="wh-sales">{v.log.map((r) => <div key={r.id}>{r.auto ? '🤖 auto' : '🚚 manual'} · {BUILDINGS[r.building as BuildingId]?.icon ?? ''} {fmt(r.qty)} {r.item} · {r.status === 'sold' ? `sold 🪙 ${fmt(r.paid)}` : r.status} · freight 🪙 {fmt(r.fee)} · {ago(r.at)}</div>)}</div>;
}
