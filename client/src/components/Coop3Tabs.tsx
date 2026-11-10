/** Co-op tabs for co-op3: supply contracts, fishing fleets and the rotating server event. */
import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { fishById, fmtKg, RARITY_COLOR } from '../../../shared/fishing';
import { FLEET_MAX_CUT, SC_INTERVALS_H, SC_MAX_DELIVERIES, SC_MIN_DELIVERIES, eventTiersFor, scBand, scBond, type EventView, type FleetTripView, type ScView } from '../../../shared/coop3';

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const left = (t: number) => { const s = Math.max(0, Math.floor((t - Date.now()) / 1000)); const d = Math.floor(s / 86400); return d ? `${d}d ${Math.floor((s % 86400) / 3600)}h` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
const nonce = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
type Ack = { ok: boolean; error?: string; [k: string]: unknown };
function useAct(onOk: (a: Ack) => void) {
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const act = async (ev: string, data: unknown, ok: (a: Ack) => string) => { setBusy(true); setMsg(null); const a = (await request(ev, data)) as Ack; setBusy(false); if (a.ok) { onOk(a); setMsg(ok(a)); } else setMsg(`⚠️ ${a.error ?? 'Something went wrong.'}`); };
  return { msg, busy, act, setMsg };
}
const Msg = ({ m }: { m: string | null }) => (m ? <p className="freight-msg" data-testid="coop3-msg">{m}</p> : null);

// ------------------------------------------------------------ supply contracts
type ScList = { contracts: ScView[]; trucks: Array<{ id: string; name: string; cap: number }>; stock: Array<{ type: string; id: string; qty: number; name: string; ref: number }>; me: string };
const STATUS: Record<string, string> = { pending: '⏳ Offer', active: '🚚 Active', done: '✅ Done', cancelled: '✖️ Cancelled', breached: '💥 Breached', declined: '🚫 Declined', expired: '⌛ Expired', withdrawn: '↩️ Withdrawn' };
export function SupplyTab({ me }: { me: string | null }) {
  const [v, setV] = useState<ScList | null>(null);
  const load = () => { if (me) void request('sc_list').then((a) => { if (a.ok) setV(a as unknown as ScList); }); };
  useEffect(() => { load(); socket.on('sc_changed', load); const r = window.setInterval(load, 30_000); return () => { socket.off('sc_changed', load); window.clearInterval(r); }; }, [me]);
  const { msg, busy, act } = useAct((a) => setV(a as unknown as ScList));
  const [buyer, setBuyer] = useState(''); const [item, setItem] = useState(''); const [qty, setQty] = useState(100); const [unit, setUnit] = useState(0); const [ih, setIh] = useState<number>(12); const [n, setN] = useState(4);
  const s = v?.stock.find((x) => `${x.type}:${x.id}` === item) ?? v?.stock[0];
  useEffect(() => { if (s && !unit) setUnit(s.ref); }, [s?.id]);
  if (!me) return <p>Sign in to make supply contracts.</p>;
  if (!v) return <p>Loading…</p>;
  const band = s ? scBand(s.ref) : null; const value = qty * unit * n;
  const live = v.contracts.filter((c) => c.status === 'pending' || c.status === 'active'); const old = v.contracts.filter((c) => !(c.status === 'pending' || c.status === 'active')).slice(0, 8);
  return <section data-testid="coop-supply">
    <h4>🚚 Active contracts</h4>
    {live.length ? <ul className="coop-sc-list" data-testid="sc-active">{live.map((c) => <li key={c.id} className={`sc-${c.status}`}>
      <b>{STATUS[c.status]}</b> {c.role === 'seller' ? `You → ${c.buyer}` : `${c.seller} → you`}: {fmt(c.qty)} {c.name} × {c.n} every {Math.round(c.intervalMs / 3_600_000)}h @ {fmt(c.unit)} 🪙
      <div className="sc-meta">{c.status === 'active' ? <>Delivered {c.delivered}/{c.n}{c.missed ? ` · missed ${c.missed}` : ''} · {c.transit ? `🚚 arriving in ${left(c.transit.arriveAt)}` : c.nextDue ? `next due in ${left(c.nextDue)}` : ''} · escrow {fmt(c.escrow)} · bond {fmt(c.bond)}</> : <>bond {fmt(c.bond)} · expires in {left(c.createdAt + 86_400_000)}</>}{c.cancelReq ? ` · ${c.cancelReq} asked to cancel` : ''}</div>
      <div className="sc-btns">
        {c.status === 'pending' && c.role === 'buyer' && <><button type="button" disabled={busy} data-testid={`sc-accept-${c.id}`} onClick={() => void act('sc_accept', { id: c.id }, () => `✅ Accepted. ${fmt(c.qty * c.unit * c.n)} 🪙 is in escrow.`)}>Accept (escrow {fmt(c.qty * c.unit * c.n)})</button><button type="button" disabled={busy} onClick={() => void act('sc_decline', { id: c.id }, () => 'Declined.')}>Decline</button></>}
        {c.status === 'pending' && c.role === 'seller' && <button type="button" disabled={busy} onClick={() => void act('sc_decline', { id: c.id }, () => 'Offer withdrawn; bond returned.')}>Withdraw</button>}
        {c.status === 'active' && c.role === 'seller' && !c.transit && <button type="button" disabled={busy} data-testid={`sc-dispatch-${c.id}`} onClick={() => void act('sc_dispatch', { id: c.id }, () => '🚚 Truck dispatched.')}>🚚 Dispatch delivery {c.k + 1}</button>}
        {c.status === 'active' && !c.transit && <><button type="button" disabled={busy} onClick={() => void act('sc_cancel', { id: c.id, mutual: true }, (a) => ((a.result as { status?: string })?.status === 'cancelled' ? 'Cancelled by agreement; everything refunded.' : 'Asked the other side to cancel.'))}>🤝 {c.cancelReq && c.cancelReq !== c.role ? 'Agree to cancel' : 'Ask to cancel'}</button>
          <button type="button" disabled={busy} className="danger" onClick={() => { if (window.confirm(c.role === 'seller' ? 'Walking away is a breach: the buyer gets the escrow back plus your whole bond.' : 'Walking away costs a 10% fee on the remaining escrow, paid to the seller.')) void act('sc_cancel', { id: c.id, mutual: false }, () => 'Contract ended.'); }}>Walk away</button></>}
      </div></li>)}</ul> : <p>No active contracts.</p>}
    <h4>📝 Offer a contract</h4>
    {v.stock.length ? <div className="coop-donate sc-form" data-testid="sc-form">
      <label>Buyer <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="player name" data-testid="sc-buyer" /></label>
      <label>Goods <select value={s ? `${s.type}:${s.id}` : ''} onChange={(e) => { setItem(e.target.value); const x = v.stock.find((y) => `${y.type}:${y.id}` === e.target.value); if (x) setUnit(x.ref); }} data-testid="sc-item">{v.stock.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>{x.name} (have {fmt(x.qty)})</option>)}</select></label>
      <label>Per delivery <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} data-testid="sc-qty" /></label>
      <label>Unit price <input type="number" min={1} value={unit} onChange={(e) => setUnit(Math.max(1, Math.floor(Number(e.target.value) || 1)))} data-testid="sc-unit" /></label>
      <label>Every <select value={ih} onChange={(e) => setIh(Number(e.target.value))}>{SC_INTERVALS_H.map((h) => <option key={h} value={h}>{h}h</option>)}</select></label>
      <label>Deliveries <input type="number" min={SC_MIN_DELIVERIES} max={SC_MAX_DELIVERIES} value={n} onChange={(e) => setN(Math.min(SC_MAX_DELIVERIES, Math.max(SC_MIN_DELIVERIES, Math.floor(Number(e.target.value) || 2))))} /></label>
      <small>{band && <>House price {fmt(s!.ref)}; allowed {fmt(band.lo)}–{fmt(band.hi)}. </>}Total {fmt(value)} 🪙 · your bond {fmt(scBond(unit, qty, n))} 🪙 (back when the last delivery lands)</small>
      <button type="button" disabled={busy || !buyer.trim() || !s} data-testid="sc-propose" onClick={() => void act('sc_propose', { buyer: buyer.trim(), type: s!.type, id: s!.id, qty, unit, intervalH: ih, n, nonce: nonce() }, () => `📨 Offer sent to ${buyer.trim()}. Bond posted.`)}>Send offer</button>
    </div> : <p>Put goods in your Warehouse to sell them on contract.</p>}
    <p><small>Your trucks: {v.trucks.length ? v.trucks.map((t) => `${t.name} (${fmt(t.cap)})`).join(', ') : 'none (buy one at the dealer)'}. Accounts 3+ days old with 2+ hours played; no QA, bot, jailed or linked accounts.</small></p>
    {old.length > 0 && <><h4>📜 Past</h4><ul className="coop-sc-list old">{old.map((c) => <li key={c.id}>{STATUS[c.status]} {c.role === 'seller' ? `→ ${c.buyer}` : `← ${c.seller}`}: {fmt(c.qty)} {c.name} × {c.n} ({c.delivered} delivered)</li>)}</ul></>}
    <Msg m={msg} />
  </section>;
}

