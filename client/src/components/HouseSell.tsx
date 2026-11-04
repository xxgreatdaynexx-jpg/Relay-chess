import { useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { SellQtyPicker } from './SellQtyPicker';
import { payoutFor, HOUSE_DAILY_BASE, priceOf, type ItemType } from '../../../shared/mines';

type Quote = { effAlready?: number; already: number; index?: number; capBase?: number } | null;
type Ack = { ok: boolean; error?: string; paid?: number; replay?: boolean; quote?: Quote; inMine?: boolean; guest?: boolean };
const rid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

/** Chud City Warehouse "Sell to house": an instant sale to the game at the house price (same daily tiers + price index as
 *  the Factory sell desk; server: mines_sell, ledger 'mines'). Each click carries a request id, so a retry never sells twice. */
export function HouseSell({ type, id, qty, name, testid = 'house-sell', onSold }: { type: string; id: string; qty: number; name: string; testid?: string; onSold?: (paid: number) => void }) {
  const [q, setQ] = useState<Quote>(null); const [st, setSt] = useState<{ inMine: boolean; guest: boolean }>({ inMine: false, guest: false });
  const [msg, setMsg] = useState('');
  const apply = (r: Ack) => { setQ(r.quote ?? null); setSt({ inMine: !!r.inMine, guest: !!r.guest }); };
  useEffect(() => { socket.timeout(5000).emit('mines_storage', {}, (err: Error | null, r?: Ack) => { if (!err && r?.ok) apply(r); }); }, [type, id, qty]);
  let unit = 0; try { unit = priceOf({ type: type as ItemType, id }); } catch { unit = 0; }
  if (unit <= 0) return <p className="house-sell-note" data-testid={`${testid}-none`}>The house does not buy {name}. List it on the player market instead.</p>;
  const idx = q?.index ?? 1; const capBase = q?.capBase ?? HOUSE_DAILY_BASE; const already = q?.effAlready ?? q?.already ?? 0;
  const preview = (n: number) => Math.floor(payoutFor(n * unit, already, capBase) * idx);
  const sell = (n: number) => new Promise<void>((done) => socket.timeout(8000).emit('mines_sell', { ore: `${type}:${id}`, qty: n, rid: rid() }, (err: Error | null, r?: Ack) => {
    done();
    if (err || !r) return setMsg('Sale failed, try again. Nothing was sold.');
    if (!r.ok) return setMsg(r.error ?? 'Sale failed.');
    apply(r); setMsg(`🏦 Sold ${n.toLocaleString()} ${name} to the house for 🪙 ${(r.paid ?? 0).toLocaleString()}.`); onSold?.(r.paid ?? 0);
  }));
  return (
    <div className="house-sell" data-testid={testid}>
      <b>🏦 Sell to house <small>instant · {Math.floor(unit * idx).toLocaleString()} each at today’s price index ×{idx.toFixed(2)} · daily cap applies</small></b>
      {st.guest ? <p className="house-sell-note">Sign in to sell for chips.</p> : st.inMine ? <p className="house-sell-note">Leave the mine to sell.</p>
        : <SellQtyPicker owned={qty} unit={name} testid={`${testid}-qty`} preview={preview} onSell={sell} />}
      {msg && <p className="house-sell-msg" data-testid={`${testid}-msg`}>{msg}</p>}
    </div>
  );
}
