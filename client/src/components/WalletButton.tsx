import { backdropDismiss } from '@/lib/backdrop';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { openAccount } from '@/lib/settings';
import { setWalletChips } from '@/lib/wallet';
import { EconomyView } from './EconomyView';
import { CLOSE_WORLD_PANELS, WALLET_CLOSE } from '@/lib/worldPanels';
import { DailyReport, type DailyReportData } from './DailyReport';
import { usePanelDrag } from '@/lib/panelDrag';

interface Tx { id?: number; key: string | null; game: string; amount: number; balance: number; memo?: string; at: number }
interface WalletPush { chips: number; tx?: Tx; start?: number }
interface HistoryPage { ok: boolean; history?: Tx[]; hasMore?: boolean; nextCursor?: number; error?: string; unavailable?: boolean }

const GAME_LABEL: Record<string, string> = {
  chess: '♞ Chess', checkers: '⛀ Checkers', conquest: '⚔ Conquest', blackjack: '🂡 Blackjack', roulette: '🎡 Roulette',
  slots: '🎰 Slots', holdem: "♠ Hold'em", 'video-poker': '🃏 Video poker', solitro: '🃏 Solitro', refill: '♻ Refill', casino: '🎲 Casino', daily_bonus: '🎁 Daily bonus', boat_upkeep: '🛥 Yacht upkeep', jet_upkeep: '🛩 Jet upkeep', vanity: '✨ Vanity Desk', patronage: '🏛️ City patronage',
};