// ------------------------------------------------------------ fishing fleets
type FleetList = { trips: FleetTripView[]; mine: FleetTripView | null; me: string | null };
export function FleetTab({ me }: { me: string | null }) {
  const [v, setV] = useState<FleetList | null>(null); const [cut, setCut] = useState(10);
  const load = () => { void request('fleet_list').then((a) => { if (a.ok) setV(a as unknown as FleetList); }); };
  useEffect(() => { load(); socket.on('fleet_trips', load); socket.on('fleet_event', load); const r = window.setInterval(load, 15_000); return () => { socket.off('fleet_trips', load); socket.off('fleet_event', load); window.clearInterval(r); }; }, []);
  const { msg, busy, act } = useAct((a) => setV(a as unknown as FleetList));
  if (!v) return <p>Loading…</p>;
  const m = v.mine;
  return <section data-testid="coop-fleet">
    {m ? <div className="fleet-mine" data-testid="fleet-mine">
      <h4>🛥️ {m.mine === 'captain' ? 'Your trip' : `${m.captain}’s trip`}: {m.boatName}</h4>
      <p>{m.crew.length}/{m.seats} crew · captain’s cut {Math.round(m.cut * 100)}% · zone {m.zone} · ends in {left(m.endsAt)}</p>
      <p>Crew: {m.crew.length ? m.crew.join(', ') : 'nobody yet'}</p>
      {m.log.length > 0 && <ul className="coop-board fleet-log" data-testid="fleet-log">{m.log.slice().reverse().map((e, i) => { const f = e.fish ? fishById(e.fish) : null;
        return <li key={`${e.at}-${i}`}>{e.kind === 'catch' ? <span>🎣 {e.name} landed <b style={{ color: f ? RARITY_COLOR[f.rarity] : undefined }}>{f ? `${f.emoji} ${f.label}` : e.fish}</b>{e.grams ? ` · ${fmtKg(e.grams)}` : ''}</span>
          : <span>💰 {e.name} sold the catch · captain’s cut <b>🪙 {fmt(e.chips ?? 0)}</b> to {m.captain}</span>}</li>; })}</ul>}
      {m.mine === 'requested' && <p>⏳ Waiting for {m.captain} to answer…</p>}
      {m.mine === 'crew' && <p>🎣 Cast at the deep sea. You fish from {m.captain}’s boat; crewed boats can hook 🐟 bigeye tuna, 🌕 opah and 🐋 blue marlin.</p>}
      {m.mine === 'captain' && m.requests.map((r) => <div key={r} className="coop-claim">🙋 {r} wants to join
        <button type="button" disabled={busy} data-testid={`fleet-accept-${r}`} onClick={() => void act('fleet_respond', { name: r, accept: true }, () => `${r} is aboard.`)}>Accept</button>
        <button type="button" disabled={busy} onClick={() => void act('fleet_respond', { name: r, accept: false }, () => 'Declined.')}>Decline</button></div>)}
      <button type="button" disabled={busy} data-testid="fleet-leave" onClick={() => void act('fleet_leave', {}, () => (m.mine === 'captain' ? 'Trip ended.' : 'You left the boat.'))}>{m.mine === 'captain' ? '⚓ End trip' : 'Leave boat'}</button>
    </div> : me && <div className="coop-donate" data-testid="fleet-open">
      <span>Own a sportfisher (1 seat), yacht (3) or superyacht (6)? Open a 30-minute trip at the Resort Marina.</span>
      <label>Captain’s cut <input type="range" min={0} max={FLEET_MAX_CUT * 100} value={cut} onChange={(e) => setCut(Number(e.target.value))} data-testid="fleet-cut" /> {cut}%</label>
      <button type="button" disabled={busy} data-testid="fleet-open-btn" onClick={() => void act('fleet_open', { cut: cut / 100 }, () => '🛥️ Trip open. Players at the Resort can ask to join.')}>Open a fleet trip</button>
    </div>}
    <h4>⚓ Boats taking crew</h4>
    <ul className="coop-board" data-testid="fleet-trips">{v.trips.filter((t) => t.id !== m?.id).length ? v.trips.filter((t) => t.id !== m?.id).map((t) => <li key={t.id}><span>{t.captain}’s {t.boatName} · {t.crew.length}/{t.seats} · cut {Math.round(t.cut * 100)}% · {left(t.endsAt)}</span>
      {me && !m && <button type="button" disabled={busy || t.crew.length >= t.seats} data-testid={`fleet-join-${t.id}`} onClick={() => void act('fleet_request', { id: t.id }, () => `🙋 Asked ${t.captain} to join.`)}>{t.crew.length >= t.seats ? 'Full' : 'Ask to join'}</button>}</li>) : <li>No boats are taking crew right now.</li>}</ul>
    <small>The cut comes out of what crew sell from the trip. Daily ocean caps still apply to everyone. No QA, bot, jailed or linked accounts.</small>
    <Msg m={msg} />
  </section>;
}

