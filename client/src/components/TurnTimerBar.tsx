import { useEffect, useRef, useState } from 'react';
import { timerColor, timerFraction } from '../../../shared/turnTimer';

/** Draining progress bar for a casino turn/betting deadline (server ms), skew-corrected via serverNow. Red near the end. */
export function TurnTimerBar({ deadline, serverNow, testId }: { deadline: number | null | undefined; serverNow: number | undefined; testId?: string }) {
  const offset = useRef(0); const seen = useRef<number | undefined>(undefined); const total = useRef<{ d: number; t: number } | null>(null);
  const [, force] = useState(0);
  if (serverNow && serverNow !== seen.current) { seen.current = serverNow; offset.current = serverNow - Date.now(); } // re-sync only on a new server snapshot
  useEffect(() => {
    if (deadline == null) return;
    let raf = 0; const tick = () => { force((n) => n + 1); raf = window.setTimeout(tick, 100); };
    tick(); return () => window.clearTimeout(raf);
  }, [deadline]);
  if (deadline == null) return null;
  const now = Date.now() + offset.current;
  if (!total.current || total.current.d !== deadline) total.current = { d: deadline, t: Math.max(1000, deadline - now) };
  const f = timerFraction(deadline, total.current.t, now);
  const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <div className={`turn-timer${f <= 0.25 ? ' turn-timer-low' : ''}`} role="progressbar" aria-label="Time left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} data-testid={testId ?? 'turn-timer'}>
      <i style={{ width: `${f * 100}%`, background: timerColor(f) }} />
      <span>{secs}s</span>
    </div>
  );
}
