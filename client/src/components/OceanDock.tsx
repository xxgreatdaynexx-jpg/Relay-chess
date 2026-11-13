import { useEffect, useState } from 'react';
import { request, socket } from '@/lib/net';
import { refreshTrip, tripNow, useTrip } from '@/lib/travel';
import { VOYAGES, type VoyageId, type VoyageView, type YachtBoardingView, type FightView } from '../../../shared/voyages';

const fmt = (n: number) => n.toLocaleString('en-US');
export const OPEN_OCEAN = 'open-ocean-dock';

type View = {
  signedIn: boolean; opted: boolean; repair: number; repairChips: number;
  voyage: VoyageView | null; boarding: YachtBoardingView | null; boardings: YachtBoardingView[];
  challenge: { from: string; fromName: string; stake: number } | null;
  fight: FightView | null;
  atSea: Array<{ captain: string; boatName: string; dest: string; opted: boolean }>;
  cap: number;
};

export function OceanDock() {
  const trip = useTrip();
  const atSea = trip.loc === 'voyage';
  const [open, setOpen] = useState(atSea);
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState<VoyageId | 'island'>('atoll');
  const [price, setPrice] = useState(0);
  const [stake, setStake] = useState(0);

  const load = () => { void request('ocean_view').then((r) => { const a = r as unknown as { ok: boolean } & View; if (a.ok) { setV(a); if (tripNow().loc === 'voyage' && !a.voyage) void refreshTrip(); } }); };
  useEffect(() => {
    load();
    const onOpen = () => setOpen(true);
    const onPing = () => load();
    window.addEventListener(OPEN_OCEAN, onOpen);
    socket.on('ocean_ping', onPing); socket.on('ocean_event', onPing);
    const t = window.setInterval(load, 8_000);
    return () => { window.removeEventListener(OPEN_OCEAN, onOpen); socket.off('ocean_ping', onPing); socket.off('ocean_event', onPing); window.clearInterval(t); };
  }, []);
  useEffect(() => { if (atSea || v?.voyage) setOpen(true); }, [atSea, v?.voyage]);

  const act = async (ev: string, data?: object, ok?: (a: Record<string, unknown>) => string) => {
    setBusy(true); const r = await request(ev, data); setBusy(false);
    const a = r as unknown as { ok: boolean; error?: string } & Record<string, unknown>;
    if (a.ok) { setMsg(ok ? ok(a) : null); load(); void refreshTrip(); }
    else setMsg(a.error ?? 'Something went wrong.');
    return a;
  };

  const canSailHome = !!(v?.voyage || atSea) && !v?.fight;
  const sailHomeLabel = v?.voyage?.phase === 'returning' ? 'Returning…' : 'Sail home';
  const sailHome = () => void act('voyage_home', {}, (a) => a.loc === 'city' ? 'Back in the city.' : 'Setting course for home.');

  if (!open && !v?.voyage && !v?.fight && !v?.challenge && !(v?.boardings.length) && !atSea) return null;

  return (
    <div className="jet-seats-dock" data-testid="ocean-dock">
      <header>
        <b>⚓ Ocean</b>
        {canSailHome && <button type="button" disabled={busy || v?.voyage?.phase === 'returning'} data-testid="voyage-home" onClick={sailHome}>{sailHomeLabel}</button>}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▴'}</button>
      </header>
      {open && (
        <div className="jet-seats-body">
          {v?.repairChips ? <p data-testid="hull-repair">Hull damage: 🪙 {fmt(v.repairChips)} to repair. <button type="button" disabled={busy} onClick={() => void act('hull_repair', {}, (a) => `Paid 🪙 ${fmt(Number(a.paid))} for repairs.`)}>Repair hull</button></p> : null}
          {v?.voyage && (
            <div data-testid="ocean-voyage">
              <p>{v.voyage.phase === 'underway' ? 'Underway to' : v.voyage.phase === 'returning' ? 'Returning from' : 'Arrived at'} <b>{v.voyage.destName}</b> aboard {v.voyage.boatName}. Crew: {v.voyage.crew.length ? v.voyage.crew.join(', ') : 'just you'}.</p>
              {canSailHome && v.voyage.phase !== 'returning' && <button type="button" disabled={busy} data-testid="voyage-home-body" onClick={sailHome}>Sail home</button>}
            </div>
          )}
          {v?.fight && (
            <div data-testid="ship-fight">
              <p>{v.fight.a.name} ({v.fight.a.hp}/{v.fight.a.max}) vs {v.fight.b.name} ({v.fight.b.hp}/{v.fight.b.max}) · stake 🪙 {fmt(v.fight.stake)}</p>
              <p>To act: {v.fight.toAct}</p>
              <button type="button" disabled={busy} data-testid="ship-fire" onClick={() => void act('ship_fire')}>Fire</button>
              <button type="button" disabled={busy} data-testid="ship-flee" onClick={() => void act('ship_flee')}>Flee</button>
            </div>
          )}
          {v?.challenge && !v.fight && (
            <div data-testid="ship-challenge">
              <p>{v.challenge.fromName} challenges you{v.challenge.stake ? ` for 🪙 ${fmt(v.challenge.stake)}` : ''}.</p>
              <button type="button" disabled={busy} onClick={() => void act('ship_answer', { accept: true })}>Accept</button>
              <button type="button" disabled={busy} onClick={() => void act('ship_answer', { accept: false })}>Decline</button>
            </div>
          )}
          {v?.voyage?.phase === 'arrived' && (
            <div>
              <label><input type="checkbox" checked={!!v.opted} data-testid="ship-opt-in" onChange={(e) => void act('ship_opt_in', { on: e.target.checked })} /> Opt in to ship combat</label>
              {v.opted && v.atSea.filter((c) => c.opted && c.captain !== v.voyage?.captain).map((c) => (
                <div key={c.captain}><button type="button" disabled={busy} onClick={() => void act('ship_challenge', { name: c.captain, stake }, () => `Challenged ${c.captain}.`)}>Challenge {c.captain} ({c.boatName})</button></div>
              ))}
              {v.opted && <label>Stake <input type="number" min={0} value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} /></label>}
            </div>
          )}
          {!v?.voyage && (
            <>
              <p>Open boarding on your yacht, or sail a voyage yourself. Ship combat is opt-in and only happens after both boats have arrived.</p>
              <label>To <select value={dest} onChange={(e) => setDest(e.target.value as VoyageId | 'island')} data-testid="voyage-dest">
                {VOYAGES.map((d) => <option key={d.id} value={d.id}>{d.name} (zone {d.minZone})</option>)}
                <option value="island">Private Island (megayacht)</option>
              </select></label>
              <label>Seat fare <input type="number" min={0} max={v?.cap ?? 0} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} /></label>
              <div className="jet-seat-actions">
                <button type="button" disabled={busy} data-testid="yacht-board-open" onClick={() => void act('yacht_board_open', { dest, price }, () => 'Boarding is open.')}>Open boarding</button>
                <button type="button" disabled={busy} data-testid="voyage-start" onClick={() => void act('voyage_start', { dest }, (a) => a.loc === 'island' ? 'Sailing to the Private Island.' : `Underway to ${String((a.voyage as VoyageView | undefined)?.destName ?? dest)}.`)}>Sail</button>
              </div>
              {v?.boarding && v.boarding.owner && <button type="button" disabled={busy} onClick={() => void act('yacht_board_cancel')}>Cancel boarding</button>}
              {v?.boardings.map((b) => (
                <div key={b.id} className="jet-seat-row">
                  <b>{b.owner}&apos;s {b.boatName}</b> <small>to {b.dest === 'island' ? 'the Private Island' : VOYAGES.find((d) => d.id === b.dest)?.name} · {b.seated.length}/{b.seats} seated · {b.price ? `fare 🪙 ${fmt(b.price)}` : 'free'}</small>
                  <button type="button" disabled={busy} onClick={() => void act('yacht_seat_request', { id: b.id })}>Request a seat</button>
                  {b.pending.map((p) => (
                    <span key={p.name}>{p.name} <button type="button" onClick={() => void act('yacht_seat_respond', { name: p.name, accept: true })}>Accept</button><button type="button" onClick={() => void act('yacht_seat_respond', { name: p.name, accept: false })}>Decline</button></span>
                  ))}
                </div>
              ))}
            </>
          )}
          {atSea && !v?.voyage && <button type="button" disabled={busy} data-testid="voyage-home-stranded" onClick={sailHome}>Return to the city</button>}
          {msg && <small data-testid="ocean-msg">{msg}</small>}
        </div>
      )}
    </div>
  );
}
