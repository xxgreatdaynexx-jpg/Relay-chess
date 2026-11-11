import { useDoing } from '@/lib/doing';
import { TopTab } from '@/components/TopTabs';
import { useEffect, useRef, useState } from 'react';
import { NamePrompt, OutOfChips } from '@/components/CasinoCommon';
import { CigaretteBar } from '@/components/CigaretteBar';
import { CardFace } from '@/components/SolitairePanel';
import { useWalletChips } from '@/lib/wallet';
import { emitCasino, useSavedName } from '@/lib/casino';
import { HoldemTableView } from '@/components/HoldemTable';
import { useWindowDrag } from '@/lib/windowDrag';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { POKER_LABELS, POKER_PAYS, type PokerHand, type PokerView } from '../../../shared/casino-games';
import { VP_STAKES, vpStakes, type VpStakesId } from '../../../shared/highStakes';

const OPEN_KEY = 'relay-poker-open';
const PAY_ROWS = (Object.keys(POKER_PAYS) as PokerHand[]).filter((h) => h !== 'nothing');

/** Jacks or Better video poker vs. the house, using casino chips. Docked on the right edge. */
export function PokerPanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('poker', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  useDoing('casino', 'Poker', open);
  const [tab, setTab] = useState<'holdem' | 'play'>(() => (localStorage.getItem('relay-poker-mode') === 'play' ? 'play' : 'holdem'));
  const [name] = useSavedName();
  const [v, setV] = useState<PokerView | null>(null);
  const wallet = useWalletChips();
  const [hold, setHold] = useState<boolean[]>([false, false, false, false, false]);
  const [vpPick, setVpPick] = useState<VpStakesId>(() => vpStakes(localStorage.getItem('relay-vp-stakes')).id);
  const [bet, setBet] = useState(() => vpStakes(localStorage.getItem('relay-vp-stakes')).bets[0]!);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { localStorage.setItem('relay-poker-mode', tab); }, [tab]);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { localStorage.setItem('relay-vp-stakes', vpPick); }, [vpPick]);
  useEffect(() => {
    const on = (e: Event) => { const id = vpStakes((e as CustomEvent).detail).id; setVpPick(id); setBet(vpStakes(id).bets[0]!); setTab('play'); setOpen(true); };
    window.addEventListener('open-high-stakes-poker', on);
    const onHe = () => { setTab('holdem'); setOpen(true); };
    window.addEventListener('open-high-stakes-holdem', onHe);
    return () => { window.removeEventListener('open-high-stakes-poker', on); window.removeEventListener('open-high-stakes-holdem', onHe); };
  }, []);

  useEffect(() => {
    if (!open || !name || tab !== 'play') return;
    void emitCasino<{ state: PokerView }>('vp_state').then((r) => r.ok && r.state && setV(r.state));
  }, [open, name, tab]);

  const act = async (event: 'vp_deal' | 'vp_draw', payload: unknown) => {
    setBusy(true);
    setErr('');
    const r = await emitCasino<{ state: PokerView }>(event, payload);
    setBusy(false);
    if (!r.ok || !r.state) return setErr(r.error ?? 'Try again.');
    setV(r.state);
    playCardFlick();
    if (event === 'vp_deal') setHold([false, false, false, false, false]);
    if (r.state.result && r.state.result.net > 0) playSolitaireWin();
  };

  const dealt = v?.phase === 'dealt';
  return (
    <div className={`cx-wrap pk-wrap ${open ? 'cx-open' : ''}`} data-testid="poker">
      <TopTab id="poker"><button type="button" className="sol-tab cx-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="poker-tab">🃏 Poker</button></TopTab>
      {open && (
        <div className={"sol-panel bj-panel cx-panel" + win.className} role="dialog" aria-label="Poker" ref={winRef} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove}>
          {win.grips}
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'holdem' ? 'on' : ''}`} onClick={() => setTab('holdem')} data-testid="poker-mode-holdem">Hold'em</button>
            <button type="button" className={`casino-tabbtn ${tab === 'play' ? 'on' : ''}`} onClick={() => setTab('play')}>Jacks or Better</button>
            {tab === 'play' && <label className="bj-stakes">Stakes <select data-testid="vp-stakes" value={vpPick} onChange={(e) => { const id = vpStakes(e.target.value).id; setVpPick(id); setBet(vpStakes(id).bets[0]!); }}>{VP_STAKES.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.min.toLocaleString()}–{s.max.toLocaleString()})</option>)}</select></label>}
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close poker" onClick={() => setOpen(false)}>✕</button>
          </div>
          {!name ? <NamePrompt /> : tab === 'holdem' ? <HoldemTableView name={name} /> : (
            <div className="bj-table">
              <div className="bj-status" data-testid="vp-status">
                {dealt ? 'Tap cards to hold, then Draw.' : v?.result ? `${v.result.label}${v.result.net > 0 ? ` · won ${v.result.net}` : v.result.net === 0 ? ' · stake back' : ''}` : 'Pick a bet and Deal.'}
              </div>
              <div className="vp-hand">
                {(v?.cards.length ? v.cards : []).map((c, i) => (
                  <button type="button" key={`${c.id}${i}`} className={`vp-card ${hold[i] && dealt ? 'held' : ''}`} disabled={!dealt} onClick={() => setHold((h) => h.map((x, j) => (j === i ? !x : x)))} data-testid={`vp-card-${i}`}>
                    <CardFace card={c} />
                    <span className="vp-hold">{dealt && hold[i] ? 'HELD' : ''}</span>
                  </button>
                ))}
                {!v?.cards.length && <div className="bj-label">Five cards, one draw. Pair of jacks or better wins.</div>}
              </div>
              <div className="bj-controls">
                {!dealt && vpStakes(vpPick).bets.map((b) => <button type="button" key={b} className={bet === b ? 'bj-chip-on' : ''} onClick={() => setBet(b)}>{b}</button>)}
                {dealt
                  ? <button type="button" className="bj-deal" disabled={busy} onClick={() => void act('vp_draw', { hold })} data-testid="vp-draw">Draw</button>
                  : <button type="button" className="bj-deal" disabled={busy} onClick={() => void act('vp_deal', { bet, stakes: vpPick })} data-testid="vp-deal">Deal {bet}</button>}
              </div>
              <div className="bj-label">Chips: {(wallet ?? v?.chips)?.toLocaleString() ?? '…'} {err && <span className="account-error">· {err}</span>}</div>
              <CigaretteBar open={open && tab === 'play'} />
              {v && v.chips < 5 && !dealt && <OutOfChips />}
              <table className="vp-pays">
                <tbody>{PAY_ROWS.map((h) => <tr key={h} className={v?.result?.hand === h ? 'on' : ''}><td>{POKER_LABELS[h]}</td><td>{POKER_PAYS[h]}×</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
