import { useCallback, useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { backdropDismiss } from '@/lib/backdrop';
import { MapSheet } from './MapSheet';
import { ANIMALS, BARN_HOURS, HAND_BARN_HOURS, HAND_MAX_DAYS, animalDay, type AnimalId, type RanchView } from '../../../shared/westRanch';

const fmt = (n: number) => n.toLocaleString('en-US');
type Res = { ok: boolean; error?: string; result?: Record<string, unknown>; ranch?: RanchView };

/** A West Chud ranch you own (shared/westRanch.ts): stock animals, collect what they produce, hire a ranch hand. */
export function RanchPanel({ id, onClose, onDeed }: { id: string; onClose: () => void; onDeed?: () => void }) {
  const [v, setV] = useState<RanchView | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [n, setN] = useState<Record<AnimalId, number>>({ cow: 1, sheep: 1, pig: 1, chicken: 5 }); const [days, setDays] = useState(1);
  const reload = useCallback(() => void request('ranch_state', { id }).then((a) => { const r = a as Res; if (r.ranch) setV(r.ranch); else setMsg(r.error ?? 'Could not load the ranch.'); }), [id]);
  useEffect(() => { reload(); const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);
  const act = async (ev: string, data: Record<string, unknown>, ok: (r: Record<string, unknown>) => string) => {
    setBusy(true); const r = await request(ev, { id, ...data }) as Res; setBusy(false); if (r.ranch) setV(r.ranch);
    setMsg(r.ok && r.result ? ok(r.result) : r.error ?? 'That did not work.');
  };
  const now = Date.now(); const hand = v && v.handUntil > now; const room = v ? v.capacity - v.used : 0;
  const barnTotal = v ? ANIMALS.reduce((a, x) => a + (v.barn[x.id] ?? 0), 0) : 0;
  return (
    <div className="world-west" {...backdropDismiss(onClose)} data-testid="ranch-panel" style={{ ['--c' as string]: '#d8b070' }}>
      <MapSheet className="west-sheet"><h3>🐄 {v?.label ?? 'Ranch'}</h3>
        {v && !v.owner && <p>This ranch belongs to someone else, or is for sale. {onDeed && <button type="button" className="west-go" onClick={onDeed}>See the deed</button>}</p>}
        {v?.owner && <>
          <p className="west-small">Pasture: {fmt(v.used)} / {fmt(v.capacity)} room used · barn holds {hand ? HAND_BARN_HOURS : BARN_HOURS}h of production{hand ? ' (ranch hand on duty)' : ''}.</p>
          <div className="west-bar"><i style={{ width: `${Math.min(100, Math.round((v.used / Math.max(1, v.capacity)) * 100))}%` }} /></div>
          <ul className="west-list ranch-list">{ANIMALS.map((a) => { const x = v.animals.find((y) => y.id === a.id)!; const have = v.herd[a.id] ?? 0; const canBuy = Math.min(50, Math.floor(room / a.units));
            return <li key={a.id} data-testid={`ranch-${a.id}`}>
              <span><b>{a.emoji} {a.label} × {fmt(have)}</b><small> · {a.units} room · 🪙 {fmt(x.price)} · {a.product.emoji} {a.product.label} every {a.everyMs >= 3_600_000 ? `${a.everyMs / 3_600_000}h` : `${a.everyMs / 60_000}m`} (≈🪙 {fmt(Math.round(animalDay(a)))}/day)</small></span>
              <b>{a.product.emoji} {fmt(v.barn[a.id] ?? 0)}<small> / {fmt(v.cap[a.id] ?? 0)}</small></b>
              <span className="ranch-buy">
                <input type="number" min={1} max={50} value={n[a.id]} onChange={(e) => setN({ ...n, [a.id]: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} aria-label={`${a.label} count`} />
                <button type="button" disabled={busy || !v.here || canBuy < n[a.id]} onClick={() => void act('ranch_buy', { animal: a.id, n: n[a.id] }, (r) => `Bought ${n[a.id]} ${a.label.toLowerCase()}${n[a.id] === 1 ? '' : 's'} for 🪙 ${fmt(Number(r.paid))}.`)} data-testid={`ranch-buy-${a.id}`}>Buy</button>
                <button type="button" disabled={busy || !v.here || have < n[a.id]} onClick={() => void act('ranch_sell', { animal: a.id, n: n[a.id] }, (r) => `Sold ${n[a.id]} for 🪙 ${fmt(Number(r.paid))}.`)}>Sell</button>
              </span>
            </li>; })}</ul>
          <button type="button" className="west-go" disabled={busy || !v.here || barnTotal <= 0} onClick={() => void act('ranch_collect', {}, (r) => { const got = r.got as Array<{ id: string; qty: number }>; const wool = Number(r.woolPay); return `Collected ${got.map((g) => `${fmt(g.qty)} ${g.id}`).join(', ')}${wool ? ` · wool sold for 🪙 ${fmt(wool)}` : ''}. Milk, eggs and bacon are in your pantry.`; })} data-testid="ranch-collect">📦 Collect the barn ({fmt(barnTotal)})</button>
          <div className="west-row">🤠 Ranch hand: {hand ? `on duty ${Math.ceil((v.handUntil - now) / 3_600_000)}h more` : 'not hired'} · 🪙 {fmt(v.handWage)}/day
            <input type="number" min={1} max={HAND_MAX_DAYS} value={days} onChange={(e) => setDays(Math.max(1, Math.min(HAND_MAX_DAYS, Number(e.target.value) || 1)))} aria-label="Days" style={{ width: 48 }} />
            <button type="button" disabled={busy || !v.here || v.used === 0} onClick={() => void act('ranch_hire', { days }, (r) => `Ranch hand hired for ${days} day${days === 1 ? '' : 's'}: 🪙 ${fmt(Number(r.paid))}.`)} data-testid="ranch-hire">Hire</button></div>
          <p className="west-small">A hand keeps the animals tended so the barn fills for {HAND_BARN_HOURS}h instead of {BARN_HOURS}h. Milk, eggs and bacon go to your Chud City Warehouse pantry (cook with them or sell them on the Market); wool is bought on collection. Selling an animal returns half its price. Selling the ranch's deed leaves its animals behind.</p>
          {!v.here && <p className="west-away"><small>You are away from Chud City. Travel back to tend the ranch.</small></p>}
        </>}
        {msg && <p className="west-msg" role="status">{msg}</p>}
        <button type="button" className="world-casino-x" onClick={onClose}>Back to the city</button>
      </MapSheet>
    </div>
  );
}
