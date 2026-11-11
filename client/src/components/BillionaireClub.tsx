import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { usePanelDrag } from '@/lib/panelDrag';
import { OPEN_PRESTIGE } from './PrestigeDesk';
import { ART_PIECES } from '../../../shared/artAuction';
import { PATRON_SLOTS } from '../../../shared/patronage';
import { SKY_PENTHOUSES } from '../../../shared/skyPenthouses';
import { flyTo, useTrip } from '@/lib/travel';

export const OPEN_CLUB = 'open-billionaire-club';
const fmt = (n: number) => n.toLocaleString('en-US');
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

type Tab = 'desk' | 'auction' | 'tower' | 'tables';
type PatronView = { id: string; name: string; icon: string; patron: { name: string; endsAt: number } | null };
type LotView = { id: string; item: (typeof ART_PIECES)[number]; estimate: number; floor: number; endsAt: number; high: { name: string; amount: number; mine: boolean } | null };

export function BillionaireClub({ onClose, onDeed }: { onClose: () => void; onDeed?: (id: string) => void }) {
  useDoing('cityhall');
  const drag = usePanelDrag('club');
  const trip = useTrip();
  const [tab, setTab] = useState<Tab>('desk');
  const [chips, setChips] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [slots, setSlots] = useState<PatronView[]>([]);
  const [lot, setLot] = useState<LotView | null>(null);
  const [bid, setBid] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadPatron = () => void request('patronage_view').then((a) => {
    const r = a as { ok: boolean; signedIn?: boolean; chips?: number | null; slots?: PatronView[] };
    if (!r.ok) return; setSignedIn(!!r.signedIn); if (r.chips != null) setChips(r.chips); setSlots(r.slots ?? []);
  });
  const loadAuction = () => void request('auction_view').then((a) => {
    const r = a as { ok: boolean; signedIn?: boolean; chips?: number | null; lot?: LotView | null };
    if (!r.ok) return; setSignedIn(!!r.signedIn); if (r.chips != null) setChips(r.chips); setLot(r.lot ?? null); if (r.lot) setBid(String(r.lot.floor));
  });
  useEffect(() => { loadPatron(); loadAuction(); }, []);

  const act = async (ev: string, data: unknown, ok: (a: Record<string, unknown>) => string) => {
    setBusy(true); const a = await request(ev, data); setBusy(false);
    setMsg(a.ok ? ok(a as unknown as Record<string, unknown>) : a.error ?? 'Something went wrong.');
    loadPatron(); loadAuction();
  };
  const sail = async () => {
    setBusy(true); const r = await flyTo('island'); setBusy(false);
    if (r.ok) onClose(); else setMsg(r.error ?? 'Could not reach the island.');
  };

  return (
    <MapSheet className="world-deed world-venue cityhall-panel" data-testid="venue-club" data-drag-panel="club" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>
      {drag.handle}
      <header><h3>💎 Billionaire's Club</h3>{chips != null && <span className="dealer-chips">{fmt(chips)} chips</span>}<button type="button" onClick={onClose} aria-label="Close">✕</button></header>
      <div className="cityhall-front"><span>THE CLUB</span><small>Prestige Desk · patronage plaques · art auction · Sky Tower</small></div>
      <nav className="prestige-tabs">
        <button type="button" className={tab === 'desk' ? 'on' : ''} onClick={() => setTab('desk')}>Desk & plaques</button>
        <button type="button" className={tab === 'auction' ? 'on' : ''} onClick={() => setTab('auction')} data-testid="club-tab-auction">Art auction</button>
        <button type="button" className={tab === 'tower' ? 'on' : ''} onClick={() => setTab('tower')} data-testid="club-tab-tower">Sky Tower</button>
      </nav>
      {tab === 'desk' && (
        <div data-testid="club-desk">
          <p>The Prestige Desk lives here: titles, fireworks, liveries, shout-outs, and city patronage naming rights.</p>
          <button type="button" data-testid="open-prestige-desk" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PRESTIGE, { detail: 'vanity' }))}>✨ Open the Prestige Desk</button>
          <h4>Patron plaques</h4>
          <ul data-testid="club-plaques">
            {(slots.length ? slots : PATRON_SLOTS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, patron: null }))).map((s) => (
              <li key={s.id} data-testid={`club-plaque-${s.id}`}>{s.icon} {s.name}: {s.patron ? `${s.patron.name} until ${when(s.patron.endsAt)}` : 'unclaimed'}</li>
            ))}
          </ul>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PRESTIGE, { detail: 'patronage' }))}>Sponsor a plaque</button>
          <hr />
          <p>The Private Island is reached by Sovereign Megayacht, or by your own jet.</p>
          <button type="button" disabled={busy || !signedIn} onClick={() => void sail()} data-testid="club-sail-island">{trip.jet ? `🛩 Fly your ${trip.jet} to the Private Island` : '⚓ Sail to the Private Island'}</button>
        </div>
      )}
      {tab === 'auction' && (
        <div data-testid="club-auction">
          {lot ? (
            <>
              <h4>{lot.item.icon} {lot.item.name}</h4>
              <p>{lot.item.blurb}</p>
              <p>Estimate 🪙 {fmt(lot.estimate)} · {lot.high ? <>High bid 🪙 {fmt(lot.high.amount)} by {lot.high.name}{lot.high.mine ? ' (you)' : ''}</> : 'No bids yet'} · ends {when(lot.endsAt)}</p>
              <label>Your bid <input type="number" min={lot.floor} value={bid} onChange={(e) => setBid(e.target.value)} data-testid="auction-bid-amount" /></label>
              <button type="button" disabled={busy || !signedIn} data-testid="auction-bid" onClick={() => void act('auction_bid', { lotId: lot.id, amount: Number(bid) }, (r) => `Bid 🪙 ${fmt(Number(r.amount))} placed.`)}>{signedIn ? `Bid 🪙 ${fmt(Number(bid) || lot.floor)}` : 'Sign in to bid'}</button>
              <small>Winning bids are a chip sink. The piece is yours to place in a home and cannot be resold. A bid in the last 30 seconds extends the clock.</small>
            </>
          ) : <p>No lot is open right now.</p>}
        </div>
      )}
      {tab === 'tower' && (
        <div data-testid="club-tower">
          <p>Six sky penthouses in the civic tower next door, on the same beach. Ordinary home tax and interiors apply.</p>
          <ul>
            {SKY_PENTHOUSES.map((u) => (
              <li key={u.id}><button type="button" data-testid={`sky-unit-${u.id}`} onClick={() => onDeed?.(u.id)}>{u.label} · 🪙 {fmt(u.price)}</button></li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'tables' && (
        <div data-testid="club-tables">
          <p>The Club keeps high-limit rooms of the same games you already know. House rules are unchanged; only the min and max bets go up. Open a table from here, or pick the same stakes from the usual casino tabs.</p>
          <ul>
            <li><button type="button" data-testid="club-open-bj-high" onClick={() => window.dispatchEvent(new CustomEvent('open-high-stakes-blackjack', { detail: 'high' }))}>🂡 High Stakes Blackjack (1,000–100,000)</button></li>
            <li><button type="button" data-testid="club-open-bj-whale" onClick={() => window.dispatchEvent(new CustomEvent('open-high-stakes-blackjack', { detail: 'whale' }))}>🂡 Whale Blackjack (10,000–1,000,000)</button></li>
            <li><button type="button" data-testid="club-open-rl-high" onClick={() => window.dispatchEvent(new CustomEvent('open-high-stakes-roulette', { detail: 'high' }))}>🎡 High Limit Roulette (up to 1,000,000 / spin)</button></li>
            <li><button type="button" data-testid="club-open-he-500k" onClick={() => window.dispatchEvent(new CustomEvent('open-high-stakes-holdem', { detail: '500k' }))}>♠ Billionaire Hold&apos;em 500K</button></li>
            <li><button type="button" data-testid="club-open-he-1m" onClick={() => window.dispatchEvent(new CustomEvent('open-high-stakes-holdem', { detail: '1m' }))}>♠ Billionaire Hold&apos;em 1M</button></li>
            <li><button type="button" data-testid="club-open-vp-high" onClick={() => window.dispatchEvent(new CustomEvent('open-high-stakes-poker', { detail: 'high' }))}>🃏 High Stakes Jacks or Better (100–50,000)</button></li>
          </ul>
        </div>
      )}
      {msg && <small role="status" data-testid="club-msg">{msg}</small>}

    </MapSheet>
  );
}

export function BillionaireClubHost({ onDeed }: { onDeed?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(OPEN_CLUB, h); return () => window.removeEventListener(OPEN_CLUB, h);
  }, []);
  if (!open) return null;
  return <BillionaireClub onClose={() => setOpen(false)} onDeed={onDeed} />;
}
