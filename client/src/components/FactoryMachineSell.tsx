import { useRef, useState } from 'react';

export type SellAsk = (ev: string, body: object) => Promise<{ ok: boolean; error?: string; result?: unknown }>;
/**
 * Sell action for one placed machine (t1967u). The price is the SERVER quote (fac_sell_quote); confirming sends that
 * quote back and the server re-checks it, ownership and idleness. Confirm is disabled while a request is in flight.
 */
export function FactoryMachineSell({ id, kind, name, ask, onSold, flash }: { id: number; kind: string; name: string; ask: SellAsk; onSold: () => void; flash: (t: string) => void }) {
  const [quote, setQuote] = useState<number | null>(null); const [busy, setBusyS] = useState(false); const inflight = useRef(false);
  const setBusy = (v: boolean) => { inflight.current = v; setBusyS(v); };
  const start = async () => { if (inflight.current) return; setBusy(true); try { const r = await ask('fac_sell_quote', { id }); if (r.ok) setQuote((r.result as { pay: number }).pay); else flash(r.error ?? 'Cannot sell that.'); } finally { setBusy(false); } };
  const confirm = async () => { if (inflight.current || quote === null) return; setBusy(true); try { const r = await ask('fac_sell', { id, kind, quote }); if (r.ok) { flash(`Sold the ${name} for ${quote.toLocaleString()} chips.`); setQuote(null); onSold(); } else { flash(r.error ?? 'Sale failed.'); setQuote(null); } } finally { setBusy(false); } };
  if (quote === null) return <button type="button" onClick={start} disabled={busy} data-testid="fac-sell">💰 Sell</button>;
  return (
    <div className="fac-sellconfirm" role="alertdialog" aria-label={`Sell ${name}`} data-testid="fac-sell-confirm">
      <p>Sell this <b>{name}</b> for <b data-testid="fac-sell-pay">{quote.toLocaleString()}</b> chips? <small>Half the base Machinist price. Belts, chests, storage and your other machines are not touched.</small></p>
      <div className="fac-iact">
        <button type="button" onClick={confirm} disabled={busy} data-testid="fac-sell-yes">Confirm sale</button>
        <button type="button" onClick={() => setQuote(null)} disabled={busy} data-testid="fac-sell-no">Cancel</button>
      </div>
    </div>
  );
}
