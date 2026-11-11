// Jet passenger seats (shared/jetSeats.ts): owners open boarding, nearby/online players request a seat, the owner
// accepts or declines, and everyone on board arrives together when the owner takes off (the server moves them).
import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { arriveByJet, refreshTrip, useTrip } from '@/lib/travel';
import type { BoardingView } from '../../../shared/jetSeats';
import { DESTINATIONS, type Location } from '../../../shared/resort';

const fmt = (n: number) => n.toLocaleString('en-US');
const placeName = (l: Location) => (l === 'city' ? 'Chud City' : l === 'voyage' ? 'at sea' : DESTINATIONS[l].name);
const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function JetSeatsDock() {
  const trip = useTrip();
  const [list, setList] = useState<BoardingView[]>([]); const [me, setMe] = useState<string | null>(null); const [cap, setCap] = useState(2000);
  const [open, setOpen] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState<Location>('resort'); const [price, setPrice] = useState(0);
  const load = () => { void request('jet_board_list').then((r) => { const a = r as unknown as { ok: boolean; boardings?: BoardingView[]; me?: string | null; cap?: number }; if (a.ok) { setList(a.boardings ?? []); setMe(a.me ?? null); if (a.cap) setCap(a.cap); } }); };
  useEffect(() => {
    load(); const t = window.setInterval(load, 10_000);
    const onList = () => load();
    const onEv = (e: { event: string; boarding: BoardingView | null }) => {
      load(); const b = e.boarding; if (!b) return;
      if (e.event === 'departed') { void refreshTrip(); if (lc(b.owner) !== lc(me)) { arriveByJet(b.to, b.jet); setMsg(b.seated.some((n) => lc(n) === lc(me)) ? `✈️ You flew with ${b.owner} to ${placeName(b.to)}.` : `${b.owner}'s jet left without you.`); } }
      else if (e.event === 'accepted') setMsg(`💺 ${b.owner} gave you a seat to ${placeName(b.to)}${b.price ? ` (🪙 ${fmt(b.price)})` : ''}. Stay at the airport until take-off.`);
      else if (e.event === 'declined' || e.event === 'full') setMsg(`${b.owner} could not take you this time.`);
      else if (e.event === 'request_expired') setMsg(`Your seat request on ${b.owner}'s jet timed out.`);
      else if (e.event === 'cancelled' || e.event === 'expired') setMsg(`${b.owner}'s boarding closed. Any fare was refunded.`);
      else if (e.event === 'request') setOpen(true);
    };
    socket.on('jet_boardings', onList); socket.on('jet_seat_event', onEv);
    return () => { window.clearInterval(t); socket.off('jet_boardings', onList); socket.off('jet_seat_event', onEv); };
  }, [me, trip.loc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDest(trip.loc === 'city' ? 'resort' : 'city'); }, [trip.loc]);

  const mine = list.find((b) => lc(b.owner) === lc(me));
  const others = list.filter((b) => lc(b.owner) !== lc(me) && b.from === trip.loc);
  if (!me || (!trip.jet && !others.length && !msg)) return null;
  const act = async (ev: string, data?: unknown, ok?: (a: Record<string, unknown>) => string | null) => {
    setBusy(true); setMsg(null); const r = await request(ev, data) as { ok: boolean; error?: string } & Record<string, unknown>; setBusy(false);
    if (!r.ok) setMsg(r.error ?? 'Something went wrong.'); else { const m = ok?.(r); if (m) setMsg(m); } load(); return r;
  };
  const depart = async () => { const r = await act('jet_board_depart', undefined, (a) => { const p = (a.passengers as string[]) ?? []; return `🛫 Wheels up to ${placeName(a.to as Location)}${p.length ? ` with ${p.join(', ')}` : ''}.`; }); if (r.ok) arriveByJet(r.to as Location, String(r.jet)); };
  const dests: Location[] = trip.loc === 'city' ? ['resort', 'fortmc'] : ['city'];
  const seatOf = (b: BoardingView) => (b.seated.some((n) => lc(n) === lc(me)) ? 'seated' : b.pending.some((p) => lc(p.name) === lc(me)) ? 'pending' : null);

  return (
    <div className="jet-seats-dock" data-testid="jet-seats-dock">
      {others.map((b) => { const st = seatOf(b); const left = b.seats - b.seated.length; return (
        <div key={b.id} className="jet-seat-offer" data-testid={`seat-offer-${b.owner}`}>
          <b>🛩 {b.owner}'s {b.jet}</b> <small>to {placeName(b.to)} · 💺 {left}/{b.seats} free · {b.price ? <>fare 🪙 {fmt(b.price)}</> : 'free ride'}</small>
          {st === 'seated' ? <><em>You have a seat. Wait for take-off.</em><button type="button" disabled={busy} onClick={() => void act('jet_seat_leave')}>Give up seat</button></>
            : st === 'pending' ? <><em>Request sent, waiting for {b.owner}…</em><button type="button" disabled={busy} onClick={() => void act('jet_seat_leave')}>Withdraw</button></>
            : <button type="button" disabled={busy || left <= 0} onClick={() => void act('jet_seat_request', { id: b.id }, () => `Asked ${b.owner} for a seat.`)} data-testid={`seat-request-${b.owner}`}>Request a seat on {b.owner}'s jet</button>}
        </div>); })}
      {trip.jet && (open || mine ? (
        <div className="jet-seat-owner" data-testid="jet-boarding-owner">
          <header><b>💺 Boarding · {trip.jet}</b><button type="button" onClick={() => setOpen(false)} aria-label="Hide">–</button></header>
          {mine ? <>
            <small>To {placeName(mine.to)} · {mine.seated.length}/{mine.seats} seats taken · {mine.price ? `fare 🪙 ${fmt(mine.price)}` : 'free'}</small>
            {mine.pending.map((p) => <div key={p.name} className="jet-seat-req" data-testid={`seat-req-${p.name}`}><span>{p.name} asks for a seat</span>
              <button type="button" disabled={busy || mine.seated.length >= mine.seats} onClick={() => void act('jet_seat_respond', { name: p.name, accept: true })} data-testid={`seat-accept-${p.name}`}>Accept</button>
              <button type="button" disabled={busy} onClick={() => void act('jet_seat_respond', { name: p.name, accept: false })}>Decline</button></div>)}
            {mine.seated.length > 0 && <small data-testid="seat-manifest">On board: {mine.seated.join(', ')}</small>}
            <div className="jet-seat-actions"><button type="button" className="venue-resort" disabled={busy} onClick={() => void depart()} data-testid="seat-depart">🛫 Take off to {placeName(mine.to)}</button>
              <button type="button" disabled={busy} onClick={() => void act('jet_board_cancel', undefined, () => 'Boarding closed. Fares refunded.')}>Cancel</button></div>
          </> : <>
            <small>Open boarding and nearby players can ask to fly with you. You accept or decline each one.</small>
            <label>To <select value={dest} onChange={(e) => setDest(e.target.value as Location)} data-testid="seat-dest">{dests.map((d) => <option key={d} value={d}>{placeName(d)}</option>)}</select></label>
            <label>Fare <input type="number" min={0} max={cap} step={50} value={price} onChange={(e) => setPrice(Math.max(0, Math.min(cap, Math.floor(Number(e.target.value) || 0))))} data-testid="seat-price" /> <small>0 = free · max 🪙 {fmt(cap)}</small></label>
            <button type="button" disabled={busy} onClick={() => void act('jet_board_open', { dest, price }, () => 'Boarding is open.')} data-testid="seat-open">Open boarding</button>
          </>}
        </div>
      ) : <button type="button" className="jet-seat-fab" onClick={() => setOpen(true)} data-testid="jet-boarding-fab">💺 Jet boarding</button>)}
      {msg && <small className="jet-seat-msg" data-testid="jet-seat-msg">{msg}<button type="button" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button></small>}
    </div>
  );
}
