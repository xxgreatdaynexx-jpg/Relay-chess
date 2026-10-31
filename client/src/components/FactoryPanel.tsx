import { useEffect, useRef, useState } from 'react';
import { TopTab } from '@/components/TopTabs';
import { useWalletChips } from '@/lib/wallet';
import { useWindowDrag } from '@/lib/windowDrag';
import { socket } from '@/lib/net';
import { MinesFactory, type Ack } from '@/components/MinesFactory';
import { ORES, SELL_TIERS, isOre, nameOf, priceOf, stackKey, type Stack } from '../../../shared/mines';

const OPEN_KEY = 'relay-factory-open';
type Quote = { gross: number; paid: number; already: number } | null;

/** Factory tab: banked storage from the Mines, the house Sell desk (daily cap) and the furnace/workbench. */
export function FactoryPanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1' || window.location.pathname === '/factory' || window.location.hash === '#factory');
  useEffect(() => localStorage.setItem(OPEN_KEY, open ? '1' : '0'), [open]);
  return (
    <div className={`mines-wrap factory-wrap ${open ? 'mines-open' : ''}`} data-testid="factory">
      <TopTab id="factory"><button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="factory-tab">{open ? '▴ Factory' : '🏭 Factory'}</button></TopTab>
      {open && <FactoryWindow onClose={() => setOpen(false)} />}
    </div>
  );
}

function FactoryWindow({ onClose }: { onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('factory', wrapRef);
  const wallet = useWalletChips();
  const [st, setSt] = useState<{ storage: Stack[]; quote: Quote; inMine: boolean; guest: boolean }>({ storage: [], quote: null, inMine: false, guest: true });
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? '' : c)), 2600); };
  const apply = (r: Ack) => setSt((c) => ({ storage: r.storage ?? c.storage, quote: (r.quote as Quote) ?? null, inMine: r.inMine ?? c.inMine, guest: r.guest ?? c.guest }));
  const refresh = () => socket.timeout(5000).emit('mines_storage', {}, (err: Error | null, r?: Ack) => { if (!err && r?.ok) apply(r); });
  useEffect(() => { refresh(); const t = window.setInterval(refresh, 4000); socket.on('connect', refresh); return () => { window.clearInterval(t); socket.off('connect', refresh); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function sell(only?: string) {
    socket.timeout(5000).emit('mines_sell', only ? { ore: only } : {}, (err: Error | null, r?: Ack & { paid: number }) => {
      if (err || !r) return flash('Sell failed, try again.');
      if (!r.ok) return flash(r.error ?? 'Sell failed.');
      apply(r); flash(`Sold for 🪙 ${r.paid}`);
    });
  }
  const q = st.quote;
  const tier = q ? SELL_TIERS.find((t) => q.already < t.upTo) ?? SELL_TIERS[SELL_TIERS.length - 1] : SELL_TIERS[0];
  const canSell = !st.guest && !st.inMine;
  return (
    <div ref={wrapRef} className={`sol-panel factory-panel${win.className}`} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove} role="dialog" aria-label="Factory">
      {win.grips}
      <div {...win.bar}>
        <span className="font-semibold">🏭 Factory</span>
        <span className="opacity-70">smelt, craft, sell</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
        {wallet !== null && <span className="ml-auto text-xs font-semibold">🪙 {wallet.toLocaleString()}</span>}
        <button type="button" className={wallet === null ? 'ml-auto' : ''} aria-label="Close factory" onClick={onClose}>✕</button>
      </div>
      {toast && <div className="factory-toast" data-testid="factory-toast">{toast}</div>}
      <div className="factory-body">
        <section className="factory-col" data-testid="factory-storage">
          <h3>📦 Storage</h3>
          <ul className="factory-list">
            {st.storage.map((s) => (
              <li key={stackKey(s)}><span className="mines-dot" style={{ background: s.type === 'ore' && isOre(s.id) ? ORES[s.id].color : '#d9b45a' }} />{nameOf(s)}<b>×{s.qty}</b><small>🪙{priceOf(s)}</small>
                {canSell && <button type="button" onClick={() => sell(stackKey(s))}>Sell</button>}</li>
            ))}
            {!st.storage.length && <li className="opacity-60">Empty. Mine ore and walk out through the EXIT lift to bank it here.</li>}
          </ul>
          <h3>🏦 Sell to the house</h3>
          {st.guest ? <p className="mines-note">Sign in to sell for chips.</p> : st.inMine ? <p className="mines-note" data-testid="factory-inmine">You're still in the mine. Leave the mine to sell.</p> : (
            <button type="button" className="mines-sell" disabled={!q || q.paid < 1} onClick={() => sell()} data-testid="factory-sell">Sell all{q ? ` · 🪙 ${q.paid}` : ''}</button>
          )}
          <p className="mines-note">Sold today: {Math.floor(q?.already ?? 0)} · paying {Math.round(tier.rate * 100)}%. Daily cap: full price to 600, 50% to 1,200, then 20% (resets 00:00 UTC).</p>
        </section>
        <section className="factory-col factory-machines">
          <MinesFactory pack={st.storage} guest={st.guest} flash={flash} onPack={apply} />
        </section>
      </div>
    </div>
  );
}
