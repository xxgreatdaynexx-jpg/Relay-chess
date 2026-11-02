import { useCallback, useEffect, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { request } from '@/lib/net';
import { JOBS, jobById, OFFLINE_CAP_MS, type EmployView, type WorkerView } from '../../../shared/employment';
import { ORES, type OreId } from '../../../shared/mines';
import { fishById } from '../../../shared/fishing';

const chips = (n: number) => Math.round(n).toLocaleString('en-US');
export const OPEN_EMPLOY = 'open-employment';
const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

function Box({ w }: { w: WorkerView }) {
  const ores = Object.entries(w.box.ores ?? {}).filter(([, n]) => n) as Array<[OreId, number]>;
  const fish = w.box.fish ?? [];
  if (!ores.length && !fish.length) return <small className="employ-empty">Nothing collected yet.</small>;
  return (
    <div className="employ-box" data-testid="employ-box">
      {ores.map(([id, n]) => <span key={id} title={ORES[id].name}><ItemIcon type="ore" id={id} size={18} /> {n}</span>)}
      {fish.map((f, i) => { const d = fishById(f.species); return <span key={i} title={d?.label}>{d?.emoji ?? '🐟'}</span>; })}
      <small>≈ 🪙 {chips(w.boxValue)}</small>
    </div>
  );
}

/** Employment Office (city): hire AI miners and fishers (pt1274u). Prices come from the server at today's index. */
export function EmploymentPanel({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState<EmployView | null>(null); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const take = (r: { ok: boolean; error?: string; view?: unknown }) => { if (r.view) setV(r.view as EmployView); if (!r.ok) setMsg(r.error ?? 'Something went wrong.'); };
  const load = useCallback(() => { void request('employ_view').then((a) => { const r = a as { ok: boolean; error?: string; view?: unknown }; if (r.view) setV(r.view as EmployView); else if (!r.ok) setErr(r.error ?? 'The Employment Office is closed right now.'); }); }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 60_000); return () => window.clearInterval(t); }, [load]);
  const act = async (key: string, ev: string, data: object, ok: (r: Record<string, unknown>) => string) => {
    if (busy) return; setBusy(key); setMsg(null);
    const r = await request(ev, data) as { ok: boolean; error?: string; view?: unknown; [k: string]: unknown };
    setBusy(null); take(r); if (r.ok) setMsg(ok(r));
  };
  const jobs = v?.jobs ?? [];
  return (
    <div className="world-deed world-venue employ-panel" data-testid="venue-employ">
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="employ-front"><span>🧑‍🏭 EMPLOYMENT OFFICE</span><small>Hire AI workers · up to {v?.max ?? 3}</small></div>
      <p className="employ-rules">A worker costs about half of what they bring in. Their haul goes to your normal storage (ores to mine storage, fish to your cooler) and sells under the usual daily limits. They stop working {dur(OFFLINE_CAP_MS)} after your last visit, so check in to keep them busy. Wages are charged once a day; if you can't pay, they stop (no debt). Firing is free but refunds nothing. Workers don't give you skill XP.</p>
      {err && !v && <small className="text-amber-300">{err}</small>}
      {v && (
        <>
          <h4>Your workers</h4>
          {!v.workers.length && <small>No one on the payroll yet.</small>}
          <ul className="employ-list">
            {v.workers.map((w) => { const j = jobById(w.job); const left = w.paidUntil - v.now; return (
              <li key={w.id} data-testid="employ-worker">
                <b>{j?.emoji} {j?.label}</b>
                <small>{w.status === 'working' ? (w.nextAt && w.nextAt > v.now ? `Working · next item in ${dur(w.nextAt - v.now)} · paid for ${dur(left)}` : 'Waiting for you to check in') : w.status === 'idle' ? 'Off duty (you were away). Collect to start a new paid day.' : 'Unpaid. Collect to pay a new day when you have the chips.'}</small>
                <small>Wage 🪙 {chips(w.wage)}/day</small>
                <Box w={w} />
                <div className="employ-btns">
                  <button type="button" disabled={!!busy} aria-busy={busy === `c:${w.id}`} data-testid="employ-collect" onClick={() => act(`c:${w.id}`, 'employ_collect', { id: w.id }, (r) => {
                    const parts = [r.ores ? `${r.ores} ore` : '', r.fish ? `${r.fish} fish` : ''].filter(Boolean).join(' and ');
                    return [parts ? `Collected ${parts}.` : 'Checked in.', r.charged ? `Paid 🪙 ${chips(r.charged as number)} wage.` : '', ...((r.notes as string[]) ?? [])].filter(Boolean).join(' ');
                  })}>{w.status === 'working' ? 'Collect' : 'Collect & re-hire'}</button>
                  <button type="button" className="employ-fire" disabled={!!busy} data-testid="employ-fire" onClick={() => { if (window.confirm(`Fire ${j?.label}? Fees and wages are not refunded. Fish that don't fit your cooler are lost.`)) void act(`f:${w.id}`, 'employ_fire', { id: w.id }, () => 'Worker let go.'); }}>Fire</button>
                </div>
              </li>); })}
          </ul>
          <h4>Hire</h4>
          {!v.canHire && v.reason && <small className="text-amber-300" data-testid="employ-reason">{v.reason}</small>}
          <ul className="employ-list">
            {JOBS.map((j) => { const p = jobs.find((x) => x.id === j.id); return (
              <li key={j.id}>
                <b>{j.emoji} {j.label}</b><small>{j.blurb}</small>
                {p && <small>Hire 🪙 {chips(p.hire)} + 🪙 {chips(p.wage)}/day · a full day's haul ≈ 🪙 {chips(p.dayValue)}</small>}
                <button type="button" disabled={!!busy || !v.canHire || !p} data-testid={`employ-hire-${j.id}`} onClick={() => act(`h:${j.id}`, 'employ_hire', { job: j.id }, (r) => `Hired ${j.label} for 🪙 ${chips((r.charged as number) ?? 0)} (fee + first day).`)}>{busy === `h:${j.id}` ? 'Hiring…' : p ? `Hire for 🪙 ${chips(p.hire + p.wage)}` : 'Hire'}</button>
              </li>); })}
          </ul>
        </>
      )}
      {msg && <small role="status" data-testid="employ-msg">{msg}</small>}
    </div>
  );
}

/** Mounted once in the city: opens the office on OPEN_EMPLOY. */
export function EmploymentHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener(OPEN_EMPLOY, h); return () => window.removeEventListener(OPEN_EMPLOY, h); }, []);
  return open ? <EmploymentPanel onClose={() => setOpen(false)} /> : null;
}
