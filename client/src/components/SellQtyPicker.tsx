import { useEffect, useRef, useState } from 'react';
import { quickQty } from '../../../shared/sellQty';

/** Partial selling to the house (request #11): number + slider, 1 / 10 / Half / All, and a payout preview that respects the daily tier cap.
 *  A ref lock blocks a second sell until the first one answers, so a double click never double-sells. */
export function SellQtyPicker({ owned, preview, onSell, unit = 'items', disabled, testid = 'sell-qty' }: {
  owned: number; preview: (qty: number) => number; onSell: (qty: number) => Promise<unknown> | void; unit?: string; disabled?: boolean; testid?: string;
}) {
  const [qty, setQty] = useState(() => Math.min(1, owned));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { setQty((q) => Math.max(owned > 0 ? 1 : 0, Math.min(owned, q || 1))); }, [owned]);
  if (owned < 1) return null;
  const set = (n: number) => setQty(Math.max(1, Math.min(owned, Math.floor(Number.isFinite(n) ? n : 1))));
  const pay = preview(qty);
  const go = async () => {
    if (lock.current || disabled) return; lock.current = true; setBusy(true);
    try { await onSell(qty); } finally { lock.current = false; setBusy(false); }
  };
  return (
    <div className="sell-qty" data-testid={testid}>
      <div className="sell-qty-row">
        <input type="number" min={1} max={owned} step={1} value={qty} onChange={(e) => set(parseInt(e.target.value, 10))} aria-label={`How many ${unit} to sell`} data-testid={`${testid}-input`} />
        <input type="range" min={1} max={owned} step={1} value={qty} onChange={(e) => set(Number(e.target.value))} aria-label={`How many ${unit} to sell (slider)`} data-testid={`${testid}-slider`} />
      </div>
      <div className="sell-qty-row">
        {(['1', '10', 'half', 'all'] as const).map((k) => <button key={k} type="button" onClick={() => set(quickQty(k, owned))} data-testid={`${testid}-q${k}`}>{k === 'half' ? 'Half' : k === 'all' ? 'All' : k}</button>)}
        <button type="button" className="sell-qty-go" disabled={disabled || busy || pay < 1} aria-busy={busy} onClick={() => void go()} data-testid={`${testid}-go`}>
          {busy ? 'Selling…' : <>Sell {qty} of {owned} · 🪙 {pay.toLocaleString()}</>}
        </button>
      </div>
      {pay < 1 && <small className="opacity-70">Pays nothing: today's cap is used up or the amount is too small.</small>}
    </div>
  );
}
