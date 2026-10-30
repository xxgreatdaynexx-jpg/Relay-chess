import { useEffect, useRef, useState } from 'react';
import { CasinoLeaderboard, NamePrompt, ResetChips } from '@/components/CasinoCommon';
import { CardFace } from '@/components/SolitairePanel';
import { emitCasino, useSavedName } from '@/lib/casino';
import { HoldemTableView } from '@/components/HoldemTable';
import { useWindowDrag } from '@/lib/windowDrag';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { POKER_LABELS, POKER_PAYS, type PokerHand, type PokerView } from '../../../shared/casino-games';

const OPEN_KEY = 'relay-poker-open';
const BETS = [5, 10, 25, 50, 100];
const PAY_ROWS = (Object.keys(POKER_PAYS) as PokerHand[]).filter((h) => h !== 'nothing');

/** Jacks or Better video poker vs. the house, using casino chips. Docked on the right edge. */
export function PokerPanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('poker', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [tab, setTab] = useState<'holdem' | 'play' | 'board'>(() => (localStorage.getItem('relay-poker-mode') === 'play' ? 'play' : 'holdem'));
  const [name] = useSavedName();
  const [v, setV] = useState<PokerView | null>(null);
  const [hold, setHold] = useState<boolean[]>([false, false, false, false, false]);
  const [bet, setBet] = useState(10);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (tab !== 'board') localStorage.setItem('relay-poker-mode', tab); }, [tab]);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);

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
      <button type="button" className="sol-tab cx-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="poker-tab">🃏 Poker</button>
      {open && (
        <div className="sol-panel bj-panel cx-panel" role="dialog" aria-label="Poker" ref={winRef} style={win.style} onPointerDownCapture={win.front}>
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'holdem' ? 'on' : ''}`} onClick={() => setTab('holdem')} data-testid="poker-mode-holdem">Hold'em</button>
            <button type="button" className={`casino-tabbtn ${tab === 'play' ? 'on' : ''}`} onClick={() => setTab('play')}>Jacks or Better</button>
            <button type="button" className={`casino-tabbtn ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')}>Leaderboard</button>
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close poker" onClick={() => setOpen(false)}>✕</button>
          </div>
          {tab === 'board' ? <CasinoLeaderboard you={name} /> : !name ? <NamePrompt /> : tab === 'holdem' ? <HoldemTableView name={name} /> : (
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
                {!dealt && BETS.map((b) => <button type="button" key={b} className={bet === b ? 'bj-chip-on' : ''} onClick={() => setBet(b)}>{b}</button>)}
                {dealt
                  ? <button type="button" className="bj-deal" disabled={busy} onClick={() => void act('vp_draw', { hold })} data-testid="vp-draw">Draw</button>
                  : <button type="button" className="bj-deal" disabled={busy} onClick={() => void act('vp_deal', { bet })} data-testid="vp-deal">Deal {bet}</button>}
              </div>
              <div className="bj-label">Chips: {v?.chips.toLocaleString() ?? '…'} {err && <span className="account-error">· {err}</span>}</div>
              {v && v.chips < 5 && !dealt && <ResetChips name={name} onDone={(chips) => setV({ ...v, chips })} />}
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
