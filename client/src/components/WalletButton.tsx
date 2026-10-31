import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { openAccount } from '@/lib/settings';
import { setWalletChips } from '@/lib/wallet';

interface Tx { key: string | null; game: string; amount: number; balance: number; memo?: string; at: number }
interface WalletPush { chips: number; tx?: Tx; brokeBelow?: number; start?: number }

const GAME_LABEL: Record<string, string> = {
  chess: '♞ Chess', checkers: '⛀ Checkers', conquest: '⚔ Conquest', blackjack: '🂡 Blackjack', roulette: '🎡 Roulette',
  slots: '🎰 Slots', holdem: "♠ Hold'em", 'video-poker': '🃏 Video poker', solitro: '🃏 Solitro', refill: '♻ Refill', casino: '🎲 Casino',
};

function when(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Unified chip wallet in the top bar: live balance for every game, history and the broke refill. */
export function WalletButton() {
  const account = useAccount();
  const [chips, setChips] = useState<number | null>(null);
  const [history, setHistory] = useState<Tx[]>([]);
  const [broke, setBroke] = useState(5);
  const [open, setOpen] = useState(false);
  const [bump, setBump] = useState<'' | 'bump-up' | 'bump-down'>('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sub = () => {
      if (!socket.connected) return;
      void request('wallet_sub', {}).then((res) => {
        const r = res as unknown as { ok: boolean; signedIn?: boolean; chips?: number; history?: Tx[]; brokeBelow?: number };
        if (!r.ok || !r.signedIn) { setChips(null); setWalletChips(null); setHistory([]); return; }
        setChips(r.chips ?? 0); setWalletChips(r.chips ?? 0);
        setHistory(r.history ?? []);
        if (r.brokeBelow) setBroke(r.brokeBelow);
      });
    };
    const onWallet = (p: WalletPush) => {
      setWalletChips(p.chips);
      setChips((prev) => {
        if (prev !== null && p.chips !== prev) {
          setBump(p.chips > prev ? 'bump-up' : 'bump-down');
          window.setTimeout(() => setBump(''), 750);
        }
        return p.chips;
      });
      const tx = p.tx;
      if (tx && (tx.amount !== 0 || tx.key)) setHistory((h) => [tx, ...h].slice(0, 25));
      if (p.brokeBelow) setBroke(p.brokeBelow);
    };
    if (account) socket.connect();
    // Auth resumes on connect; give it a beat before subscribing.
    const t = window.setTimeout(sub, 400);
    const onConnect = () => window.setTimeout(sub, 400);
    socket.on('connect', onConnect);
    socket.on('wallet', onWallet);
    return () => { window.clearTimeout(t); socket.off('connect', onConnect); socket.off('wallet', onWallet); };
  }, [account]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const signedIn = Boolean(account) && chips !== null;
  return (
    <div ref={ref} className="wallet-wrap">
      <button type="button" className={`wallet-btn ${bump}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="wallet-button"
        aria-label={signedIn ? `Wallet: ${chips} chips` : 'Wallet'}>
        <span aria-hidden>🪙</span>
        <span data-testid="wallet-chips">{signedIn ? chips!.toLocaleString() : 'Wallet'}</span>
      </button>
      {open && createPortal(
        <div ref={panelRef} className="wallet-panel" role="dialog" aria-label="Wallet" data-testid="wallet-panel">
          {!signedIn ? (
            <div>
              <p className="text-sm">Sign in to get your chip wallet. One balance for chess, checkers, Conquest and the casino.</p>
              <button type="button" className="mt-3 rounded-full bg-[#e8c26a] px-3 py-1.5 text-sm font-bold text-[#1b1d2e]" onClick={() => { setOpen(false); openAccount('account'); }}>Sign in</button>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wide opacity-70">Balance</div>
                <div className="text-2xl font-bold tabular-nums" data-testid="wallet-balance">🪙 {chips!.toLocaleString()}</div>
              </div>
              <p className="mt-1 text-[11px] opacity-60">Same chips in every game: wager on chess, checkers and Conquest tables, or play the casino.</p>
              {chips! < broke && (
                <button type="button" data-testid="wallet-reset" className="mt-2 w-full rounded-full bg-emerald-500/80 px-3 py-1.5 text-sm font-bold"
                  onClick={() => void request('wallet_reset', {}).then((r) => setError(r.ok ? '' : r.error ?? 'Could not refill.'))}>
                  Broke? Refill to 1,000 chips
                </button>
              )}
              {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
              <div className="mt-3 text-xs uppercase tracking-wide opacity-70">Recent</div>
              {history.length === 0 ? <p className="mt-1 text-sm opacity-60">No chip moves yet.</p> : (
                <ul className="mt-1" data-testid="wallet-history">
                  {history.map((t, i) => (
                    <li key={`${t.key ?? ''}${t.at}${i}`}>
                      <span className="min-w-0 truncate">{GAME_LABEL[t.game] ?? t.game}{t.memo ? <span className="opacity-50"> · {t.memo}</span> : null}</span>
                      <span className="flex shrink-0 gap-2 tabular-nums">
                        <b className={t.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{t.amount >= 0 ? '+' : ''}{t.amount}</b>
                        <span className="opacity-50">{when(t.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>, document.body,
      )}
    </div>
  );
}
