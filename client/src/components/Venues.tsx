import { useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { CAR_BY_ID } from '../../../shared/cars';
import { FLY_DEST, RACE_SPLIT, fmtLap, type FlyDest } from '../../../shared/venues';

const chips = (n: number) => n.toLocaleString('en-US');
type Row = { name: string; car: string; ms: number };
type Board = { today: Row[]; allTime: Row[]; cup: { day: string; entry: number; seed: number; pool: number; entrants: number; entered: boolean; standings: Row[] }; lastCup: { day: string; pool: number; payouts: Array<{ name: string; rank: number; amount: number }> } | null };

const Rows = ({ rows, id }: { rows: Row[]; id: string }) => rows.length
  ? <ol className="venue-board" data-testid={id}>{rows.map((r, i) => <li key={r.name + i}><b>{fmtLap(r.ms)}</b> {r.name} <small>{CAR_BY_ID.get(r.car)?.name ?? r.car}</small></li>)}</ol>
  : <small>No laps yet.</small>;

/** Airport (fast travel) and Speedway (boards, Daily Cup, start on the grid) panels. */
export function Venues({ kind, me, driving, onClose, onFly, onDriveFrom }: {
  kind: 'airport' | 'racetrack'; me: string | null; driving: boolean; onClose: () => void;
  onFly: (to: FlyDest) => Promise<{ ok: boolean; error?: string }>; onDriveFrom: (from: string) => Promise<boolean>;
}) {
  const [board, setBoard] = useState<Board | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = () => { void request('race_board').then((r) => { if ((r as { ok: boolean }).ok) setBoard(r as unknown as Board); }); };
  useEffect(() => { if (kind !== 'racetrack') return; load(); const t = window.setInterval(load, 15_000); return () => window.clearInterval(t); }, [kind]);
  const enter = async () => { setBusy(true); setMsg(null); const r = await request('race_enter') as { ok: boolean; error?: string; fee?: number }; setBusy(false); setMsg(r.ok ? `You're in! Paid 🪙 ${chips(r.fee ?? 0)}. Your fastest lap today counts.` : r.error ?? 'Failed.'); load(); };
  const fly = async (to: FlyDest) => { setBusy(true); setMsg(null); const r = await onFly(to); setBusy(false); if (r.ok) onClose(); else setMsg(r.error ?? 'Could not fly.'); };
  const driveFrom = async (from: string) => { setMsg(null); if (!(await onDriveFrom(from))) setMsg('Buy a car at the Car Dealership first.'); else onClose(); };
  return (
    <div className="world-deed world-venue" data-testid={`venue-${kind}`}>
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      {kind === 'airport' ? <>
        <h3>✈️ Chud Hub International</h3>
        <small>Fast travel: you and your car fly to any stop. Free, takes a second. You have to be at the airport in your car.</small>
        {driving
          ? (Object.keys(FLY_DEST) as FlyDest[]).filter((d) => d !== 'airport').map((d) => <button key={d} type="button" disabled={busy} onClick={() => void fly(d)} data-testid={`fly-${d}`}>🛫 Fly to {FLY_DEST[d].label}</button>)
          : <button type="button" onClick={() => void driveFrom('airport')} data-testid="venue-drive-airport">🚗 Get your car at the terminal</button>}
      </> : <>
        <h3>🏁 Chud Hub Speedway</h3>
        <small>Time-trial laps in your own car. Laps are timed by the server through 4 gates. Leaving the asphalt voids the lap.</small>
        <button type="button" onClick={() => void driveFrom('grid')} data-testid="venue-grid">🏎 Line up on the grid</button>
        {board && <>
          <h4>🏆 Daily Cup · {board.cup.day} (UTC)</h4>
          <small>Entry 🪙 {chips(board.cup.entry)} · pool 🪙 {chips(board.cup.pool)} (fees + 🪙 {chips(board.cup.seed)} from the house) · {board.cup.entrants} entered.
            Top 3 Cup laps at the end of the UTC day win {RACE_SPLIT.map((s) => `${s * 100}%`).join(' / ')}.</small>
          {me ? (board.cup.entered ? <small data-testid="cup-entered">✅ You're entered.</small> : <button type="button" disabled={busy} onClick={() => void enter()} data-testid="cup-enter">Enter today's Cup for 🪙 {chips(board.cup.entry)}</button>) : <small>Sign in to enter.</small>}
          <Rows rows={board.cup.standings} id="cup-standings" />
          <h4>⏱ Fastest laps today</h4><Rows rows={board.today} id="laps-today" />
          <h4>All-time</h4><Rows rows={board.allTime} id="laps-all" />
          {board.lastCup && <small>Last Cup ({board.lastCup.day}): {board.lastCup.payouts.length ? board.lastCup.payouts.map((p) => `#${p.rank} ${p.name} 🪙 ${chips(p.amount)}`).join(' · ') : 'no prizes paid'}</small>}
        </>}
      </>}
      {msg && <small data-testid="venue-msg">{msg}</small>}
    </div>
  );
}
