import { useEffect, useState } from 'react';
import { loadName } from '@/lib/playerName';

type WT = { ok: boolean; error?: string; rate: number; mult: number; activeDays: number; active: number; median: number; threshold: number; payers: number; total: number; treasury?: number; recipients: number;
  me: { netWorth: number; tax: number; share: number } | null; last: { day: string; threshold: number; payers: number; recipients: number; total: number; treasury?: number; share: number } | null };
const n = (v: number) => Math.round(v).toLocaleString();

/** Wealth tax line: today's threshold, my estimated tax/share, and the last payout. */
export function WealthTaxCard() {
  const [w, setW] = useState<WT | null>(null);
  useEffect(() => {
    let live = true; const name = loadName();
    fetch(`/api/wealth-tax${name ? `?name=${encodeURIComponent(name)}` : ''}`).then((r) => r.json()).then((j: WT) => { if (live && j.ok) setW(j); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!w) return null;
  const help = `Every UTC reset (6 PM CST): players active in the last ${w.activeDays} days whose net worth (chips + assets) is above ${w.mult}× the median (taken only over active players worth 🪙 10,000 or more; anyone under 10,000 never pays, and if nobody is at 10,000+ there is no tax) pay ${w.rate * 100}% of the excess, from chips only (never more than their chips, nothing is sold). ${w.treasury != null ? `25% of what is collected goes to the city treasury (the treasury is capped at 🪙 10,000,000; any part above the cap is burned); the other 75% is split evenly among active players below the line.` : 'Every chip collected is split evenly among active players below the line. Nothing is burned.'}`;
  return (
    <div className="mt-2 rounded-lg bg-white/5 p-2 text-[12px]" data-testid="econ-wealth-tax" title={help}>
      <div className="text-[10px] uppercase tracking-wide opacity-60">⚖ Wealth tax ⓘ</div>
      <div>Threshold today: <b className="tabular-nums">🪙 {n(w.threshold)}</b> <span className="opacity-60">({w.mult}× median {n(w.median)} of players at 10K+ · {w.rate * 100}% above it)</span></div>
      {w.me && <div data-testid="wt-me">{w.me.tax > 0 ? <>Your estimated tax: <b className="text-rose-300 tabular-nums">−🪙 {n(w.me.tax)}</b></> : w.me.share > 0 ? <>Your estimated share: <b className="text-emerald-300 tabular-nums">+🪙 {n(w.me.share)}</b></> : <>You owe nothing today.</>}</div>}
      <div className="opacity-70">Estimate: {w.payers} pay 🪙 {n(w.total)} → {w.treasury ? <>🪙 {n(w.treasury)} to the city treasury, the rest </> : null}split among {w.recipients}</div>
      <div className="opacity-70" data-testid="wt-last">{w.last ? <>Last payout ({w.last.day}): 🪙 {n(w.last.total)} from {w.last.payers}{w.last.treasury ? <>, 🪙 {n(w.last.treasury)} to the city treasury, the rest</> : null} to {w.last.recipients} players (~🪙 {n(w.last.share)} each)</> : <>No payout yet. The first one is at the next reset.</>}</div>
      <p className="text-[10px] opacity-50">{help}</p>
    </div>
  );
}
