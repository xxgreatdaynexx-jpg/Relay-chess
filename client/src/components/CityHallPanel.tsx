import { MapSheet } from './MapSheet';
import { abDate } from '../../../shared/mayor';
import { MayorLaws } from './MayorLaws';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { usePanelDrag } from '@/lib/panelDrag';
import { CityCivic } from './CityCivic';
import { MayorBillReviewHost, OPEN_BILL_REVIEW } from './MayorBillReview';
import type { CityView } from '../../../shared/city';
import { pct, rateLabel, AB_OFFSET_MS, type CityHallView } from '../../../shared/mayor';

export const OPEN_CITYHALL = 'open-cityhall';
const chips = (n: number) => Math.round(n).toLocaleString('en-US');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Fri 12:00 AM AB" in fixed UTC-6. */
export const abWhen = (t: number) => { const d = new Date(t + AB_OFFSET_MS); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${DOW[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} AB`; };
const PHASE: Record<string, string> = { filing: 'Candidates filing (Mon–Thu)', voting: 'Voting open (Fri–Sat)', results: 'Results day (Sun)' };

/** City Hall (pt1312u): run for mayor, vote, and — if you're mayor — nudge property tax and trading fees within ±25%. */
export function CityHallPanel({ onClose, initial, initialCity }: { onClose: () => void; initial?: CityHallView; initialCity?: CityView }) {
  useDoing('cityhall');
  const drag = usePanelDrag('cityhall');
  const [v, setV] = useState<CityHallView | null>(initial ?? null); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [slogan, setSlogan] = useState(''); const [prop, setProp] = useState(1); const [fee, setFee] = useState(1);
  const load = useCallback(() => { if (initial) return; void request('mayor_view').then((a) => { const r = a as { ok: boolean; error?: string; view?: CityHallView }; if (r.view) setV(r.view); else if (!r.ok) setErr(r.error ?? 'City Hall is closed right now.'); }); }, [initial]);
  useEffect(() => { load(); const t = window.setInterval(load, 60_000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { if (v) { const src = v.pending ?? v.rates; setProp(src.property); setFee(src.fee); } }, [v?.rates.property, v?.rates.fee, v?.pending?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (ev: string, data: object, ok: (r: Record<string, unknown>) => string) => {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await request(ev, data) as { ok: boolean; error?: string; view?: CityHallView; [k: string]: unknown };
    setBusy(false); if (r.view) setV(r.view); setMsg(r.ok ? ok(r) : r.error ?? 'Something went wrong.');
  };
  const s = v?.schedule; const L = v?.limits; const me = v?.me;
  const slider = (label: string, val: number, set: (n: number) => void, base: string, eff: string, id: string) => (
    <label className="cityhall-rate">
      <span>{label}: <b>{rateLabel(val)}</b> <small>({eff}; default {base})</small></span>
      <input type="range" min={L!.min} max={L!.max} step={L!.step} value={val} data-testid={id} disabled={!me?.canChange || busy} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
  return (
    <MapSheet className="world-deed world-venue cityhall-panel" data-testid="venue-cityhall" data-drag-panel="cityhall" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="cityhall-front"><span>🏛️ CITY HALL</span><small>Weekly mayor election · Alberta time</small></div>
      {err && !v && <small className="text-amber-300">{err}</small>}
      {v && s && L && (
        <>
          <div className="cityhall-mayor" data-testid="cityhall-mayor">
            {v.mayor ? <><b>🎖️ Mayor {v.mayor.name}</b><small>Elected with {v.mayor.votes} vote{v.mayor.votes === 1 ? '' : 's'} · term ends {abWhen(v.mayor.endsAt)}</small></> : <b>No sitting mayor</b>}
            {v.vice && <small data-testid="vice-mayor">Vice Mayor {v.vice.name} (runner-up, {v.vice.votes} vote{v.vice.votes === 1 ? '' : 's'})</small>}
            {v.elect && <small>Mayor-elect: <b>{v.elect.name}</b> takes office {abWhen(v.elect.startsAt)}</small>}
          </div>
          <div className="cityhall-rates">
            <div><small>Property tax</small><b>{pct(L.base.property * v.rates.property)}/day</b><small>{rateLabel(v.rates.property)}</small></div>
            <div><small>Market fee</small><b>{pct(L.base.market * v.rates.fee, 2)}</b><small>{rateLabel(v.rates.fee)}</small></div>
            <div><small>Stock fee</small><b>{pct(L.base.stock * v.rates.fee, 3)}</b><small>{rateLabel(v.rates.fee)}</small></div>
          </div>
          {v.pending && <small className="cityhall-pending">Next: property tax {rateLabel(v.pending.property)}, fees {rateLabel(v.pending.fee)} from {abWhen(v.pending.effectiveAt)}</small>}

          <h4>This week · {PHASE[s.phase]}</h4>
          <small className="cityhall-sched">Run until {abWhen(s.votingAt)} · vote until {abWhen(s.resultsAt)} · new term {abWhen(s.termStart)}</small>
          {!v.candidates.length && <small>No candidates yet.</small>}
          <ul className="cityhall-list">
            {v.candidates.map((c) => (
              <li key={c.name} data-testid="cityhall-candidate">
                <div><b>{c.name}</b><small>“{c.slogan}”</small></div>
                {s.phase === 'results' && c.votes !== undefined && <span className="cityhall-votes">{c.votes} 🗳️</span>}
                {s.phase === 'voting' && <button type="button" disabled={busy || !me?.canVote} onClick={() => act('mayor_vote', { candidate: c.name }, () => `You voted for ${c.name}.`)}>Vote</button>}
              </li>))}
          </ul>
          {me?.votedFor && <small data-testid="cityhall-voted">You voted for {me.votedFor}.</small>}
          {s.phase === 'filing' && me && !me.filed && (
            <div className="cityhall-file">
              <input value={slogan} maxLength={80} placeholder="Your campaign slogan" onChange={(e) => setSlogan(e.target.value)} data-testid="cityhall-slogan" />
              <button type="button" disabled={busy || slogan.trim().length < 3} onClick={() => act('mayor_file', { slogan }, () => `You're on the ballot. 🪙 ${chips(L.fee)} filing fee paid.`)}>Run for 🪙 {chips(L.fee)}</button>
            </div>)}
          {me?.reason && s.phase !== 'results' && <small className="text-amber-300" data-testid="cityhall-reason">{me.reason}</small>}

          {me?.isMayor && (
            <div className="cityhall-powers" data-testid="cityhall-powers">
              <h4>Mayor’s desk</h4>
              <button type="button" data-testid="open-bill-review" onClick={() => window.dispatchEvent(new Event(OPEN_BILL_REVIEW))}>📝 Bill clarification questions</button>
              <small>Each rate moves up to ±25% of the default. Changes start at the next midnight (Alberta time), once per day, and are logged publicly.</small>
              {slider('Property tax', prop, setProp, pct(L.base.property), `${pct(L.base.property * prop)}/day`, 'cityhall-prop')}
              {slider('Market & stock fees', fee, setFee, `${pct(L.base.market)} / ${pct(L.base.stock)}`, `${pct(L.base.market * fee, 2)} / ${pct(L.base.stock * fee, 3)}`, 'cityhall-fee')}
              {me.changeReason && <small className="text-amber-300">{me.changeReason}</small>}
              <button type="button" disabled={busy || !me.canChange} onClick={() => act('mayor_rates', { property: prop, fee }, () => 'Saved. New rates start at midnight.')}>Set rates for tomorrow</button>
            </div>)}

          <h4>Public log</h4>
          {!v.log.length && <small>No rate changes yet.</small>}
          <ul className="cityhall-log" data-testid="cityhall-log">
            {v.log.map((c, i) => <li key={i}><small>{abWhen(c.at)}</small> <b>{c.by === 'admin' ? 'Admin' : `Mayor ${c.by}`}</b>: {c.note ?? `property tax ${rateLabel(c.property)}, fees ${rateLabel(c.fee)} from ${abWhen(c.effectiveAt)}`}</li>)}
          </ul>
          {v.laws && <MayorLaws view={v.laws} isMayor={!!me?.isMayor} isVice={!!me?.isVice} today={abDate(v.now)} busy={busy} onPass={async (text) => { await act('mayor_law_submit', { text }, (r) => { const b = r.bill as { title: string; status?: string }; return b.status === 'pending_approval' ? 'Submitted for mayor approval.' : `Submitted ${b.title}.`; }); }} onVeto={async (number) => { await act('mayor_law_veto', { number }, (r) => `${(r.bill as { title: string }).title} is marked Vetoed.`); }} onApproveDraft={async (id) => { await act('mayor_law_draft_approve', { id }, (r) => `Approved ${(r.bill as { title: string }).title}.`); }} onRejectDraft={async (id, reason) => { await act('mayor_law_draft_reject', { id, reason }, (r) => `${(r.bill as { title: string }).title} was rejected.`); }} />}
          <div className="prestige-entry">
            <h4>Prestige desk</h4>
            <small>Titles, fireworks, liveries, shout-outs, and city patronage naming rights.</small>
          </div>
          <CityCivic initial={initialCity} />
          <p className="cityhall-rules">Besides these rates the mayor can only use the city levers, policies and buildings above. Casino odds and payouts, chip balances, sell limits and everything else stay out of reach. Mayors get no salary, and the treasury can never pay out to anyone.</p>
        </>
      )}
      {msg && <small role="status" data-testid="cityhall-msg">{msg}</small>}
    </MapSheet>
  );
}

