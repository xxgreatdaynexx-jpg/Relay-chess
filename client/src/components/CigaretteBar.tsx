import { useEffect, useState } from 'react';
import { cigRemain, formatCigRemain, smokeCigarette, useCigaretteState } from '@/lib/cigarettes';
import { CIGARETTE_BUFF_MAX_MS, CIGARETTE_BUFF_RATE } from '../../../shared/cigarettes';

/** Smoke button (only when you have one) and a timer chip with a small smoke wisp while the buff is on. */
export function CigaretteBar({ open }: { open: boolean }) {
  const st = useCigaretteState(open);
  const [, tick] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const left = cigRemain(st);
  useEffect(() => {
    if (!st?.until) return;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [st?.until]);
  if (!st || (st.qty <= 0 && left <= 0)) return null;
  const atCap = left >= CIGARETTE_BUFF_MAX_MS - 250;
  const pct = Math.round(CIGARETTE_BUFF_RATE * 100);
  const smoke = async () => {
    if (busy || atCap) return;
    setBusy(true); setErr('');
    const r = await smokeCigarette();
    setBusy(false);
    if (!r.ok) setErr(r.error);
  };
  return (
    <div className="cig-bar" data-testid="cig-bar">
      {left > 0 && (
        <span className="cig-timer" data-testid="cig-timer" title={`+${pct}% of net winnings from the house`}>
          <span className="cig-wisps" aria-hidden="true"><i /><i /><i /></span>
          🚬 {formatCigRemain(left)} · +{pct}%
        </span>
      )}
      {st.qty > 0 && (
        <button type="button" className="cig-smoke-btn" data-testid="cig-smoke" disabled={busy || atCap}
          title={atCap ? 'Buff is already at the 15-minute maximum.' : `Smoke one cigarette for +${pct}% net winnings, 3 minutes (${st.qty} in stock)`}
          onClick={() => void smoke()}>
          Smoke a cigarette{st.qty > 1 ? ` · ${st.qty}` : ''}
        </button>
      )}
      {err && <span className="bj-err">{err}</span>}
    </div>
  );
}
