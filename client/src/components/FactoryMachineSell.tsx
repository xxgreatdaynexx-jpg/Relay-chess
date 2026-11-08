import { useRef, useState } from 'react';
import { SellAllConfirm } from './SellAllConfirm';

export type SellAsk = (ev: string, body: object) => Promise<{ ok: boolean; error?: string; result?: unknown }>;
/**
 * Sell action for one placed machine (t1967u). The price is the SERVER quote (fac_sell_quote); confirming sends that
 * quote back and the server re-checks it, ownership and idleness. Confirm is disabled while a request is in flight.
 */
export function FactoryMachineSell({ id, kind, name, ask, onSold, flash, unplaced }: { id?: number; kind: string; name: string; ask: SellAsk; onSold: () => void; flash: (t: string) => void; /** Machinist menu: sell ONE unplaced machine from your kit (have = how many you hold unplaced). */ unplaced?: { have: number } }) {
  const kit = !!unplaced; const tid = kit ? `fac-sellkit-${kind}` : 'fac-sell';
  const [quote, setQuote] = useState<number | null>(null); const [busy, setBusyS] = useState(false); const inflight = useRef(false);
  const setBusy = (v: boolean) => { inflight.current = v; setBusyS(v); };
  const start = async () => { if (inflight.current) return; setBusy(true); try { const r = await (kit ? ask('fac_sellkit_quote', { kind, n: 1 }) : ask('fac_sell_quote', { id })); if (r.ok) setQuote((r.result as { pay: number }).pay); else flash(r.error ?? 'Cannot sell that.'); } finally { setBusy(false); } };
  const confirm = async () => { if (inflight.current || quote === null) return; setBusy(true); try { const r = await (kit ? ask('fac_sellkit', { kind, n: 1, quote }) : ask('fac_sell', { id, kind, quote })); if (r.ok) { flash(`Sold ${kit ? 'an unplaced' : 'the'} ${name} for ${quote.toLocaleString()} chips.`); setQuote(null); onSold(); } else { flash(r.error ?? 'Sale failed.'); setQuote(null); } } finally { setBusy(false); } };
  // Rendered through the shared Sell-all dialog: a fixed backdrop portaled to <body>, so the Factory sidebar's scroll box
  // (and any transformed/dragged window around it) can't clip it. The Sell button stays in the inspect panel.
  return <>
    <button type="button" onClick={start} disabled={busy || quote !== null || (kit && unplaced!.have < 1)} data-testid={tid}>{kit ? `💰 Sell 1 (×${unplaced!.have})` : '💰 Sell'}</button>
    {quote !== null && <SellAllConfirm title={kit ? `Sell 1 unplaced ${name}?` : `Sell this ${name}?`} testid={tid} busy={busy}
      text={`You get ${quote.toLocaleString()} chips: half the base Machinist price.${kit ? ` It comes out of your ${unplaced!.have} unplaced; placed machines stay where they are.` : ''} Belts, chests, storage and your other machines are not touched.`}
      onCancel={() => setQuote(null)} onConfirm={() => void confirm()} />}
  </>;
}
