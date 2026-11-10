import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { usePanelDrag } from '@/lib/panelDrag';
import { VANITY_FIREWORKS, VANITY_LIVERIES, VANITY_TITLES, SHOUT_MAX } from '../../../shared/vanity';
import { PATRON_SLOTS } from '../../../shared/patronage';
import { fleetModel } from '../../../shared/fleet';

export const OPEN_PRESTIGE = 'open-prestige-desk';
const fmt = (n: number) => n.toLocaleString('en-US');
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

type Tab = 'vanity' | 'patronage';
type Craft = { id: string; kind: string; model: string };
type TitleRow = { id: string; equipped?: boolean };
type LiveryRow = { id: string; liveryId: string; craftId: string | null };
type PatronView = { id: string; name: string; icon: string; blurb: string; price: number; termDays: number; patron: { name: string; endsAt: number; mine: boolean } | null; canBuy: boolean };

export function PrestigeDesk({ onClose, initialTab = 'vanity' }: { onClose: () => void; initialTab?: Tab }) {
  useDoing('cityhall');
  const drag = usePanelDrag('prestige');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [chips, setChips] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [equipped, setEquipped] = useState<string | null>(null);
  const [liveries, setLiveries] = useState<LiveryRow[]>([]);
  const [crafts, setCrafts] = useState<Craft[]>([]);
  const [shoutAt, setShoutAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [shout, setShout] = useState('');
  const [applyFor, setApplyFor] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [slots, setSlots] = useState<PatronView[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadVanity = () => void request('vanity_view').then((a) => {
    const r = a as { ok: boolean; signedIn?: boolean; chips?: number | null; titles?: TitleRow[]; equipped?: string | null; liveries?: LiveryRow[]; crafts?: Craft[]; shoutAt?: number; now?: number; catalog?: { titles: Array<{ id: string; price: number }>; fireworks: Array<{ id: string; price: number }>; liveries: Array<{ id: string; price: number }>; shout: { price: number } } };
    if (!r.ok) return;
    setSignedIn(!!r.signedIn); setChips(r.chips ?? null); setTitles(r.titles ?? []); setEquipped(r.equipped ?? null);
    setLiveries(r.liveries ?? []); setCrafts(r.crafts ?? []); setShoutAt(r.shoutAt ?? 0); setNow(r.now ?? Date.now());
    const p: Record<string, number> = {};
    for (const t of r.catalog?.titles ?? []) p[`title:${t.id}`] = t.price;
    for (const t of r.catalog?.fireworks ?? []) p[`fw:${t.id}`] = t.price;
    for (const t of r.catalog?.liveries ?? []) p[`liv:${t.id}`] = t.price;
    if (r.catalog?.shout) p.shout = r.catalog.shout.price;
    setPrices((c) => ({ ...c, ...p }));
  });
  const loadPatron = () => void request('patronage_view').then((a) => {
    const r = a as { ok: boolean; signedIn?: boolean; chips?: number | null; slots?: PatronView[] };
    if (!r.ok) return;
    setSignedIn(!!r.signedIn); if (r.chips != null) setChips(r.chips); setSlots(r.slots ?? []);
  });
  useEffect(() => { loadVanity(); loadPatron(); }, []);

  const act = async (ev: string, data: object, ok: (r: Record<string, unknown>) => string) => {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await request(ev, data) as { ok: boolean; error?: string; [k: string]: unknown };
    setBusy(false); setMsg(r.ok ? ok(r) : r.error ?? 'Something went wrong.');
    loadVanity(); loadPatron();
  };

  const ownTitle = (id: string) => titles.some((t) => t.id === id);

  return (
    <MapSheet className="world-deed world-venue cityhall-panel prestige-desk" data-testid="prestige-desk" data-drag-panel="prestige" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="cityhall-front"><span>✨ PRESTIGE DESK</span><small>Vanity buys and city patronage · chips leave the economy</small></div>
      {chips != null && <small className="prestige-chips">🪙 {fmt(chips)} chips</small>}
      <div className="prestige-tabs">
        <button type="button" className={tab === 'vanity' ? 'on' : ''} onClick={() => setTab('vanity')} data-testid="prestige-tab-vanity">Vanity Desk</button>
        <button type="button" className={tab === 'patronage' ? 'on' : ''} onClick={() => setTab('patronage')} data-testid="prestige-tab-patronage">City Patronage</button>
      </div>

      {tab === 'vanity' && (
        <div className="prestige-body" data-testid="vanity-desk">
          <h4>Titles</h4>
          <small>Buy once, wear one in city chat. Equip or remove for free.</small>
          <ul className="prestige-list">
            {VANITY_TITLES.map((t) => {
              const have = ownTitle(t.id); const on = equipped === t.id;
              return <li key={t.id}>
                <div><b>{t.icon} {t.name}</b><small>{t.blurb}</small></div>
                {have
                  ? <button type="button" disabled={busy || !signedIn} onClick={() => act('vanity_equip_title', { id: on ? null : t.id }, () => on ? 'Title removed.' : `You're wearing ${t.name}.`)}>{on ? 'Remove' : 'Wear'}</button>
                  : <button type="button" disabled={busy || !signedIn} onClick={() => act('vanity_buy_title', { id: t.id }, (r) => `Bought ${t.name} for 🪙 ${fmt(Number(r.price))}.`)}>{signedIn ? `Buy 🪙 ${fmt(prices[`title:${t.id}`] ?? t.price)}` : 'Sign in'}</button>}
              </li>;
            })}
          </ul>

          <h4>Fireworks</h4>
          <small>A one-time show over the city. Everyone can see it; nothing is posted to public chat.</small>
          <ul className="prestige-list">
            {VANITY_FIREWORKS.map((t) => (
              <li key={t.id}>
                <div><b>{t.icon} {t.name}</b><small>{t.blurb}</small></div>
                <button type="button" disabled={busy || !signedIn} onClick={() => act('vanity_fireworks', { id: t.id }, (r) => `${t.name} launched for 🪙 ${fmt(Number(r.price))}.`)}>{signedIn ? `Launch 🪙 ${fmt(prices[`fw:${t.id}`] ?? t.price)}` : 'Sign in'}</button>
              </li>
            ))}
          </ul>

          <h4>Liveries</h4>
          <small>40,000 chips each, then apply to a yacht or jet you own. No resale.</small>
          <ul className="prestige-list">
            {VANITY_LIVERIES.map((t) => (
              <li key={t.id}>
                <div><b>{t.icon} {t.name}</b><small>{t.blurb}</small></div>
                <button type="button" disabled={busy || !signedIn} onClick={() => act('vanity_buy_livery', { id: t.id }, (r) => `Bought ${t.name} for 🪙 ${fmt(Number(r.price))}.`)}>{signedIn ? `Buy 🪙 ${fmt(prices[`liv:${t.id}`] ?? t.price)}` : 'Sign in'}</button>
              </li>
            ))}
          </ul>
          {!!liveries.length && <ul className="prestige-list prestige-owned">
            {liveries.map((row) => {
              const spec = VANITY_LIVERIES.find((x) => x.id === row.liveryId);
              const craft = crafts.find((c) => c.id === row.craftId);
              return <li key={row.id}>
                <div><b>{spec?.name ?? row.liveryId}</b><small>{craft ? `On ${fleetModel(craft.model)?.name ?? craft.model}` : 'In your locker'}</small></div>
                <label>
                  <select value={applyFor[row.id] ?? row.craftId ?? ''} onChange={(e) => setApplyFor((s) => ({ ...s, [row.id]: e.target.value }))} data-testid={`livery-apply-${row.id}`}>
                    <option value="">Locker</option>
                    {crafts.map((c) => <option key={c.id} value={c.id}>{fleetModel(c.model)?.name ?? c.model}</option>)}
                  </select>
                  <button type="button" disabled={busy} onClick={() => act('vanity_apply_livery', { id: row.id, craftId: applyFor[row.id] ?? row.craftId ?? null }, () => 'Livery updated.')}>Apply</button>
                </label>
              </li>;
            })}
          </ul>}

          <h4>City shout-out</h4>
          <small>🪙 {fmt(prices.shout ?? 15_000)} · once an hour · appears in city chat.{shoutAt && now - shoutAt < 3_600_000 ? ` Next shout after {when(shoutAt + 3_600_000)}.` : ''}</small>
          <div className="prestige-shout">
            <input value={shout} maxLength={SHOUT_MAX} placeholder="Your announcement" onChange={(e) => setShout(e.target.value)} data-testid="vanity-shout" />
            <button type="button" disabled={busy || !signedIn || shout.trim().length < 1} onClick={() => act('vanity_shout', { text: shout }, () => { setShout(''); return 'Shout-out posted.'; })}>Post</button>
          </div>
        </div>
      )}

      {tab === 'patronage' && (
        <div className="prestige-body" data-testid="patronage-desk">
          <small>Naming rights last one week. Chips are burned — the mayor and treasury are not paid. The current patron can renew; anyone else waits until the term ends.</small>
          <ul className="prestige-list">
            {(slots.length ? slots : PATRON_SLOTS.map((s) => ({ ...s, price: s.price, patron: null, canBuy: true }))).map((s) => (
              <li key={s.id}>
                <div>
                  <b>{s.icon} {s.name}</b>
                  <small>{s.blurb}</small>
                  {s.patron ? <small data-testid={`patron-${s.id}`}>Current patron: {s.patron.name} until {when(s.patron.endsAt)}</small> : <small>Available now.</small>}
                </div>
                <button type="button" disabled={busy || !signedIn || !s.canBuy} onClick={() => act('patronage_buy', { slot: s.id }, (r) => `You're the ${s.name} patron for 🪙 ${fmt(Number(r.price))}.`)}>
                  {s.patron?.mine ? `Renew 🪙 ${fmt(s.price)}` : signedIn ? `Sponsor 🪙 ${fmt(s.price)}` : 'Sign in'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && <small role="status" data-testid="prestige-msg">{msg}</small>}
    </MapSheet>
  );
}

export function PrestigeDeskHost() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('vanity');
  useEffect(() => {
    const h = (e: Event) => { setTab((e as CustomEvent<Tab>).detail === 'patronage' ? 'patronage' : 'vanity'); setOpen(true); };
    window.addEventListener(OPEN_PRESTIGE, h); return () => window.removeEventListener(OPEN_PRESTIGE, h);
  }, []);
  if (!open) return null;
  return <PrestigeDesk initialTab={tab} onClose={() => setOpen(false)} />;
}

export function FireworksHost() {
  const [show, setShow] = useState<{ name: string; by: string; until: number } | null>(null);
  useEffect(() => {
    const on = (e: { name?: string; by?: string; durationMs?: number }) => {
      setShow({ name: e.name ?? 'Fireworks', by: e.by ?? 'Someone', until: Date.now() + (e.durationMs ?? 8000) });
    };
    socket.on('vanity_fireworks', on);
    const t = window.setInterval(() => setShow((s) => (s && s.until < Date.now() ? null : s)), 500);
    return () => { socket.off('vanity_fireworks', on); window.clearInterval(t); };
  }, []);
  if (!show) return null;
  return <div className="prestige-fireworks" data-testid="vanity-fireworks" aria-live="polite">🎆 {show.by} set off {show.name}</div>;
}