/** Mounted once in the city: opens City Hall on OPEN_CITYHALL and shows a one-day banner after an election. */
export function CityHallHost() {
  const [open, setOpen] = useState(false); const [banner, setBanner] = useState<string | null>(null); const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener(OPEN_CITYHALL, h); return () => window.removeEventListener(OPEN_CITYHALL, h); }, []);
  useEffect(() => {
    void fetch('/api/city-hall').then((r) => r.json()).then((j: { view?: CityHallView }) => {
      const v = j.view; if (!v) return; const now = v.now;
      const t = v.elect ? `🏛️ ${v.elect.name} won the mayor election and takes office ${abWhen(v.elect.startsAt)}.` : v.mayor && now - v.mayor.startsAt < 86_400_000 ? `🏛️ Mayor ${v.mayor.name} is now in office.` : null;
      if (t && localStorage.getItem('cityhall-banner') !== t) setBanner(t);
    }).catch(() => {});
    // City notices (phase 2): the newest mayor action from the last day (lever, policy, building, recall) as a dismissible banner.
    void fetch('/api/city').then((r) => r.json()).then((j: { view?: CityView }) => {
      const a = j.view?.actions?.[0]; if (!a || Date.now() - a.at > 86_400_000) return;
      const t = `🏛️ City notice — ${a.by === 'recall' || a.by === 'admin' ? 'City Hall' : `Mayor ${a.by}`}: ${a.text}`;
      if (localStorage.getItem('city-notice') !== a.id) setNotice({ id: a.id, text: t });
    }).catch(() => {});
  }, []);
  return (<>
    {banner && <div className="cityhall-banner" role="status" data-testid="cityhall-banner">{banner}<button type="button" aria-label="Dismiss" onClick={() => { localStorage.setItem('cityhall-banner', banner); setBanner(null); }}>✕</button></div>}
    {notice && !banner && <div className="cityhall-banner city-notice" role="status" data-testid="city-notice">{notice.text}<button type="button" aria-label="Dismiss" onClick={() => { localStorage.setItem('city-notice', notice.id); setNotice(null); }}>✕</button></div>}
    {open && <CityHallPanel onClose={() => setOpen(false)} />}
    <MayorBillReviewHost />
  </>);
}
