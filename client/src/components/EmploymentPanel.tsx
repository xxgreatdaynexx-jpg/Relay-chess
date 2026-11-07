import { MapSheet } from './MapSheet';
import { useDoing } from '@/lib/doing';
import { useCallback, useEffect, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { request } from '@/lib/net';
import { boxCount, JOBS, jobById, OFFLINE_CAP_MS, type EmployLogItem, type EmployView } from '../../../shared/employment';
import { ORES, type OreId } from '../../../shared/mines';
import { fishById } from '../../../shared/fishing';
import { usePanelDrag } from '@/lib/panelDrag';

const chips = (n: number) => Math.round(n).toLocaleString('en-US');
export const OPEN_EMPLOY = 'open-employment';
const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

const ALBERTA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const itemName = (x: EmployLogItem) => x.type === 'ore' ? ORES[x.id as OreId]?.name ?? x.id : fishById(x.id)?.label ?? x.id;

/** Read-only: what your workers picked up in the last 24 h, totalled per item. Everything is already in storage. */
function HaulLog({ log }: { log: EmployLogItem[] }) {
  const total = log.reduce((a, x) => a + x.qty, 0);
  return (
    <div className="employ-log" data-testid="employ-log">
      <h4>Picked up in the last 24 hours</h4>
      {!log.length ? <small className="employ-empty">Nothing yet.</small> : <>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Last pick-up (Alberta)</th></tr></thead>
          <tbody>{log.map((x) => <tr key={`${x.type}:${x.id}`} data-testid="employ-log-row">
            <td>{x.type === 'ore' ? <ItemIcon type="ore" id={x.id} size={16} /> : <span>{fishById(x.id)?.emoji ?? '🐟'}</span>} {itemName(x)}</td>
            <td>{x.qty.toLocaleString('en-US')}</td><td>{ALBERTA.format(x.lastAt)}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td data-testid="employ-log-total">{total.toLocaleString('en-US')}</td><td /></tr></tfoot>
        </table>
      </>}
      <small>Deposited automatically: ores go to your mine/factory storage, fish to your cooler.</small>
    </div>
  );
}

/** Employment Office (city): hire AI miners and fishers (pt1274u). Prices come from the server at today's index. */
export function EmploymentPanel({ onClose }: { onClose: () => void }) {
  useDoing('jobs');
  const dragEmploy = usePanelDrag('employ');
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
    <MapSheet className="world-deed world-venue employ-panel" data-testid="venue-employ" data-drag-panel="employ" onPointerDown={dragEmploy.onPointerDown} style={dragEmploy.style()} ref={dragEmploy.ref}>{dragEmploy.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <div className="employ-front"><span>🧑‍🏭 EMPLOYMENT OFFICE</span><small data-testid="employ-cap">Hire AI workers · Worker cap: {v?.max ?? 3} (base {v?.base ?? 3} + {v?.bonus ?? 0} from property)</small></div>
      <p className="employ-rules">A worker costs about half of what they bring in. Their haul is deposited automatically as they work (ores to your mine/factory storage, fish to your cooler) and sells under the usual daily limits. If storage is full they hold the rest until there's room. They stop working {dur(OFFLINE_CAP_MS)} after you last opened this office, so pop in to keep them busy. Wages are charged once a day; if you can't pay, they stop (no debt). Firing is free but refunds nothing. Workers don't give you skill XP.</p>
      {err && !v && <small className="text-amber-300">{err}</small>}
      {v && (
        <>
          <h4>Your workers</h4>
          {!v.workers.length && <small>No one on the payroll yet.</small>}
          <ul className="employ-list">
            {v.workers.map((w) => { const j = jobById(w.job); const left = w.paidUntil - v.now; return (
              <li key={w.id} data-testid="employ-worker">
                <b>{j?.emoji} {j?.label}</b>
                <small>{w.status === 'working' ? (w.nextAt && w.nextAt > v.now ? `Working · next item in ${dur(w.nextAt - v.now)} · paid for ${dur(left)}` : 'Waiting for you to check in') : w.status === 'idle' ? 'Off duty (you were away). Re-hire to start a new paid day.' : 'Unpaid. Re-hire to pay a new day when you have the chips.'}</small>
                <small>Wage 🪙 {chips(w.wage)}/day</small>
                {boxCount(w.box) > 0 && <small className="text-amber-300" data-testid="employ-held">Holding {boxCount(w.box)} until your storage has room.</small>}
                <div className="employ-btns">
                  {w.status !== 'working' && <button type="button" disabled={!!busy} aria-busy={busy === `c:${w.id}`} data-testid="employ-rehire" onClick={() => act(`c:${w.id}`, 'employ_collect', { id: w.id }, (r) => [r.charged ? `Back to work. Paid 🪙 ${chips(r.charged as number)} wage.` : '', ...((r.notes as string[]) ?? [])].filter(Boolean).join(' ') || 'Checked in.')}>Re-hire</button>}
                  <button type="button" className="employ-fire" disabled={!!busy} data-testid="employ-fire" onClick={() => { if (window.confirm(`Fire ${j?.label}? Fees and wages are not refunded. Anything they're still holding that doesn't fit your storage or cooler is lost.`)) void act(`f:${w.id}`, 'employ_fire', { id: w.id }, () => 'Worker let go.'); }}>Fire</button>
                </div>
              </li>); })}
          </ul>
          {v.workers.length > 0 && <HaulLog log={v.log ?? []} />}
          {!!v.notes?.length && <small className="text-amber-300" data-testid="employ-notes">{v.notes.join(' ')}</small>}
          <h4>Hire</h4>
          {!v.canHire && v.reason && <small className="text-amber-300" data-testid="employ-reason">{v.reason}</small>}
          <ul className="employ-list">
            {JOBS.map((j) => { const p = jobs.find((x) => x.id === j.id); return (
              <li key={j.id}>
                <b>{j.emoji} {j.label}</b>{j.bias && <small className="employ-bias" data-testid={`employ-bias-${j.cave}`}>{j.bias}</small>}<small>{j.blurb}</small>
                {p && <small>Hire 🪙 {chips(p.hire)} + 🪙 {chips(p.wage)}/day · a full day's haul ≈ 🪙 {chips(p.dayValue)}</small>}
                <button type="button" disabled={!!busy || !v.canHire || !p} data-testid={`employ-hire-${j.id}`} onClick={() => act(`h:${j.id}`, 'employ_hire', { job: j.id }, (r) => `Hired ${j.label} for 🪙 ${chips((r.charged as number) ?? 0)} (fee + first day).`)}>{busy === `h:${j.id}` ? 'Hiring…' : p ? `Hire for 🪙 ${chips(p.hire + p.wage)}` : 'Hire'}</button>
              </li>); })}
          </ul>
        </>
      )}
      {msg && <small role="status" data-testid="employ-msg">{msg}</small>}
    </MapSheet>
  );
}

/** Mounted once in the city: opens the office on OPEN_EMPLOY. */
export function EmploymentHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener(OPEN_EMPLOY, h); return () => window.removeEventListener(OPEN_EMPLOY, h); }, []);
  return open ? <EmploymentPanel onClose={() => setOpen(false)} /> : null;
}