// ------------------------------------------------------------ server event
export function EventTab({ me }: { me: string | null }) {
  const [v, setV] = useState<EventView | null>(null);
  const load = () => { void request('wev_view').then((a) => { if (a.ok) setV((a as unknown as { event: EventView }).event); }); };
  useEffect(() => { load(); socket.on('wev_changed', load); const r = window.setInterval(load, 30_000); return () => { socket.off('wev_changed', load); window.clearInterval(r); }; }, []);
  const { msg, busy, act } = useAct((a) => setV((a as unknown as { event: EventView }).event));
  if (!v) return <p>Loading…</p>;
  return <section data-testid="coop-event">
    <h4>{v.icon} {v.name} <small>ends in {left(v.endsAt)}</small></h4>
    <p>{v.blurb}</p>
    <div className="coop-bar" data-testid="wev-progress" style={{ ['--bar' as string]: v.color }}><div style={{ width: `${v.pct * 100}%`, background: v.color }} /><span>{fmt(v.progress)} / {fmt(v.goal)} {v.unit}</span></div>
    {v.me && <p data-testid="wev-me">{v.me.excluded ? `🚫 ${v.me.excluded}` : <>You: <b>{fmt(v.me.amount)}</b> / {fmt(v.playerCap)} (your cap){v.me.tier ? ` · ${eventTiersFor(v.week).find((t) => t.id === v.me!.tier)?.icon} ${v.me.tier}` : ''}</>}</p>}
    <ul className="wev-tiers">{eventTiersFor(v.week).map((t) => <li key={t.id}>{t.icon} {t.name}: {fmt(Math.ceil(t.at * v.playerCap))} {v.unit} → {fmt(t.chips)} 🪙</li>)}</ul>
    <small>Full rewards if the server reaches the goal, half from 50%, none below. Claim after this event ends.</small>
    {v.past && <div className="coop-claim" data-testid="wev-claim">{v.past.icon} {v.past.name}: you gave {fmt(v.past.amount)} · server {Math.round(v.past.pct * 100)}% · reward {fmt(v.past.reward)} 🪙
      {me && <button type="button" disabled={busy || v.past.claimed || !v.past.reward} onClick={() => void act('wev_claim', {}, (a) => `🎉 +${fmt(Number(a.amount))} chips.`)}>{v.past.claimed ? 'Claimed' : 'Claim'}</button>}</div>}
    <h4>🏆 Top contributors</h4>
    <ol className="coop-board" data-testid="wev-top">{v.top.length ? v.top.map((d, i) => <li key={d.name}><span>{i + 1}. {d.name}</span><b>{fmt(d.amount)}</b></li>) : <li>Nobody yet. Be the first!</li>}</ol>
    <p className="coop-next">Next: {v.next.icon} {v.next.name}</p>
    <Msg m={msg} />
  </section>;
}