function when(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function txKey(t: Tx, i: number): string {
  return t.key ? `k:${t.key}` : t.id != null ? `id:${t.id}` : `at:${t.at}:${t.game}:${t.amount}:${i}`;
}

function mergeOlder(cur: Tx[], more: Tx[]): Tx[] {
  const seen = new Set(cur.map((t, i) => txKey(t, i)));
  const out = [...cur];
  for (const t of more) {
    const k = txKey(t, out.length);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Unified chip wallet in the top bar: live balance for every game, and history. */
export function WalletButton() {
  const dragWallet = usePanelDrag('wallet');
  const account = useAccount();
  const [chips, setChips] = useState<number | null>(null);
  const [history, setHistory] = useState<Tx[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [view, setView] = useState<'me' | 'econ'>('me');
  // QA r8: Esc closes the Wallet; opening it drops any map panel (one main panel at a time); map panels close it.
  useEffect(() => {
    if (!open) return; window.dispatchEvent(new Event(CLOSE_WORLD_PANELS));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (expanded) setExpanded(false); else setOpen(false); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [open, expanded]);
  useEffect(() => { const close = () => setOpen(false); window.addEventListener(WALLET_CLOSE, close); return () => window.removeEventListener(WALLET_CLOSE, close); }, []);
  useEffect(() => { if (!open) setExpanded(false); }, [open]);
  const [bonusToast, setBonusToast] = useState('');
  const [report, setReport] = useState<DailyReportData | null>(null);
  const [reportErr, setReportErr] = useState('');
  const [bump, setBump] = useState<'' | 'bump-up' | 'bump-down'>('');
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let retry = 0;
    const sub = () => {
      if (!socket.connected) return;
      void request('wallet_sub', {}).then((res) => {
        const r = res as unknown as { ok: boolean; signedIn?: boolean; chips?: number; history?: Tx[]; hasMore?: boolean; nextCursor?: number; unavailable?: boolean; error?: string };
        if (r.unavailable) { setUnavailable(r.error || 'Wallet temporarily unavailable.'); setChips(null); setWalletChips(null); retry = window.setTimeout(sub, 5000); return; }
        setUnavailable(null);
        if (!r.ok || !r.signedIn) { setChips(null); setWalletChips(null); setHistory([]); setHasMore(false); setCursor(undefined); return; }
        setChips(r.chips ?? 0); setWalletChips(r.chips ?? 0);
        setHistory(r.history ?? []);
        setHasMore(!!r.hasMore);
        setCursor(r.nextCursor);
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
      if (tx && (tx.amount !== 0 || tx.key)) setHistory((h) => {
        const k = txKey(tx, 0);
        if (h.some((t, i) => txKey(t, i) === k)) return h;
        return [tx, ...h];
      });
    };
    if (account) socket.connect();
    // Auth resumes on connect; give it a beat before subscribing.
    const t = window.setTimeout(sub, 400);
    const onConnect = () => window.setTimeout(sub, 400);
    socket.on('connect', onConnect);
    socket.on('wallet', onWallet);
    let bonusTimer = 0;
    const onBonus = (p: { amount: number; chips: number }) => {
      setChips(p.chips); setWalletChips(p.chips); setBump('bump-up'); window.setTimeout(() => setBump(''), 750);
      setBonusToast(`+${p.amount.toLocaleString()} daily bonus`);
      window.clearTimeout(bonusTimer); bonusTimer = window.setTimeout(() => setBonusToast(''), 5000);
      sub();
    };
    socket.on('daily_bonus', onBonus);
    const onReport = (r: DailyReportData) => setReport(r);
    socket.on('daily_report', onReport);
    return () => { socket.off('daily_report', onReport); window.clearTimeout(t); window.clearTimeout(retry); window.clearTimeout(bonusTimer); socket.off('connect', onConnect); socket.off('wallet', onWallet); socket.off('daily_bonus', onBonus); };
  }, [account]);

  const loadMore = () => {
    if (!hasMore || cursor == null || loadingMore) return;
    setLoadingMore(true);
    void request('wallet_history', { cursor, limit: 25 }).then((res) => {
      const r = res as unknown as HistoryPage;
      setLoadingMore(false);
      if (!r.ok || !r.history) return;
      setHistory((h) => mergeOlder(h, r.history ?? []));
      setHasMore(!!r.hasMore);
      setCursor(r.nextCursor);
    }).catch(() => setLoadingMore(false));
  };

  // QA r10: outside clicks are caught by a transparent backdrop (below), so they only close the Wallet and never
  // reach the venue card / map behind it (the old document mousedown listener let the click through).

  const signedIn = Boolean(account) && chips !== null;
  const [reportToast, setReportToast] = useState('');
  const openReport = () => {
    setReportErr('');
    if (!account) { setReportToast('Sign in to see your Daily Report.'); window.setTimeout(() => setReportToast(''), 3500); return; }
    void request('daily_report_get').then((r) => { const rep = (r as unknown as { report?: DailyReportData }).report; if (r.ok && rep) { setOpen(false); setReport(rep); } else { const m = r.error || 'Could not load the report.'; setReportErr(m); setReportToast(m); window.setTimeout(() => setReportToast(''), 3500); } });
  };
  return (
    <div ref={ref} className="wallet-wrap">
      {report && <DailyReport report={report} onClose={() => setReport(null)} />}
      {bonusToast && createPortal(
        <div role="status" data-testid="daily-bonus-toast" className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#e8c26a]/60 bg-[#1b1d2e]/95 px-4 py-2 text-sm font-bold text-[#e8c26a] shadow-lg">
          🎁 {bonusToast}
        </div>, document.body)}
      {reportToast && createPortal(
        <div role="status" data-testid="daily-report-toast" className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/20 bg-[#1b1d2e]/95 px-4 py-2 text-sm font-semibold text-cream shadow-lg">{reportToast}</div>, document.body)}
      <button type="button" className="wallet-btn mr-1" title="Daily Report" aria-label="Open Daily Report" data-testid="daily-report-button" onClick={() => openReport()}><span aria-hidden>📰</span></button>
      <button type="button" className={`wallet-btn ${bump}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="wallet-button"
        aria-label={signedIn ? `Wallet: ${chips} chips` : 'Wallet'}>
        <span aria-hidden>🪙</span>
        <span data-testid="wallet-chips">{unavailable && account ? 'Wallet unavailable' : signedIn ? chips!.toLocaleString() : 'Wallet'}</span>
      </button>
      {open && createPortal(<div className="wallet-backdrop" data-testid="wallet-backdrop" {...backdropDismiss(() => setOpen(false))} />, document.body)}
      {open && createPortal(
        <div ref={(el) => { panelRef.current = el; dragWallet.ref.current = el; }} className={`wallet-panel${expanded ? ' wallet-panel--expanded' : ''}`} role="dialog" aria-label="Wallet" data-testid="wallet-panel" data-expanded={expanded ? 'true' : 'false'} data-drag-panel="wallet" onPointerDown={dragWallet.onPointerDown} style={dragWallet.style()}>{dragWallet.handle}
          <div className="mb-2 flex gap-1" role="tablist">
            {([['me', '🪙 My wallet'], ['econ', '🌍 Economy']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} data-testid={`wallet-tab-${k}`} onClick={() => setView(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${view === k ? 'bg-[#e8c26a] text-[#1b1d2e]' : 'bg-white/10'}`}>{l}</button>
            ))}
          </div>
          {view === 'econ' ? <EconomyView /> : unavailable && account ? (
            <p className="text-sm" role="alert" data-testid="wallet-unavailable">{unavailable} Chip actions are paused until it reconnects.</p>
          ) : !signedIn ? (
            <div>
              <p className="text-sm">Sign in to get your chip wallet. One balance for chess, checkers, Conquest and the casino.</p>
              <button type="button" className="mt-3 rounded-full bg-[#e8c26a] px-3 py-1.5 text-sm font-bold text-[#1b1d2e]" onClick={() => { setOpen(false); openAccount('account'); }}>Sign in</button>
            </div>
          ) : (
            <div className="wallet-panel-body">
              <div className="flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wide opacity-70">Balance</div>
                <div className="text-2xl font-bold tabular-nums" data-testid="wallet-balance">🪙 {chips!.toLocaleString()}</div>
              </div>
              <p className="mt-1 text-[11px] opacity-60">Same chips in every game: wager on chess, checkers and Conquest tables, or play the casino.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" data-testid="open-daily-report" className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
                  onClick={() => openReport()}>📊 Daily report</button>
                <button type="button" data-testid="wallet-expand" className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
                  aria-pressed={expanded} onClick={() => setExpanded((e) => !e)}>{expanded ? 'Close expanded view' : 'Expand logs'}</button>
              </div>
              {reportErr && <p className="mt-1 text-xs text-rose-300">{reportErr}</p>}
              <div className="mt-3 text-xs uppercase tracking-wide opacity-70">Recent</div>
              {history.length === 0 ? <p className="mt-1 text-sm opacity-60">No chip moves yet.</p> : (
                <div className="wallet-history-scroll" data-testid="wallet-history-scroll">
                  <ul className="mt-1" data-testid="wallet-history">
                    {history.map((t, i) => (
                      <li key={txKey(t, i)}>
                        <span className="min-w-0 truncate">{GAME_LABEL[t.game] ?? t.game}{t.memo ? <span className="opacity-50"> · {t.memo}</span> : null}</span>
                        <span className="flex shrink-0 gap-2 tabular-nums">
                          <b className={t.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{t.amount >= 0 ? '+' : ''}{t.amount}</b>
                          <span className="opacity-50">{when(t.at)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {hasMore && (
                    <button type="button" data-testid="wallet-load-more" className="mt-2 mb-1 w-full rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-50"
                      disabled={loadingMore || cursor == null} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>, document.body,
      )}
    </div>
  );
}
